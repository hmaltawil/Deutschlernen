import { describe, expect, it } from 'vitest';
import { addDays, dayKey, emptyDay, goalOn, pointsFor, streaks, withGoalChange } from './scoring';

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
  it('changing the daily goal does not rewrite earlier days', () => {
    const days = ['2026-11-01', '2026-11-02', '2026-11-03'].map((d) => day(d, 250));
    const today = '2026-11-04';
    expect(streaks(days, 200, today).current).toBe(3);
    // raise the goal to 300 today: the three days played at 200 still count
    const h = withGoalChange(undefined, 200, 300, today);
    expect(streaks(days, 300, today, h)).toEqual({ current: 3, best: 3, todayMet: false });
    expect(streaks([...days, day(today, 250)], 300, today, h).todayMet).toBe(false); // today needs 300
    expect(streaks([...days, day(today, 300)], 300, today, h).current).toBe(4);
    // lowering it doesn't turn missed days into streak days
    const low = [day('2026-11-01', 60), day('2026-11-02', 60)];
    expect(streaks(low, 50, today, withGoalChange(undefined, 100, 50, today)).best).toBe(0);
    // tomorrow, today is judged by the goal it was played with
    expect(goalOn(today, '2026-11-05', 300, h)).toBe(300);
    expect(goalOn('2026-11-03', '2026-11-05', 300, h)).toBe(200);
  });
  it('keeps one entry per day when the goal is changed several times', () => {
    let h = withGoalChange(undefined, 200, 300, '2026-11-04');
    h = withGoalChange(h, 300, 500, '2026-11-04');
    expect(h).toEqual([['', 200], ['2026-11-04', 500]]);
    h = withGoalChange(h, 500, 200, '2026-11-04'); // back to where the day started
    expect(h).toEqual([['', 200]]);
    h = withGoalChange(h, 200, 100, '2026-11-09');
    expect(h).toEqual([['', 200], ['2026-11-09', 100]]);
  });
});
