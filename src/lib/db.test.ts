import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { db, exportBackup, importBackup, isConnectionLost, loadAll, migrateProgress, resetProgress, saveAnswer, saveSettings, validateBackup } from './db';
import { newProgress } from './srs';
import { emptyDay } from './scoring';
import { DEFAULT_SETTINGS } from './settings';

describe('db', () => {
  it('saves answers and round-trips a backup', async () => {
    await saveAnswer(newProgress(7, 1, 1000), { ...emptyDay('2026-11-03'), points: 12 });
    await saveSettings({ ...DEFAULT_SETTINGS, dailyGoal: 50 });
    const backup = await exportBackup();
    expect(backup.progress.map((p) => p.id)).toEqual([7]);
    expect(backup.days[0].points).toBe(12);

    await resetProgress();
    expect((await loadAll()).progress).toEqual([]);

    await importBackup(JSON.parse(JSON.stringify(backup)));
    const all = await loadAll();
    expect(all.progress.map((p) => p.id)).toEqual([7]);
    expect(all.settings.dailyGoal).toBe(50);
  });
  it('rejects files that are not backups', () => {
    expect(() => validateBackup({ foo: 1 })).toThrow(/not a Lücke backup/);
  });
  it('re-files progress under new levels after a deck update and drops removed sentences', async () => {
    await resetProgress();
    await saveAnswer(newProgress(1, 1, 1000), { ...emptyDay('2026-11-04'), points: 4 });
    await saveAnswer(newProgress(2, 1, 1000), { ...emptyDay('2026-11-04'), points: 8 });
    await saveAnswer(newProgress(3, 2, 1000), { ...emptyDay('2026-11-04'), points: 12 });
    const changed = await migrateProgress(new Map([[1, 1], [2, 7]])); // 2 moved, 3 removed
    expect(changed).toBe(2);
    const all = (await loadAll()).progress.sort((a, b) => a.id - b.id);
    expect(all.map((p) => [p.id, p.lv])).toEqual([[1, 1], [2, 7]]);
  });
  it('reconnects when the browser dropped the database connection (iPhone in the background)', async () => {
    await resetProgress();
    (await db()).close(); // what Safari effectively does to a backgrounded app
    await saveAnswer(newProgress(42, 1, 1000), { ...emptyDay('2026-11-04'), points: 4 });
    expect((await loadAll()).progress.map((p) => p.id)).toEqual([42]);
  });
  it('recognises Safari\'s lost-connection errors', () => {
    expect(isConnectionLost(new DOMException('Connection to Indexed Database server lost. Refresh the page to try again', 'UnknownError'))).toBe(true);
    expect(isConnectionLost(new DOMException('The database connection is closing.', 'InvalidStateError'))).toBe(true);
    expect(isConnectionLost(new DOMException('Key already exists', 'ConstraintError'))).toBe(false);
  });
});
