import { describe, expect, it } from 'vitest';
import { favoriteIds, favoriteRefs, isOftenMissed, oftenMissed } from './lists';
import { markKnown, newProgress, review } from './srs';

const T = 1_000_000;
const wrongTwice = (id: number) => review(review(newProgress(id, 2, T), false, T), false, T + 10);

describe('practice lists', () => {
  it('often missed: wrong at least twice, until 75%', () => {
    const p = wrongTwice(1);
    expect(isOftenMissed(p)).toBe(true);
    expect(isOftenMissed(review(newProgress(2, 1, T), false, T))).toBe(false); // only once
    let q = p;
    for (let i = 0; i < 3; i++) q = review(q, true, T + 100 + i);
    expect(q.stage).toBe(3);
    expect(isOftenMissed(q)).toBe(false); // 75%: off the list
    expect(isOftenMissed(markKnown(p, T + 50))).toBe(false);
  });
  it('often missed: the shakiest first', () => {
    const a = review(wrongTwice(1), true, T + 20); // stage 1
    const b = review(wrongTwice(2), false, T + 30); // wrong 3 times, stage 0
    const c = wrongTwice(3); // wrong twice, stage 0
    expect(oftenMissed([a, b, c]).map((p) => p.id)).toEqual([2, 3, 1]);
  });
  it('favourites: only starred ones, least recently played first', () => {
    const favs = { 1: [1, 100, 2], 2: [0, 200, 2], 3: [1, 300, 5], 4: [1, 50, 1] } as const;
    const progress = new Map([[1, { ...newProgress(1, 2, T), last: T + 9 }], [3, { ...newProgress(3, 5, T), last: T + 1 }]]);
    expect([...favoriteIds(favs as never)].sort()).toEqual([1, 3, 4]);
    expect(favoriteRefs(favs as never, progress)).toEqual([{ id: 4, lv: 1 }, { id: 3, lv: 5 }, { id: 1, lv: 2 }]);
  });
});
