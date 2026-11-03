import { describe, expect, it } from 'vitest';
import { addDays, dayKey, emptyDay, pointsFor, streaks } from './scoring';

const day = (date: string, points: number) => ({ ...emptyDay(date), points });

describe('scoring', () => {
  it('awards base points per mode with a capped combo bonus', () => {
    expect(pointsFor('mc', 0, false)).toBe(4);
    expect(pointsFor('text', 0, false)).toBe(8);
    expect(pointsFor('listen', 0, false)).toBe(10);
    expect(pointsFor('text', 2, false)).toBe(10); // 8 * 1.2 = 9.6
    expect(pointsFor('listen', 50, false)).toBe(15); // capped at +50%
    expect(pointsFor('text', 0, true)).toBe(4);
  });
  it('formats and shifts local day keys across month/year ends', () => {
    expect(dayKey(new Date(2026, 0, 5, 23, 59).getTime())).toBe('2026-01-05');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2026-03-29', 1)).toBe('2026-03-30'); // DST change in Europe
  });
  it('computes current and best streaks', () => {
    const goal = 100;
    const days = [
      day('2026-10-28', 120), day('2026-10-29', 150), day('2026-10-30', 100), // run of 3
      day('2026-10-31', 20), // missed goal
      day('2026-11-01', 200), day('2026-11-02', 101),
    ];
    // today (11-03) not played yet: streak still alive from yesterday
    expect(streaks(days, goal, '2026-11-03')).toEqual({ current: 2, best: 3, todayMet: false });
    // today met
    expect(streaks([...days, day('2026-11-03', 100)], goal, '2026-11-03')).toEqual({ current: 3, best: 3, todayMet: true });
    // a gap breaks it
    expect(streaks(days, goal, '2026-11-05').current).toBe(0);
    expect(streaks([], goal, '2026-11-05')).toEqual({ current: 0, best: 0, todayMet: false });
  });
});
