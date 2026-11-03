// Two simulated devices syncing through the real Firestore emulator, with the real rules.
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { DEFAULT_SETTINGS } from '../src/lib/settings';
import { allChunkIds, applyResult, syncOnce, type LocalState } from '../src/lib/sync/core';
import { generateCode, syncIdFor } from '../src/lib/sync/code';
import { createRemote } from '../src/lib/sync/firestore';
import type { Progress } from '../src/lib/srs';

let env: RulesTestEnvironment;
beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-luecke',
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8085 },
  });
});
afterAll(() => env.cleanup());

const LEVELS = Array.from({ length: 30 }, (_, i) => i + 1);
const p = (id: number, lv: number, last: number, stage = 1): Progress => ({ id, lv, stage, due: last + 1, correct: stage, wrong: 0, first: last, last });
const device = (id: string, progress: Progress[]): LocalState => ({
  deviceId: id, levels: LEVELS, progress, ownDays: [], otherDays: {}, settings: { ...DEFAULT_SETTINGS }, settingsUpdated: 0,
  resetAt: 0, lastSeen: {}, dirty: allChunkIds(LEVELS),
});

describe('sync through Firestore', () => {
  const remote = createRemote({ projectId: 'demo-luecke', apiKey: 'demo', appId: 'demo' }, '127.0.0.1:8085');

  it('merges two devices, including concurrent syncs', async () => {
    const syncId = await syncIdFor(generateCode());
    const run = async (d: LocalState, now: number) => {
      const dirty = [...d.dirty];
      return applyResult(d, await remote.transact(syncId, (tx) => syncOnce(d, tx, now)), dirty);
    };
    // a full level of 1000 sentences fits in one document
    const big = Array.from({ length: 1000 }, (_, i) => p(1_000_000 + i, 1, 1000 + i, 3));
    let A = device('A', [...big, p(7, 2, 500)]);
    let B = device('B', [p(8, 3, 600)]);
    // both sync at the same time: transactions retry so neither upload is lost
    [A, B] = await Promise.all([run(A, 2000), run(B, 2001)]);
    A = await run(A, 3000);
    B = await run(B, 3001);
    expect(A.progress.length).toBe(1002);
    expect(B.progress.length).toBe(1002);
  });
});
