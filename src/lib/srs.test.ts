import { describe, expect, it } from 'vitest';
import { DAY, dueList, isDue, isMastered, markKnown, mastery, newProgress, review, shownStage, unmarkKnown } from './srs';

const T0 = Date.UTC(2026, 10, 3);

describe('srs', () => {
  it('moves up one stage per correct answer with growing intervals', () => {
    let p = newProgress(1, 1, T0);
    const expected = [1, 7, 30, 120, 120];
    let now = T0;
    for (const [i, days] of expected.entries()) {
      p = review(p, true, now);
      expect(p.stage).toBe(Math.min(i + 1, 4));
      expect(p.due).toBe(now + days * DAY);
      now = p.due;
    }
    expect(p.correct).toBe(5);
    expect(mastery(p.stage)).toBe(100);
  });
  it('resets to stage 0 and is due immediately after a wrong answer', () => {
    let p = review(review(newProgress(1, 1, T0), true, T0), true, T0 + DAY);
    expect(p.stage).toBe(2);
    p = review(p, false, T0 + 9 * DAY);
    expect(p.stage).toBe(0);
    expect(p.due).toBe(T0 + 9 * DAY);
    expect(p.wrong).toBe(1);
    expect(mastery(p.stage)).toBe(0);
  });
  it('respects custom intervals', () => {
    const p = review(newProgress(1, 1, T0), true, T0, [2, 4, 8, 16]);
    expect(p.due).toBe(T0 + 2 * DAY);
  });
  it('lists due items oldest first', () => {
    const a = { ...newProgress(1, 1, T0), due: T0 + 5 };
    const b = { ...newProgress(2, 1, T0), due: T0 + 1 };
    const c = { ...newProgress(3, 1, T0), due: T0 + DAY };
    expect(dueList([a, b, c], T0 + 10).map((p) => p.id)).toEqual([2, 1]);
  });
  it('mastery percentages', () => {
    expect([0, 1, 2, 3, 4].map(mastery)).toEqual([0, 25, 50, 75, 100]);
  });
  it('known sentences count as mastered and never come due', () => {
    const p = markKnown(review(newProgress(1, 1, T0), false, T0), T0 + 5);
    expect(p.known).toBe(true);
    expect(mastery(shownStage(p))).toBe(100);
    expect(isMastered(p)).toBe(true);
    expect(isDue(p, T0 + 50 * 365 * DAY)).toBe(false);
    expect(dueList([p], T0 + 50 * 365 * DAY)).toEqual([]);
    expect(new Date(p.due).getFullYear()).toBeGreaterThan(2100); // still a valid date
  });
  it('"Review again" brings a known sentence back at the stage it had before', () => {
    const learning = review(newProgress(1, 1, T0), true, T0); // 25%
    const back = unmarkKnown(markKnown(learning, T0 + 5), T0 + 9);
    expect(back.known).toBeUndefined();
    expect(back.stage).toBe(1);
    expect(isDue(back, T0 + 9)).toBe(true);
    expect(isMastered(back)).toBe(false);
    // one correct answer moves it to 50% (7 days), not 100% (120 days)
    expect(review(back, true, T0 + 9).due).toBe(T0 + 9 + 7 * DAY);
  });
  it('answering a known sentence again puts it back into reviews', () => {
    const p = review(markKnown(newProgress(1, 1, T0), T0), false, T0 + 1);
    expect(p.known).toBeUndefined();
    expect(isDue(p, T0 + 1)).toBe(true);
  });
});
