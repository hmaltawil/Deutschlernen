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

/** Load the given items (grouped by level) and return them in the requested order. */
export async function getItems(refs: { id: number; lv: number }[]): Promise<Item[]> {
  const levels = [...new Set(refs.map((r) => r.lv))];
  await Promise.all(levels.map(loadLevel));
  return refs.map((r) => byId.get(r.id)).filter((x): x is Item => !!x);
}

/** The level's recording bundle on the website. */
export function packName(lv: number): string {
  return `level-${String(lv).padStart(2, '0')}.pack`;
}

export function packUrl(lv: number): string {
  return `${base}audio/${packName(lv)}`;
}

/** The original on tatoeba.org — fallback if the local copy is missing. */
export function remoteAudioUrl(au: NonNullable<Item['au']>): string {
  return `https://tatoeba.org/en/audio/download/${au[0]}`;
}

export function tatoebaUrl(id: number): string {
  return `https://tatoeba.org/en/sentences/show/${id}`;
}
