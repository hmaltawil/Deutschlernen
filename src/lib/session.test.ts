import { describe, expect, it } from 'vitest';
import type { Item } from './deck';
import { choices, currentLevel, makeCards, pickNew, pickReviews, requeue } from './session';
import { newProgress } from './srs';

const item = (id: number, lv = 1): Item => ({
  id, lv, de: 'Ich habe Hunger.', c: [4, 8], a: 'habe', en: 'I am hungry.', d: ['bin', 'hast', 'gibt'], r: 10,
});

describe('session', () => {
  const T = 1_000_000;
  it('takes due reviews first, oldest first, up to round size', () => {
    const prog = [
      { ...newProgress(1, 1, T), due: T - 10 },
      { ...newProgress(2, 1, T), due: T + 999 },
      { ...newProgress(3, 1, T), due: T - 50 },
    ];
    expect(pickReviews(prog, T, 10, 'mixed').map((p) => p.id)).toEqual([3, 1]);
    expect(pickReviews(prog, T, 1, 'review').map((p) => p.id)).toEqual([3]);
    expect(pickReviews(prog, T, 10, 'new')).toEqual([]);
  });
  it('picks unplayed new items walking up levels', async () => {
    const levels: Record<number, Item[]> = { 1: [item(1), item(2)], 2: [item(3, 2), item(4, 2)] };
    const loaded: number[] = [];
    const got = await pickNew(new Set([1]), 2, 1, 2, async (lv) => (loaded.push(lv), levels[lv]));
    expect(got.map((i) => i.id)).toEqual([2, 3]);
    expect(loaded).toEqual([1, 2]);
  });
  it('builds cards with reviews before new items', () => {
    const cards = makeCards([item(5)], [item(6)]);
    expect(cards.map((c) => [c.item.id, c.isNew])).toEqual([[5, false], [6, true]]);
  });
  it('requeues a wrong answer once at the end', () => {
    let cards = makeCards([], [item(1), item(2)]);
    cards = requeue(cards, 0, false);
    expect(cards.map((c) => c.item.id)).toEqual([1, 2, 1]);
    expect(cards[2].retry).toBe(true);
    // wrong again on the retry: no further requeue
    expect(requeue(cards, 2, false)).toHaveLength(3);
    // correct: unchanged
    expect(requeue(cards, 1, true)).toHaveLength(3);
  });
  it('finds the current level', () => {
    const sizes = [{ n: 1, count: 2 }, { n: 2, count: 2 }];
    expect(currentLevel(new Map(), sizes)).toBe(1);
    expect(currentLevel(new Map([[1, 2]]), sizes)).toBe(2);
    expect(currentLevel(new Map([[1, 2], [2, 2]]), sizes)).toBe(2);
  });
  it('continues from the level you chose, moving on when it is finished', () => {
    const sizes = [1, 2, 3, 4].map((n) => ({ n, count: 2 }));
    expect(currentLevel(new Map(), sizes, 3)).toBe(3); // chose level 3
    expect(currentLevel(new Map([[3, 2]]), sizes, 3)).toBe(4); // level 3 done → 4
    expect(currentLevel(new Map([[3, 2], [4, 2]]), sizes, 3)).toBe(1); // nothing left above → first open level
    expect(currentLevel(new Map([[1, 1]]), sizes, 1)).toBe(1); // going back to a lower level works too
  });
  it('shuffles choices deterministically and includes the answer', () => {
    const a = choices(item(42));
    expect(a).toHaveLength(4);
    expect(new Set(a)).toEqual(new Set(['habe', 'bin', 'hast', 'gibt']));
    expect(choices(item(42))).toEqual(a);
  });
  it('puts the answer on each of the four buttons about equally often', () => {
    // Tatoeba ids go up to ~13 million; check small and large ids
    for (const start of [1, 9_000_000]) {
      const pos = [0, 0, 0, 0];
      const n = 20_000;
      for (let id = start; id < start + n; id++) pos[choices(item(id)).indexOf('habe')]++;
      for (const c of pos) expect(Math.abs(c / n - 0.25)).toBeLessThan(0.015);
    }
  });
});
