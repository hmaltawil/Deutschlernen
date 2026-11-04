import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../settings';
import { emptyDay, type DayStat } from '../scoring';
import type { Progress } from '../srs';
import { allChunkIds, applyResult, decodeDays, encodeProgress, mergeProgress, sumDays, syncOnce, type Chunk, type LocalState, type RemoteTx } from './core';
import { formatCode, generateCode, normalizeCode, syncIdFor } from './code';

/** In-memory server with transaction semantics: writes are applied only when the pass finishes. */
class FakeRemote {
  docs = new Map<string, Chunk>();
  reads = 0;
  writes = 0;
  async transact<T>(fn: (tx: RemoteTx) => Promise<T>): Promise<T> {
    const pending = new Map<string, Chunk>();
    const tx: RemoteTx = {
      get: async (id) => {
        this.reads++;
        return this.docs.get(id) ?? null;
      },
      set: (id, c) => void pending.set(id, c),
    };
    const out = await fn(tx);
    for (const [k, v] of pending) {
      this.docs.set(k, v);
      this.writes++;
    }
    return out;
  }
}

const LEVELS = [1, 2, 3];
const p = (id: number, lv: number, last: number, stage = 1, extra: Partial<Progress> = {}): Progress => ({
  id, lv, stage, due: last + 86400000, correct: stage, wrong: 0, first: last, last, ...extra,
});
const day = (date: string, points: number): DayStat => ({ ...emptyDay(date), points, correct: points / 4 });

function device(id: string, init: Partial<LocalState> = {}): LocalState {
  return {
    deviceId: id, levels: LEVELS, progress: [], ownDays: [], otherDays: {}, settings: { ...DEFAULT_SETTINGS },
    settingsUpdated: 0, resetAt: 0, lastSeen: {}, dirty: allChunkIds(LEVELS), ...init,
  };
}

async function sync(remote: FakeRemote, d: LocalState, now: number): Promise<LocalState> {
  const dirty = [...d.dirty];
  const r = await remote.transact((tx) => syncOnce(d, tx, now));
  return applyResult(d, r, dirty);
}

const ids = (d: LocalState) => d.progress.map((x) => x.id).sort((a, b) => a - b);
const totalPoints = (d: LocalState) => sumDays([d.ownDays, ...Object.values(d.otherDays)]).reduce((s, x) => s + x.points, 0);

describe('sync codes', () => {
  it('generates readable codes and normalizes typing variations', async () => {
    const c = generateCode();
    expect(c).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){5}$/);
    const raw = c.replace(/-/g, '');
    expect(normalizeCode(raw.toLowerCase())).toBe(raw);
    expect(normalizeCode(c.replace(/-/g, ' '))).toBe(raw);
    expect(normalizeCode('too-short')).toBe('');
    expect(normalizeCode('OIL0'.repeat(6))).toBe('0110'.repeat(6)); // look-alikes
    expect(formatCode(raw)).toBe(c);
    const a = await syncIdFor(c);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(await syncIdFor(c.toLowerCase())).toBe(a);
    expect(await syncIdFor(generateCode())).not.toBe(a);
  });
});

describe('deck versions', () => {
  it('keeps v1 chunk names and gives later decks their own', async () => {
    const { progressChunk } = await import('./core');
    expect(progressChunk(5)).toBe('p5');
    expect(progressChunk(5, 2)).toBe('v2p5');
    expect(allChunkIds([1, 2], 2)).toEqual(['v2p1', 'v2p2', 'days', 'settings']);
  });
  it('a v2 device ignores v1 progress chunks', async () => {
    const remote = new FakeRemote();
    let old = device('old', { progress: [p(1, 1, 1000)] });
    old = await sync(remote, old, 1100); // writes p1
    let fresh = device('new', { deck: 2, dirty: allChunkIds(LEVELS, 2) });
    fresh = await sync(remote, fresh, 1200);
    expect(fresh.progress).toEqual([]);
    expect(remote.docs.has('v2p1')).toBe(false); // nothing to write for an empty level
    fresh = { ...fresh, progress: [p(7, 2, 1300)], dirty: ['v2p2'] };
    await sync(remote, fresh, 1400);
    expect(remote.docs.has('v2p2')).toBe(true);
  });
});

describe('merge', () => {
  it('keeps the most recently answered record per sentence', () => {
    const m = mergeProgress([p(1, 1, 100, 2), p(2, 1, 50)], [p(1, 1, 90, 3), p(3, 1, 70)], 0);
    expect(m.find((x) => x.id === 1)!.stage).toBe(2);
    expect(m.map((x) => x.id).sort()).toEqual([1, 2, 3]);
  });
  it('drops records answered before a reset', () => {
    expect(mergeProgress([p(1, 1, 100)], [p(2, 1, 300)], 200).map((x) => x.id)).toEqual([2]);
  });
  it('encodes canonically', () => {
    expect(encodeProgress([p(2, 1, 5), p(1, 1, 5)])).toBe(encodeProgress([p(1, 1, 5), p(2, 1, 5)]));
  });
});

