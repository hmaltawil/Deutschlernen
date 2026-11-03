import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { exportBackup, importBackup, loadAll, resetProgress, saveAnswer, saveSettings, validateBackup } from './db';
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
});
