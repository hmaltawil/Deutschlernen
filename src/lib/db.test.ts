import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { applySync, db, exportBackup, importBackup, isConnectionLost, loadAll, migrateProgress, resetLevel, resetProgress, saveAnswer, saveSettings, setKv, validateBackup } from './db';
import { newProgress, review } from './srs';
import { allChunkIds, syncOnce, type Chunk, type LocalState } from './sync/core';
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
  it('a backup restored after "Reset progress" survives the next sync', async () => {
    const docs = new Map<string, Chunk>();
    const syncDevice = async (now: number) => {
      const d = await loadAll();
      const local: LocalState = {
        deviceId: 'phone', deck: 2, levels: [1, 2], progress: d.progress, ownDays: d.days, otherDays: d.otherDays,
        settings: d.settings, settingsUpdated: d.settingsUpdated, resetAt: d.resetAt, lastSeen: {}, dirty: allChunkIds([1, 2], 2),
      };
      const pending = new Map<string, Chunk>();
      const r = await syncOnce(local, { get: async (id) => docs.get(id) ?? null, set: (id, c) => void pending.set(id, c) }, now);
      for (const [k, v] of pending) docs.set(k, v);
      await applySync(r);
    };
    await resetProgress();
    await setKv('resetAt', 0);
    const t0 = Date.now() - 10 * 86400000;
    for (let i = 1; i <= 50; i++) await saveAnswer(review(newProgress(i, 1, t0), true, t0), { ...emptyDay('2026-10-25'), points: 4 * i });
    await syncDevice(t0);
    const backup = { ...(await exportBackup()), exported: new Date(t0 + 1000).toISOString(), otherDays: { laptop: [{ ...emptyDay('2026-10-24'), points: 30 }] } };
    await resetProgress(); // by accident…
    await syncDevice(Date.now());
    expect((await loadAll()).progress).toHaveLength(0);
    await importBackup(JSON.parse(JSON.stringify(backup))); // …and restored
    await syncDevice(Date.now() + 1);
    const all = await loadAll();
    expect(all.progress).toHaveLength(50);
    expect(all.progress.every((p) => p.stage === 1)).toBe(true);
    // the laptop's points from the backup are kept (as this device's), so the streak history is back
    expect(all.days.reduce((s, d) => s + d.points, 0)).toBe(200 + 30); // the day's last saved total (200) + the laptop's 30
    expect(all.otherDays).toEqual({});
  });
  it('re-files a backup from an older deck under the current levels and keeps device settings', async () => {
    await resetProgress();
    await setKv('resetAt', 0);
    await saveSettings({ ...DEFAULT_SETTINGS, voice: 'de_DE-kerstin-low', theme: 'dark' });
    const old = {
      app: 'luecke', version: 1, exported: new Date().toISOString(), days: [],
      settings: { ...DEFAULT_SETTINGS, dailyGoal: 300, voice: 'de_DE-thorsten-high', theme: 'light' },
      progress: [newProgress(10, 3, 1000), newProgress(11, 3, 1000), newProgress(12, 1, 1000)], // levels of the old deck
    };
    const r = await importBackup(old, new Map([[10, 7], [11, 3]])); // 10 moved to level 7, 12 left the deck
    expect(r).toEqual({ restored: 2, dropped: 1 });
    const all = await loadAll();
    expect(all.progress.map((p) => [p.id, p.lv]).sort()).toEqual([[10, 7], [11, 3]]);
    expect(all.settings).toMatchObject({ dailyGoal: 300, voice: 'de_DE-kerstin-low', theme: 'dark' });
  });
  it('"Reset level" deletes only that level, keeps points, and a later backup restore survives sync', async () => {
    await resetProgress();
    await setKv('resetAt', 0);
    await setKv('levelResets', {});
    await saveAnswer(newProgress(1, 4, 1000), { ...emptyDay('2026-11-04'), points: 4 });
    await saveAnswer(newProgress(2, 4, 1000), { ...emptyDay('2026-11-04'), points: 8 });
    await saveAnswer(newProgress(3, 5, 1000), { ...emptyDay('2026-11-04'), points: 12 });
    const backup = await exportBackup();
    expect(await resetLevel(4, 'v2p4', 5000)).toBe(2);
    let all = await loadAll();
    expect(all.progress.map((p) => p.id)).toEqual([3]);
    expect(all.days[0].points).toBe(12); // points stay
    expect(all.levelResets).toEqual({ v2p4: 5000 });
    // restoring the backup brings level 4 back, dated just after the reset so sync keeps it
    await importBackup(JSON.parse(JSON.stringify(backup)), new Map([[1, 4], [2, 4], [3, 5]]), 2);
    all = await loadAll();
    expect(all.progress.filter((p) => p.lv === 4).every((p) => p.last === 5001)).toBe(true);
    expect(all.progress.find((p) => p.id === 3)!.last).toBe(1000);
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
