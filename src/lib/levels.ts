/** Per-level numbers for the level cards on Home, and which levels are shown there. */
import { isDue, isMastered, type Progress } from './srs';

export interface LevelStat {
  /** sentences played at least once */
  played: number;
  /** at 100% (or marked known) */
  mastered: number;
  /** due for review now */
  due: number;
  /** played for the first time today */
  newToday: number;
  /** answered today, first played earlier */
  reviewedToday: number;
  /** last answer in this level (ms), 0 if none */
  lastPlayed: number;
}

const empty = (): LevelStat => ({ played: 0, mastered: 0, due: 0, newToday: 0, reviewedToday: 0, lastPlayed: 0 });

export function levelStats(progress: Iterable<Progress>, now: number): Map<number, LevelStat> {
  const startOfToday = new Date(now).setHours(0, 0, 0, 0);
  const out = new Map<number, LevelStat>();
  for (const p of progress) {
    let s = out.get(p.lv);
    if (!s) out.set(p.lv, (s = empty()));
    s.played++;
    if (isMastered(p)) s.mastered++;
    if (isDue(p, now)) s.due++;
    if (p.last >= startOfToday) {
      if (p.first >= startOfToday) s.newToday++;
      else s.reviewedToday++;
    }
    if (p.last > s.lastPlayed) s.lastPlayed = p.last;
  }
  return out;
}

export const statOf = (stats: Map<number, LevelStat>, lv: number): LevelStat => stats.get(lv) ?? empty();

/** Until you change the list: every level you have played, plus the level you are on. */
export function defaultPinned(stats: Map<number, LevelStat>, current: number): number[] {
  return [...new Set([...stats.keys(), current])].sort((a, b) => a - b);
}

/** Levels shown on Home, in level order. */
export function homeLevels(pinned: number[] | undefined, stats: Map<number, LevelStat>, current: number, levelCount: number): number[] {
  const list = [...new Set(pinned ?? defaultPinned(stats, current))].filter((lv) => lv >= 1 && lv <= levelCount);
  return list.sort((a, b) => a - b);
}

/** The pinned list after adding/removing levels; null if nothing changes. */
export function withPinned(pinned: number[] | undefined, fallback: number[], levels: number[], on: boolean): number[] | null {
  const cur = pinned ?? fallback;
  if (levels.every((lv) => cur.includes(lv) === on)) return null;
  return on ? [...new Set([...cur, ...levels])].sort((a, b) => a - b) : cur.filter((lv) => !levels.includes(lv));
}
