/** IndexedDB persistence: per-sentence progress, daily stats, settings, sync bookkeeping. */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Progress } from './srs';
import type { DayStat } from './scoring';
import { DEFAULT_SETTINGS, deviceSettings, type Settings } from './settings';
import { newer, sumDays, type SyncResult } from './sync/core';

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
  if (!dbp) {
    const opening = openDB<LueckeDB>('luecke', 1, {
      upgrade(d) {
        const p = d.createObjectStore('progress', { keyPath: 'id' });
        p.createIndex('due', 'due');
        d.createObjectStore('days', { keyPath: 'date' });
        d.createObjectStore('kv');
      },
      // the browser closed the connection (iOS does this to apps left in the background)
      terminated() {
        if (dbp === opening) dbp = null;
      },
    });
    opening.catch(() => {
      if (dbp === opening) dbp = null;
    });
    dbp = opening;
  }
  return dbp;
}

/**
 * Safari on iPhone sometimes drops the database connection of an app that sat in the
 * background ("Connection to Indexed Database server lost"), and every later request on
 * it fails. Recognise that and reconnect.
 */
export function isConnectionLost(e: unknown): boolean {
  const err = e as { name?: string; message?: string } | null;
  if (!err) return false;
  return (
    err.name === 'UnknownError' ||
    err.name === 'InvalidStateError' ||
    /connection|server lost|closing|closed/i.test(err.message ?? '')
  );
}

/** Run a database operation; if the connection was lost, reopen it and try once more. */
async function withDb<T>(fn: (d: IDBPDatabase<LueckeDB>) => Promise<T>): Promise<T> {
  const first = await db();
  try {
    return await fn(first);
  } catch (e) {
    if (!isConnectionLost(e)) throw e;
    if (dbp && (await dbp.catch(() => null)) === first) dbp = null;
    try {
      first.close();
    } catch {
      /* already closed */
    }
    return fn(await db());
  }
}

export async function getKv<T>(key: string): Promise<T | undefined> {
  return (await withDb((d) => d.get('kv', key))) as T | undefined;
}

export async function setKv(key: string, value: unknown): Promise<void> {
  await withDb((d) => d.put('kv', value, key));
}

export async function delKv(key: string): Promise<void> {
  await withDb((d) => d.delete('kv', key));
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
  return withDb(async (d) => {
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
  });
}

/** Save one answer atomically: the sentence's progress and the day's stats. */
export async function saveAnswer(p: Progress | null, day: DayStat): Promise<void> {
  return withDb(async (d) => {
    const tx = d.transaction(['progress', 'days'], 'readwrite');
    if (p) tx.objectStore('progress').put(p);
    tx.objectStore('days').put(day);
    await tx.done;
  });
}

export async function saveProgress(p: Progress): Promise<void> {
  await withDb((d) => d.put('progress', p));
}

/** Save the settings; `updated` (when the shared settings last changed, for sync) only if given. */
export async function saveSettings(s: Settings, updated?: number): Promise<void> {
  return withDb(async (d) => {
    const tx = d.transaction('kv', 'readwrite');
    tx.store.put(s, 'settings');
    if (updated !== undefined) tx.store.put(updated, 'settingsUpdated');
    await tx.done;
  });
}

/**
 * Apply what a sync brought in. Guards against overwriting answers made on this
 * device while the sync was running.
 */
export async function applySync(r: SyncResult): Promise<void> {
  return withDb(async (d) => {
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
      // keep this device's own settings as they are now (they may have changed during the sync)
      const cur = ((await kv.get('settings')) ?? {}) as Partial<Settings>;
      await kv.put({ ...DEFAULT_SETTINGS, ...r.settings.value, ...deviceSettings(cur) }, 'settings');
      await kv.put(r.settings.updated, 'settingsUpdated');
    }
    await tx.done;
  });
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

export interface ImportResult {
  restored: number;
  /** sentences in the backup that are no longer in the deck */
  dropped: number;
}

/**
 * Replace all data on this device with the backup's contents.
 *
 * - `levelOf` (sentence id → level in the current deck) re-files every sentence under its
 *   current level, so a backup made before a deck update fits the new levels; sentences
 *   that left the deck are left out.
 * - If progress was reset after the backup was made, sync would delete everything older
 *   than the reset again. Restoring is the newer decision, so restored records count from
 *   just after the reset (answers made since then on other devices still win), and the
 *   other devices' daily stats from the backup are kept as this device's own.
 * - This device's own settings (voice, theme, auto-save) stay as they are.
 */
export async function importBackup(raw: unknown, levelOf?: Map<number, number>): Promise<ImportResult> {
  const b = validateBackup(raw);
  return withDb(async (d) => {
    const tx = d.transaction(['progress', 'days', 'kv'], 'readwrite');
    const kv = tx.objectStore('kv');
    const resetAt = ((await kv.get('resetAt')) as number | undefined) ?? 0;
    const cur = ((await kv.get('settings')) ?? {}) as Partial<Settings>;
    await Promise.all([tx.objectStore('progress').clear(), tx.objectStore('days').clear()]);
    let restored = 0;
    let dropped = 0;
    for (const p of b.progress) {
      const lv = levelOf ? levelOf.get(p.id) : p.lv;
      if (lv === undefined) {
        dropped++;
        continue;
      }
      const last = (p.last ?? 0) < resetAt ? resetAt + 1 : p.last;
      tx.objectStore('progress').put({ ...p, lv, last });
      restored++;
    }
    const resetSinceBackup = resetAt > (Date.parse(b.exported) || 0);
    const own = resetSinceBackup ? sumDays([b.days, ...Object.values(b.otherDays ?? {})]) : b.days;
    for (const day of own) tx.objectStore('days').put(day);
    kv.put({ ...DEFAULT_SETTINGS, ...b.settings, ...deviceSettings(cur) }, 'settings');
    kv.put(Date.now(), 'settingsUpdated');
    kv.put(resetSinceBackup ? {} : (b.otherDays ?? {}), 'otherDays');
    await tx.done;
    return { restored, dropped };
  });
}

/** Delete all progress, points and streaks. With sync on, the reset reaches every device. */
export async function resetProgress(): Promise<void> {
  return withDb(async (d) => {
    const tx = d.transaction(['progress', 'days', 'kv'], 'readwrite');
    await Promise.all([
      tx.objectStore('progress').clear(),
      tx.objectStore('days').clear(),
      tx.objectStore('kv').put({}, 'otherDays'),
      tx.objectStore('kv').put(Date.now(), 'resetAt'),
      tx.done,
    ]);
  });
}

/**
 * After a deck update, sentences may have moved to other levels or left the deck.
 * Re-file every progress record under its new level and drop the ones that are gone.
 * Returns how many records changed.
 */
export async function migrateProgress(levelOf: Map<number, number>): Promise<number> {
  return withDb(async (d) => {
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
  });
}
