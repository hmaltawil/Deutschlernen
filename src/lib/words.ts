/**
 * Word info shown after an answer: base form, der/die/das + plural, verb forms, meaning.
 * Built from Wiktionary by scripts/build_words.py into public/deck/words/level-NN.json
 * (one file per level, keyed by sentence id), loaded the first time a level's info is needed.
 */

export interface WordInfo {
  /** base form */
  l: string;
  /** part of speech: noun, verb, adjective, adverb, pronoun, … */
  p: string;
  /** gender of nouns */
  g?: 'm' | 'f' | 'n';
  /** plural of nouns */
  pl?: string;
  /** verbs: [past tense, "hat/ist" + past participle] */
  vf?: [string, string];
  /** which form the missing word is ("past tense · ich, er/sie/es", "genitive", …) */
  f?: string;
  /** English meaning */
  m?: string;
  /** compound nouns: [[part, meaning], …] */
  parts?: [string, string][];
}

const base = import.meta.env.BASE_URL;
const cache = new Map<number, Promise<Record<string, WordInfo>>>();

export function loadWords(lv: number): Promise<Record<string, WordInfo>> {
  let p = cache.get(lv);
  if (!p) {
    p = fetch(`${base}deck/words/level-${String(lv).padStart(2, '0')}.json`).then((r) => {
      if (!r.ok || !(r.headers.get('content-type') ?? '').includes('json')) throw new Error(`words ${lv}: HTTP ${r.status}`);
      return r.json() as Promise<Record<string, WordInfo>>;
    });
    p.catch(() => cache.delete(lv));
    cache.set(lv, p);
  }
  return p;
}

const ARTICLE = { m: 'der', f: 'die', n: 'das' } as const;

export interface WordLines {
  /** "das Hemd · die Hemden", "stellen · stellte · hat gestellt", "gut" */
  head: string;
  /** "noun", "verb", … */
  pos: string;
  meaning?: string;
  /** "stellte = past tense · ich, er/sie/es", "the verb aufstehen used as a noun" */
  form?: string;
  /** compound parts: "Abgabe (levy) + Frist (deadline)" */
  parts?: string;
}

/** The lines of the word box for the missing word `answer`. */
export function wordLines(w: WordInfo, answer: string): WordLines {
  const pos = w.p === 'name' ? 'name' : w.p;
  const usedAsNoun = w.f?.endsWith('used as a noun');
  let head: string;
  if (w.p === 'noun' && w.g) {
    const word = usedAsNoun || w.parts ? answer : w.l;
    head = `${ARTICLE[w.g]} ${word}${w.pl && !usedAsNoun ? ` · die ${w.pl}` : ''}`;
  } else if (usedAsNoun) {
    head = answer;
  } else if (w.p === 'verb' && w.vf) {
    head = `${w.l} · ${w.vf[0]} · ${w.vf[1]}`;
  } else {
    head = w.l;
  }
  let form: string | undefined;
  if (usedAsNoun) form = `the ${w.f!.startsWith('verb') ? 'verb' : 'adjective'} ${w.l} used as a noun`;
  else if (w.f) form = `${answer} = ${w.f}`;
  const parts = w.parts?.map(([p, m]) => `${p} (${m})`).join(' + ');
  return { head, pos, meaning: w.m, form, parts };
}

/** Link to the full entry. */
export function wiktionaryUrl(w: WordInfo): string {
  return `https://en.wiktionary.org/wiki/${encodeURIComponent(w.l)}#German`;
}
