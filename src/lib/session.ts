/** Round building: due reviews first, then new sentences in level order. */
import type { Item } from './deck';
import { dueList, type Progress } from './srs';

export type Mode = 'mc' | 'text' | 'listen' | 'dictation';
export type RoundKind = 'mixed' | 'review' | 'new' | 'fav' | 'missed';

export interface Card {
  item: Item;
  /** first time this sentence is played */
  isNew: boolean;
  /** re-shown at the end of the round after a wrong answer (practice only) */
  retry: boolean;
}

/** Due reviews to include in a round. */
export function pickReviews(progress: Iterable<Progress>, now: number, size: number, kind: RoundKind): Progress[] {
  if (kind !== 'mixed' && kind !== 'review') return [];
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

/**
 * The level to continue with: the level you chose last (or 1), moving on to the next
 * level once it has no unplayed sentences left.
 */
export function currentLevel(
  playedPerLevel: Map<number, number>,
  levelSizes: { n: number; count: number }[],
  chosen = 1,
): number {
  const open = (l: { n: number; count: number }) => (playedPerLevel.get(l.n) ?? 0) < l.count;
  for (const l of levelSizes) if (l.n >= chosen && open(l)) return l.n;
  for (const l of levelSizes) if (open(l)) return l.n;
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

/**
 * Small deterministic random numbers in [0, 1) from a seed (mulberry32).
 * All arithmetic stays within 32 bits (Math.imul): plain `seed * bigNumber` loses its
 * low bits once it passes 2^53, which made the old shuffle put the answer on button 1
 * almost never and on button 4 about half the time.
 */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Multiple-choice options: answer + distractors in a stable per-sentence shuffled order. */
export function choices(item: Item): string[] {
  const opts = [item.a, ...item.d];
  const rand = seededRandom(item.id);
  for (let i = opts.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [opts[i], opts[j]] = [opts[j], opts[i]];
  }
  return opts;
}
