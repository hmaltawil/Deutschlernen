/** Sentence deck: types and lazy loading of level files from /deck. */

export type AudioLicense = 'BY' | 'BY-NC';

export interface Item {
  /** Tatoeba sentence id */
  id: number;
  /** full German sentence */
  de: string;
  /** [start, end) character offsets of the cloze word in `de` */
  c: [number, number];
  /** the cloze word exactly as written in the sentence */
  a: string;
  /** English translation */
  en: string;
  /** three multiple-choice distractors */
  d: string[];
  /** frequency rank of the cloze word (1 = most common) */
  r: number;
  /** native-speaker recording: [audioId, speaker, licence] */
  au?: [number, string, AudioLicense];
  /** where the recording sits in its level bundle (audio/level-NN.pack): [offset, length] */
  ap?: [number, number];
  /** deck level this item belongs to (added on load) */
  lv: number;
}

export interface LevelInfo {
  n: number;
  file: string;
  count: number;
  audio: number;
  minRank: number;
  maxRank: number;
  /** typical (median) frequency rank of the missing words */
  medianRank?: number;
  /** average words per sentence */
  avgWords?: number;
  /** share of sentences with complex grammar (clauses, Konjunktiv, passive, …) */
  complex?: number;
  /** bundle of this level's recordings, and its size */
  pack?: string;
  packBytes?: number;
}

export interface Manifest {
  version: number;
  total: number;
  audio: number;
  words: number;
  /** total size of the stored recordings (set by scripts/fetch_audio.py) */
  audioBytes?: number;
  levels: LevelInfo[];
  credits: { sentences: string; audio: string };
}

const base = import.meta.env.BASE_URL;
let manifestPromise: Promise<Manifest> | null = null;
const levelCache = new Map<number, Promise<Item[]>>();
const byId = new Map<number, Item>();

export function loadManifest(): Promise<Manifest> {
  manifestPromise ??= fetch(`${base}deck/manifest.json`).then((r) => {
    if (!r.ok) throw new Error(`manifest: HTTP ${r.status}`);
    return r.json();
  });
  return manifestPromise;
}

export function loadLevel(n: number): Promise<Item[]> {
  let p = levelCache.get(n);
  if (!p) {
    p = loadManifest()
      .then((m) => {
        const info = m.levels.find((l) => l.n === n);
        if (!info) throw new Error(`no level ${n}`);
        return fetch(`${base}deck/${info.file}`);
      })
      .then((r) => {
        if (!r.ok) throw new Error(`level ${n}: HTTP ${r.status}`);
        return r.json() as Promise<Omit<Item, 'lv'>[]>;
      })
      .then((raw) => {
        const items = raw.map((it) => ({ ...it, lv: n }) as Item);
        for (const it of items) byId.set(it.id, it);
        return items;
      });
    p.catch(() => levelCache.delete(n));
    levelCache.set(n, p);
  }
  return p;
}

/** Which level every sentence of the current deck is in (loads all level files). */
export async function levelIndex(): Promise<Map<number, number>> {
  const m = await loadManifest();
  const all = await Promise.all(m.levels.map((l) => loadLevel(l.n)));
  const out = new Map<number, number>();
  m.levels.forEach((l, i) => {
    for (const it of all[i]) out.set(it.id, l.n);
  });
  return out;
}

/** Load the given items (grouped by level) and return them in the requested order. */
export async function getItems(refs: { id: number; lv: number }[]): Promise<Item[]> {
  const levels = [...new Set(refs.map((r) => r.lv))];
  await Promise.all(levels.map(loadLevel));
  return refs.map((r) => byId.get(r.id)).filter((x): x is Item => !!x);
}

/** A recording bundle on the website (name from the manifest; it includes a content fingerprint). */
export function packUrl(name: string): string {
  return `${base}audio/${name}`;
}

export interface BundleInfo {
  name: string;
  size: number;
}

/** Recording bundle of each level, from the manifest. */
export async function bundles(): Promise<Map<number, BundleInfo>> {
  const m = await loadManifest();
  return new Map(m.levels.filter((l) => l.pack && l.packBytes).map((l) => [l.n, { name: l.pack!, size: l.packBytes! }]));
}

/** The original on tatoeba.org — fallback if the local copy is missing. */
export function remoteAudioUrl(au: NonNullable<Item['au']>): string {
  return `https://tatoeba.org/en/audio/download/${au[0]}`;
}

export function tatoebaUrl(id: number): string {
  return `https://tatoeba.org/en/sentences/show/${id}`;
}

/** Short description of a level's difficulty, e.g. "typical word #1,200 · ~6 words · 9% complex grammar". */
export function levelSummary(l: LevelInfo): string {
  const parts: string[] = [];
  if (l.medianRank) parts.push(`typical word #${l.medianRank.toLocaleString()}`);
  if (l.avgWords) parts.push(`~${Math.round(l.avgWords)} words per sentence`);
  if (l.complex !== undefined && l.complex >= 0.05) parts.push(`${Math.round(l.complex * 100)}% complex grammar`);
  return parts.length ? parts.join(' · ') : `words #${l.minRank.toLocaleString()}–${l.maxRank.toLocaleString()}`;
}
