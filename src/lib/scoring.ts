/** Points, daily stats, goals and streaks. */
import type { Mode } from './session';

export const BASE_POINTS: Record<Mode, number> = { mc: 4, text: 8, listen: 10 };
export const COMBO_STEP = 0.1;
export const COMBO_CAP = 5;

/** `combo` = correct answers in a row before this one. */
export function pointsFor(mode: Mode, combo: number, hintUsed: boolean): number {
  const mult = 1 + Math.min(Math.max(combo, 0), COMBO_CAP) * COMBO_STEP;
  return Math.round(BASE_POINTS[mode] * mult * (hintUsed ? 0.5 : 1));
}

export interface DayStat {
  date: string; // YYYY-MM-DD, local time
  points: number;
  correct: number;
  wrong: number;
  learned: number; // new sentences answered correctly for the first time
  reviewed: number; // review answers
}

export function emptyDay(date: string): DayStat {
  return { date, points: 0, correct: 0, wrong: 0, learned: 0, reviewed: 0 };
}

const pad = (n: number) => String(n).padStart(2, '0');

export function dayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function addDays(key: string, n: number): string {
  const [y, m, d] = key.split('-').map(Number);
  // noon avoids DST edge cases
  return dayKey(new Date(y, m - 1, d + n, 12).getTime());
}

export interface Streak {
  current: number;
  best: number;
  todayMet: boolean;
}

/**
 * A streak day = a day whose points reached the goal.
 * The current streak is still alive if today is not met yet but yesterday was.
 */
export function streaks(days: Iterable<DayStat>, goal: number, today: string): Streak {
  const met = new Set<string>();
  for (const d of days) if (d.points >= goal && d.points > 0) met.add(d.date);
  const todayMet = met.has(today);
  let current = 0;
  let cursor = todayMet ? today : addDays(today, -1);
  while (met.has(cursor)) {
    current++;
    cursor = addDays(cursor, -1);
  }
  let best = 0;
  for (const date of met) {
    if (met.has(addDays(date, -1))) continue; // not the start of a run
    let run = 0;
    let c = date;
    while (met.has(c)) {
      run++;
      c = addDays(c, 1);
    }
    best = Math.max(best, run);
  }
  return { current, best, todayMet };
}