describe('two devices', () => {
  it('first device uploads, second device downloads and merges its own progress', async () => {
    const remote = new FakeRemote();
    let A = device('A', { progress: [p(1, 1, 1000), p(5, 2, 1000)], ownDays: [day('2026-11-03', 40)] });
    let B = device('B', { progress: [p(9, 3, 1500)], ownDays: [day('2026-11-03', 8)] });
    A = await sync(remote, A, 2000);
    B = await sync(remote, B, 3000);
    expect(ids(B)).toEqual([1, 5, 9]);
    A = await sync(remote, A, 4000);
    expect(ids(A)).toEqual([1, 5, 9]);
    expect(totalPoints(A)).toBe(48);
    expect(totalPoints(B)).toBe(48);
    expect(A.dirty).toEqual([]);
  });

  it('the same sentence answered on both devices: the later answer wins', async () => {
    const remote = new FakeRemote();
    let A = device('A', { progress: [p(1, 1, 1000, 1)] });
    let B = device('B');
    A = await sync(remote, A, 1100);
    B = await sync(remote, B, 1200);
    // offline on both: A answers wrong at t=2000, B answers right at t=3000
    A = { ...A, progress: [p(1, 1, 2000, 0, { wrong: 1 })], dirty: ['p1'] };
    B = { ...B, progress: [p(1, 1, 3000, 2)], dirty: ['p1'] };
    A = await sync(remote, A, 3500);
    B = await sync(remote, B, 3600);
    A = await sync(remote, A, 3700);
    expect(A.progress[0].stage).toBe(2);
    expect(B.progress[0].stage).toBe(2);
  });

  it('does nothing (one read) when nothing changed', async () => {
    const remote = new FakeRemote();
    let A = device('A', { progress: [p(1, 1, 1000)] });
    A = await sync(remote, A, 2000);
    const [r0, w0] = [remote.reads, remote.writes];
    A = await sync(remote, A, 3000);
    expect(remote.reads - r0).toBe(1); // meta only
    expect(remote.writes - w0).toBe(0);
  });

  it('only uploads the level that changed', async () => {
    const remote = new FakeRemote();
    let A = device('A', { progress: [p(1, 1, 1000), p(2, 2, 1000)] });
    A = await sync(remote, A, 2000);
    const w0 = remote.writes;
    A = { ...A, progress: [...A.progress, p(3, 2, 2500)], ownDays: [day('2026-11-03', 4)], dirty: ['p2', 'days'] };
    A = await sync(remote, A, 3000);
    expect(remote.writes - w0).toBe(3); // p2 + days + meta
  });

  it('newer settings win', async () => {
    const remote = new FakeRemote();
    let A = device('A', { settings: { ...DEFAULT_SETTINGS, dailyGoal: 500 }, settingsUpdated: 1000 });
    let B = device('B');
    A = await sync(remote, A, 1100);
    B = await sync(remote, B, 1200);
    expect(B.settings.dailyGoal).toBe(500);
    B = { ...B, settings: { ...B.settings, mode: 'text' }, settingsUpdated: 2000, dirty: ['settings'] };
    B = await sync(remote, B, 2100);
    A = await sync(remote, A, 2200);
    expect(A.settings.mode).toBe('text');
  });

  it('a reset on one device clears progress and points on the other', async () => {
    const remote = new FakeRemote();
    let A = device('A', { progress: [p(1, 1, 1000)], ownDays: [day('2026-11-01', 100)] });
    let B = device('B', { progress: [p(2, 1, 1000)], ownDays: [day('2026-11-02', 50)] });
    A = await sync(remote, A, 1100);
    B = await sync(remote, B, 1200);
    A = await sync(remote, A, 1300);
    expect(ids(A)).toEqual([1, 2]);
    // A resets, then plays one sentence
    A = { ...A, progress: [p(3, 1, 5000)], ownDays: [day('2026-11-03', 4)], otherDays: {}, resetAt: 4000, dirty: allChunkIds(LEVELS) };
    A = await sync(remote, A, 5100);
    B = await sync(remote, B, 5200);
    expect(ids(B)).toEqual([3]);
    expect(totalPoints(B)).toBe(4);
    expect(B.resetAt).toBe(4000);
    const days = decodeDays(remote.docs.get('days')!.data);
    expect(Object.keys(days)).toEqual(['A']);
  });

  it('local answers made while a sync was running are not overwritten', () => {
    const before = device('A', { progress: [p(1, 1, 1000, 1)] });
    const result = {
      progressPut: [p(1, 1, 900, 3)], progressDelete: [], ownDays: null, otherDays: {}, settings: null,
      resetAt: 0, lastSeen: {}, wrote: [],
    };
    const after = applyResult({ ...before, progress: [p(1, 1, 2000, 2)] }, result, []);
    expect(after.progress[0].stage).toBe(2);
  });
});
