/** Practice lists: favourite sentences, and sentences you keep getting wrong. */
import type { Favorites } from './sync/core';
import type { Progress } from './srs';

export interface Ref {
  id: number;
  lv: number;
}

/** Got wrong at least twice and not yet at 75%: leaves the list once you know it well. */
export const isOftenMissed = (p: Progress) => !p.known && p.wrong >= 2 && p.stage < 3;

/** Often missed sentences, the shakiest first. */
export function oftenMissed(progress: Iterable<Progress>): Progress[] {
  return [...progress].filter(isOftenMissed).sort((a, b) => a.stage - b.stage || b.wrong - a.wrong || a.last - b.last);
}

export function favoriteIds(favs: Favorites): Set<number> {
  return new Set(Object.entries(favs).filter(([, v]) => v[0] === 1).map(([id]) => Number(id)));
}

/** Favourites to practise, the ones you haven't played for longest first (never played first of all). */
export function favoriteRefs(favs: Favorites, progress: Map<number, Progress>): Ref[] {
  return Object.entries(favs)
    .filter(([, v]) => v[0] === 1)
    .map(([id, v]) => ({ id: Number(id), lv: v[2], last: progress.get(Number(id))?.last ?? 0, starred: v[1] }))
    .sort((a, b) => a.last - b.last || b.starred - a.starred)
    .map(({ id, lv }) => ({ id, lv }));
}
