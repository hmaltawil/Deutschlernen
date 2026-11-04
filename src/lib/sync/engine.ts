/**
 * Sync engine: decides when to sync, runs one transaction against Firestore,
 * applies the result to IndexedDB and tells the UI.
 *
 * Triggers: app start, shortly after changes, end of a round, coming back online,
 * the app becoming visible/hidden, and every few minutes while visible.
 */
import { loadManifest } from '../deck';
import { applySync, delKv, deviceId, getKv, loadAll, setKv } from '../db';
import { allChunkIds, syncOnce, type LocalState, type SyncResult } from './core';
import { formatCode, generateCode, normalizeCode, syncIdFor } from './code';
import { emulatorHost, firebaseConfig } from './config';
import type { Remote } from './firestore';
import { mark } from '../startup';

interface SyncConfig {
  code: string;
  syncId: string;
  lastSeen: Record<string, number>;
  lastSync: number;
}

export type SyncState = 'unavailable' | 'off' | 'idle' | 'syncing' | 'offline' | 'error';

export interface SyncStatus {
  state: SyncState;
  code?: string;
  lastSync?: number;
  error?: string;
}

const PERIODIC_MS = 3 * 60 * 1000;
const SOON_MS = 15 * 1000;

let status: SyncStatus = { state: firebaseConfig ? 'off' : 'unavailable' };
const listeners = new Set<(s: SyncStatus) => void>();
const appliedHooks = new Set<(r: SyncResult) => void>();
let config: SyncConfig | null = null;
let remote: Remote | null = null;
let running: Promise<void> | null = null;
let again = false;
let soonTimer: ReturnType<typeof setTimeout> | undefined;
let started = false;
/** set once the user turns sync on/off in this session; the start-up load must not override it */
let changedByUser = false;

function set(p: Partial<SyncStatus>) {
  status = { ...status, ...p };
  for (const l of listeners) l(status);
}

export function subscribeSync(fn: (s: SyncStatus) => void): () => void {
  listeners.add(fn);
  fn(status);
  return () => listeners.delete(fn);
}

/** Called after a sync brought changes in, so the UI state can follow. */
export function onSyncApplied(fn: (r: SyncResult) => void): () => void {
  appliedHooks.add(fn);
  return () => appliedHooks.delete(fn);
}

async function getRemote(): Promise<Remote> {
  if (!remote) {
    if (!firebaseConfig) throw new Error('Sync is not configured');
    const { createRemote } = await import('./firestore');
    remote = createRemote(firebaseConfig, emulatorHost);
  }
  return remote;
}

/* ---------- dirty tracking: chunk → change counter ---------- */

let dirtyChain: Promise<unknown> = Promise.resolve();

export function markDirty(chunks: string[]) {
  dirtyChain = dirtyChain.then(async () => {
    const d = (await getKv<Record<string, number>>('syncDirty')) ?? {};
    for (const c of chunks) d[c] = (d[c] ?? 0) + 1;
    await setKv('syncDirty', d);
  });
  if (config) syncSoon();
}

async function clearDirty(snapshot: Record<string, number>) {
  dirtyChain = dirtyChain.then(async () => {
    const d = (await getKv<Record<string, number>>('syncDirty')) ?? {};
    for (const [c, n] of Object.entries(snapshot)) if (d[c] === n) delete d[c];
    await setKv('syncDirty', d);
  });
  await dirtyChain;
}

/* ---------- public API ---------- */

export async function initSync() {
  if (!firebaseConfig) return;
  const stored = (await getKv<SyncConfig>('sync')) ?? null;
  if (!changedByUser) {
    config = stored;
    set(config ? { state: 'idle', code: config.code, lastSync: config.lastSync } : { state: 'off', code: undefined });
  }
  if (!started) {
    started = true;
    window.addEventListener('online', () => syncNow());
    window.addEventListener('offline', () => config && set({ state: 'offline' }));
    document.addEventListener('visibilitychange', () => syncNow());
    setInterval(() => document.visibilityState === 'visible' && syncNow(), PERIODIC_MS);
  }
  if (config) syncNow();
}

/** Turn sync on: with a new code (first device) or an existing one (joining). Returns the code. */
export async function startSync(existing?: string): Promise<string> {
  const code = existing ? normalizeCode(existing) : normalizeCode(generateCode());
  if (!code) throw new Error('That sync code is not valid. It has 24 letters and numbers.');
  changedByUser = true;
  const levels = (await loadManifest()).levels.map((l) => l.n);
  config = { code: formatCode(code), syncId: await syncIdFor(code), lastSeen: {}, lastSync: 0 };
  await setKv('sync', config);
  // a reset made before joining only applied to this device
  await setKv('resetAt', 0);
  markDirty(allChunkIds(levels));
  set({ state: 'idle', code: config.code, lastSync: 0, error: undefined });
  await syncNow();
  if (status.state === 'error') throw new Error(status.error);
  return config.code;
}

/** Stop syncing on this device (keeps local progress; the synced copy stays for other devices). */
export async function stopSync() {
  changedByUser = true;
  config = null;
  await delKv('sync');
  set({ state: 'off', code: undefined, lastSync: undefined, error: undefined });
}

export function syncSoon(ms = SOON_MS) {
  if (!config) return;
  clearTimeout(soonTimer);
  soonTimer = setTimeout(() => syncNow(), ms);
}

export function syncNow(): Promise<void> {
  if (!config) return Promise.resolve();
  if (!navigator.onLine) {
    set({ state: 'offline' });
    return Promise.resolve();
  }
  if (running) {
    again = true;
    return running;
  }
  clearTimeout(soonTimer);
  const cfg = config;
  set({ state: 'syncing' });
  running = (async () => {
    await dirtyChain; // let pending change marks land first
    const [manifest, data, dev, dirtyMap] = await Promise.all([
      loadManifest(),
      loadAll(),
      deviceId(),
      getKv<Record<string, number>>('syncDirty').then((d) => d ?? {}),
    ]);
    const local: LocalState = {
      deviceId: dev,
      levels: manifest.levels.map((l) => l.n),
      progress: data.progress,
      ownDays: data.days,
      otherDays: data.otherDays,
      settings: data.settings,
      settingsUpdated: data.settingsUpdated,
      resetAt: data.resetAt,
      lastSeen: cfg.lastSeen,
      dirty: Object.keys(dirtyMap),
    };
    const r = await (await getRemote()).transact(cfg.syncId, (tx) => syncOnce(local, tx, Date.now()));
    await applySync(r);
    await clearDirty(dirtyMap);
    if (config !== cfg) return; // turned off meanwhile
    cfg.lastSeen = r.lastSeen;
    cfg.lastSync = Date.now();
    await setKv('sync', cfg);
    if (r.progressPut.length || r.progressDelete.length || r.ownDays || r.settings || Object.keys(r.otherDays).length) {
      for (const h of appliedHooks) h(r);
    }
    set({ state: 'idle', lastSync: cfg.lastSync, error: undefined });
    mark('sync');
  })()
    .catch((e: Error) => {
      set({ state: navigator.onLine ? 'error' : 'offline', error: e.message });
    })
    .finally(() => {
      running = null;
      if (again) {
        again = false;
        syncNow();
      }
    });
  return running;
}
