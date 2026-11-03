/** IndexedDB persistence: per-sentence progress, daily stats, settings. */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Progress } from './srs';
import type { DayStat } from './scoring';
import { DEFAULT_SETTINGS, type Settings } from './settings';

interface LueckeDB extends DBSchema {
  progress: { key: number; value: Progress; indexes: { due: number } };
  days: { key: string; value: DayStat };
  kv: { key: string; value: unknown };
}

export interface Backup {
  app: 'luecke';
  version: 1;
  exported: string;
  progress: Progress[];
  days: DayStat[];
  settings: Settings;
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

export async function loadAll(): Promise<{ progress: Progress[]; days: DayStat[]; settings: Settings }> {
  const d = await db();
  const [progress, days, settings] = await Promise.all([
    d.getAll('progress'),
    d.getAll('days'),
    d.get('kv', 'settings') as Promise<Partial<Settings> | undefined>,
  ]);
  return { progress, days, settings: { ...DEFAULT_SETTINGS, ...(settings ?? {}) } };
}

/** Save one answer atomically: the sentence's progress and the day's stats. */
export async function saveAnswer(p: Progress | null, day: DayStat): Promise<void> {
  const d = await db();
  const tx = d.transaction(['progress', 'days'], 'readwrite');
  if (p) tx.objectStore('progress').put(p);
  tx.objectStore('days').put(day);
  await tx.done;
}

export async function saveSettings(s: Settings): Promise<void> {
  await (await db()).put('kv', s, 'settings');
}

export async function exportBackup(): Promise<Backup> {
  const { progress, days, settings } = await loadAll();
  return { app: 'luecke', version: 1, exported: new Date().toISOString(), progress, days, settings };
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

/** Replace all data with the backup's contents. */
export async function importBackup(raw: unknown): Promise<void> {
  const b = validateBackup(raw);
  const d = await db();
  const tx = d.transaction(['progress', 'days', 'kv'], 'readwrite');
  await Promise.all([tx.objectStore('progress').clear(), tx.objectStore('days').clear()]);
  for (const p of b.progress) tx.objectStore('progress').put(p);
  for (const day of b.days) tx.objectStore('days').put(day);
  tx.objectStore('kv').put({ ...DEFAULT_SETTINGS, ...b.settings }, 'settings');
  await tx.done;
}

export async function resetProgress(): Promise<void> {
  const d = await db();
  const tx = d.transaction(['progress', 'days'], 'readwrite');
  await Promise.all([tx.objectStore('progress').clear(), tx.objectStore('days').clear(), tx.done]);
}
