/**
 * Spaced repetition.
 * stage 0 = new / failed (0%), stages 1–4 = 25/50/75/100% mastery.
 * A correct answer moves up one stage and schedules the next review after
 * intervals[stage-1] days; at 100% it keeps being reviewed every last interval.
 * A wrong answer drops to stage 0 and is due again immediately.
 */

export const DAY = 24 * 60 * 60 * 1000;
export const DEFAULT_INTERVALS: [number, number, number, number] = [1, 7, 30, 120];
export const MAX_STAGE = 4;

export interface Progress {
  id: number;
  /** deck level of the sentence */
  lv: number;
  stage: number;
  /** epoch ms when the sentence is due for review */
  due: number;
  correct: number;
  wrong: number;
  first: number;
  last: number;
}

export function newProgress(id: number, lv: number, now: number): Progress {
  return { id, lv, stage: 0, due: now, correct: 0, wrong: 0, first: now, last: now };
}

export function review(
  p: Progress,
  correct: boolean,
  now: number,
  intervals: readonly number[] = DEFAULT_INTERVALS,
): Progress {
  if (!correct) {
    return { ...p, stage: 0, due: now, wrong: p.wrong + 1, last: now };
  }
  const stage = Math.min(p.stage + 1, MAX_STAGE);
  const days = intervals[stage - 1] ?? intervals[intervals.length - 1];
  return { ...p, stage, due: now + days * DAY, correct: p.correct + 1, last: now };
}

export function mastery(stage: number): number {
  return Math.round((Math.max(0, Math.min(stage, MAX_STAGE)) / MAX_STAGE) * 100);
}

export function isDue(p: Progress, now: number): boolean {
  return p.due <= now;
}

export function dueList(all: Iterable<Progress>, now: number): Progress[] {
  const out: Progress[] = [];
  for (const p of all) if (p.due <= now) out.push(p);
  return out.sort((a, b) => a.due - b.due || a.id - b.id);
}
