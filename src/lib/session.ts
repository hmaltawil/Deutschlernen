/** Round building: due reviews first, then new sentences in level order. */
import type { Item } from './deck';
import { dueList, type Progress } from './srs';

export type Mode = 'mc' | 'text' | 'listen';
export type RoundKind = 'mixed' | 'review' | 'new';

export interface Card {
  item: Item;
  /** first time this sentence is played */
  isNew: boolean;
  /** re-shown at the end of the round after a wrong answer (practice only) */
  retry: boolean;
}

/** Due reviews to include in a round. */
export function pickReviews(progress: Iterable<Progress>, now: number, size: number, kind: RoundKind): Progress[] {
  if (kind === 'new') return [];
  return dueList(progress, now).slice(0, size);
}

/**
 * Pick `count` unplayed items, walking levels upward from `fromLevel`.
 * `load` returns the items of a level (in deck order).
 */
export async function pickNew(
  played: { has(id: number): boolean },
  count: number,
  fromLevel: number,
  levelCount: number,
  load: (lv: number) => Promise<Item[]>,
): Promise<Item[]> {
  const out: Item[] = [];
  for (let lv = Math.max(1, fromLevel); lv <= levelCount && out.length < count; lv++) {
    const items = await load(lv);
    for (const it of items) {
      if (out.length >= count) break;
      if (!played.has(it.id)) out.push(it);
    }
  }
  return out;
}

/** First level that still has unplayed sentences (1 if nothing played). */
export function currentLevel(playedPerLevel: Map<number, number>, levelSizes: { n: number; count: number }[]): number {
  for (const l of levelSizes) if ((playedPerLevel.get(l.n) ?? 0) < l.count) return l.n;
  return levelSizes.length ? levelSizes[levelSizes.length - 1].n : 1;
}

/** Round order: due reviews first, then new sentences. */
export function makeCards(reviews: Item[], fresh: Item[]): Card[] {
  return [
    ...reviews.map((item) => ({ item, isNew: false, retry: false })),
    ...fresh.map((item) => ({ item, isNew: true, retry: false })),
  ];
}

/** After answering card `index`: a wrong first attempt is appended once more at the end. */
export function requeue(cards: Card[], index: number, correct: boolean): Card[] {
  const card = cards[index];
  if (correct || card.retry) return cards;
  if (cards.slice(index + 1).some((c) => c.item.id === card.item.id)) return cards;
  return [...cards, { item: card.item, isNew: false, retry: true }];
}

/** Multiple-choice options: answer + distractors in a stable per-sentence shuffled order. */
export function choices(item: Item): string[] {
  const opts = [item.a, ...item.d];
  let seed = item.id;
  for (let i = opts.length - 1; i > 0; i--) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const j = seed % (i + 1);
    [opts[i], opts[j]] = [opts[j], opts[i]];
  }
  return opts;
}
