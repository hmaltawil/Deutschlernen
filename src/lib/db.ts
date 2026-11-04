/** IndexedDB persistence: per-sentence progress, daily stats, settings, sync bookkeeping. */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Progress } from './srs';
import type { DayStat } from './scoring';
import { DEFAULT_SETTINGS, type Settings } from './settings';
import { newer, type SyncResult } from './sync/core';

interface LueckeDB extends DBSchema {
  progress: { key: number; value: Progress; indexes: { due: number } };
  /** this device's own daily stats */
  days: { key: string; value: DayStat };
  /**
   * settings, device (id), settingsUpdated (ms), resetAt (ms),
   * otherDays (other devices' daily stats, from sync), sync (sync config), syncDirty
   */
  kv: { key: string; value: unknown };
}

export interface Backup {
  app: 'luecke';
  version: 1;
  exported: string;
  progress: Progress[];
  days: DayStat[];
  /** other devices' daily stats (only when sync was on) */
  otherDays?: Record<string, DayStat[]>;
  settings: Settings;
}

export interface LocalData {
  progress: Progress[];
  days: DayStat[];
  otherDays: Record<string, DayStat[]>;
  settings: Settings;
  settingsUpdated: number;
  resetAt: number;
}

let dbp: Promise<IDBPDatabase<LueckeDB>> | null = null;

export function db(): Promise<IDBPDatabase<LueckeDB>> {
  dbp ??= openDB<LueckeDB>('luecke', 1, {
    upgrade(d) {
      const p = d.createObjectStore('progress', { keyPath: 'id' });
      p.createIndex('due', 'due');
      d.createObjectStore('days', { keyPath: 'date' });
      d.createObjectStore('kv');
    },
  });
  return dbp;
}

export async function getKv<T>(key: string): Promise<T | undefined> {
  return (await (await db()).get('kv', key)) as T | undefined;
}

export async function setKv(key: string, value: unknown): Promise<void> {
  await (await db()).put('kv', value, key);
}

export async function delKv(key: string): Promise<void> {
  await (await db()).delete('kv', key);
}

/** A random id for this browser, used to keep each device's daily stats apart when syncing. */
export async function deviceId(): Promise<string> {
  let id = await getKv<string>('device');
  if (!id) {
    id = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, '0')).join('');
    await setKv('device', id);
  }
  return id;
}

export async function loadAll(): Promise<LocalData> {
  const d = await db();
  const [progress, days, settings, otherDays, settingsUpdated, resetAt] = await Promise.all([
    d.getAll('progress'),
    d.getAll('days'),
    d.get('kv', 'settings') as Promise<Partial<Settings> | undefined>,
    d.get('kv', 'otherDays') as Promise<Record<string, DayStat[]> | undefined>,
    d.get('kv', 'settingsUpdated') as Promise<number | undefined>,
    d.get('kv', 'resetAt') as Promise<number | undefined>,
  ]);
  return {
    progress,
    days,
    otherDays: otherDays ?? {},
    settings: { ...DEFAULT_SETTINGS, ...(settings ?? {}) },
    settingsUpdated: settingsUpdated ?? 0,
    resetAt: resetAt ?? 0,
  };
}

/** Save one answer atomically: the sentence's progress and the day's stats. */
export async function saveAnswer(p: Progress | null, day: DayStat): Promise<void> {
  const d = await db();
  const tx = d.transaction(['progress', 'days'], 'readwrite');
  if (p) tx.objectStore('progress').put(p);
  tx.objectStore('days').put(day);
  await tx.done;
}

export async function saveSettings(s: Settings, updated = Date.now()): Promise<void> {
  const d = await db();
  const tx = d.transaction('kv', 'readwrite');
  tx.store.put(s, 'settings');
  tx.store.put(updated, 'settingsUpdated');
  await tx.done;
}

/**
 * Apply what a sync brought in. Guards against overwriting answers made on this
 * device while the sync was running.
 */
export async function applySync(r: SyncResult): Promise<void> {
  const d = await db();
  const tx = d.transaction(['progress', 'days', 'kv'], 'readwrite');
  const progress = tx.objectStore('progress');
  for (const id of r.progressDelete) {
    const cur = await progress.get(id);
    if (cur && cur.last < r.resetAt) await progress.delete(id);
  }
  for (const p of r.progressPut) {
    const cur = await progress.get(p.id);
    if (!cur || !newer(cur, p)) await progress.put(p);
  }
  if (r.ownDays) {
    await tx.objectStore('days').clear();
    for (const day of r.ownDays) await tx.objectStore('days').put(day);
  }
  const kv = tx.objectStore('kv');
  await kv.put(r.otherDays, 'otherDays');
  await kv.put(r.resetAt, 'resetAt');
  if (r.settings) {
    await kv.put({ ...DEFAULT_SETTINGS, ...r.settings.value }, 'settings');
    await kv.put(r.settings.updated, 'settingsUpdated');
  }
  await tx.done;
}

export async function exportBackup(): Promise<Backup> {
  const { progress, days, otherDays, settings } = await loadAll();
  return { app: 'luecke', version: 1, exported: new Date().toISOString(), progress, days, otherDays, settings };
}

export function validateBackup(x: unknown): Backup {
  const b = x as Backup;
  if (!b || b.app !== 'luecke' || b.version !== 1 || !Array.isArray(b.progress) || !Array.isArray(b.days)) {
    throw new Error('This file is not a Lücke backup.');
  }
  for (const p of b.progress) {
    if (typeof p.id !== 'number' || typeof p.stage !== 'number' || typeof p.due !== 'number') {
      throw new Error('Backup contains invalid progress entries.');
    }
  }
  return b;
}

/** Replace all data on this device with the backup's contents. */
export async function importBackup(raw: unknown): Promise<void> {
  const b = validateBackup(raw);
  const d = await db();
  const tx = d.transaction(['progress', 'days', 'kv'], 'readwrite');
  await Promise.all([tx.objectStore('progress').clear(), tx.objectStore('days').clear()]);
  for (const p of b.progress) tx.objectStore('progress').put(p);
  for (const day of b.days) tx.objectStore('days').put(day);
  tx.objectStore('kv').put({ ...DEFAULT_SETTINGS, ...b.settings }, 'settings');
  tx.objectStore('kv').put(Date.now(), 'settingsUpdated');
  tx.objectStore('kv').put(b.otherDays ?? {}, 'otherDays');
  await tx.done;
}

/** Delete all progress, points and streaks. With sync on, the reset reaches every device. */
export async function resetProgress(): Promise<void> {
  const d = await db();
  const tx = d.transaction(['progress', 'days', 'kv'], 'readwrite');
  await Promise.all([
    tx.objectStore('progress').clear(),
    tx.objectStore('days').clear(),
    tx.objectStore('kv').put({}, 'otherDays'),
    tx.objectStore('kv').put(Date.now(), 'resetAt'),
    tx.done,
  ]);
}

/**
 * After a deck update, sentences may have moved to other levels or left the deck.
 * Re-file every progress record under its new level and drop the ones that are gone.
 * Returns how many records changed.
 */
export async function migrateProgress(levelOf: Map<number, number>): Promise<number> {
  const d = await db();
  const tx = d.transaction('progress', 'readwrite');
  let changed = 0;
  for (const p of await tx.store.getAll()) {
    const lv = levelOf.get(p.id);
    if (lv === undefined) {
      await tx.store.delete(p.id);
      changed++;
    } else if (lv !== p.lv) {
      await tx.store.put({ ...p, lv });
      changed++;
    }
  }
  await tx.done;
  return changed;
}
