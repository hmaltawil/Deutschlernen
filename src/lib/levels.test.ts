import { describe, expect, it } from 'vitest';
import { defaultPinned, homeLevels, levelStats, statOf, withPinned } from './levels';
import { DAY, markKnown, newProgress, review } from './srs';

const NOW = new Date(2026, 10, 4, 18, 0).getTime();
const TODAY = new Date(2026, 10, 4, 9, 0).getTime();
const EARLIER = NOW - 5 * DAY;

describe('level stats', () => {
  it('counts played, mastered, due, new and reviewed today per level', () => {
    const stats = levelStats(
      [
        review(newProgress(1, 3, TODAY), true, TODAY), // new today
        review(newProgress(2, 3, TODAY), false, TODAY), // new today, wrong → due
        review(review(newProgress(3, 3, EARLIER), true, EARLIER), true, TODAY), // reviewed today
        markKnown(newProgress(4, 3, EARLIER), EARLIER), // known → mastered
        newProgress(5, 7, EARLIER), // other level, due
      ],
      NOW,
    );
    expect(statOf(stats, 3)).toEqual({ played: 4, mastered: 1, due: 1, newToday: 2, reviewedToday: 1, lastPlayed: TODAY });
    expect(statOf(stats, 7)).toMatchObject({ played: 1, due: 1, newToday: 0, reviewedToday: 0 });
    expect(statOf(stats, 9).played).toBe(0);
  });
});

describe('levels on Home', () => {
  const stats = levelStats([newProgress(1, 2, 1000), newProgress(2, 5, 3000), newProgress(3, 9, 2000)], NOW);
  it('by default shows every played level plus the current one, most recently played first', () => {
    expect(defaultPinned(stats, 10)).toEqual([2, 5, 9, 10]);
    expect(homeLevels(undefined, stats, 10, 30)).toEqual([5, 9, 2, 10]);
    expect(homeLevels(undefined, stats, 5, 30)).toEqual([5, 9, 2]);
  });
  it('shows exactly the chosen levels once the list was changed', () => {
    expect(homeLevels([9, 2], stats, 10, 30)).toEqual([9, 2]);
    expect(homeLevels([], stats, 10, 30)).toEqual([]);
    expect(homeLevels([2, 31], stats, 10, 30)).toEqual([2]); // not in the deck
  });
  it('adds and removes levels', () => {
    const fallback = defaultPinned(stats, 10);
    expect(withPinned(undefined, fallback, [9], false)).toEqual([2, 5, 10]);
    expect(withPinned(undefined, fallback, [9], true)).toBeNull(); // already shown: nothing to save
    expect(withPinned([2, 5], fallback, [12], true)).toEqual([2, 5, 12]);
    expect(withPinned([2, 5], fallback, [5], true)).toBeNull();
    expect(withPinned([5, 2], fallback, [2], false)).toEqual([5]);
  });
});
