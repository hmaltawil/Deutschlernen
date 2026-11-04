/** Answer normalisation and checking for typed answers. */

export type Verdict = 'correct' | 'close' | 'wrong';

const EDGE_PUNCT = /^[\s.,;:!?…"„“”'‚‘’()«»\-–—]+|[\s.,;:!?…"„“”'‚‘’()«»\-–—]+$/g;

/** NFC, trim, collapse whitespace, lowercase (German rules), strip edge punctuation. */
export function normalize(s: string): string {
  return s.normalize('NFC').replace(/\s+/g, ' ').replace(EDGE_PUNCT, '').toLocaleLowerCase('de-DE');
}

/** Map umlauts/ß to their ASCII spellings so "fuer" matches "für" and "strasse" matches "Straße". */
export function foldUmlauts(s: string): string {
  return s.replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss');
}

/** Strip umlaut dots entirely (für → fur): used only to detect near-misses. */
function stripUmlauts(s: string): string {
  return s.replace(/ä/g, 'a').replace(/ö/g, 'o').replace(/ü/g, 'u').replace(/ß/g, 'ss');
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

export interface CheckOptions {
  /** ä, ö, ü and ß must be typed as such (ae/oe/ue/ss only count as "close") */
  strict?: boolean;
}

/**
 * Case-insensitive; accepts ae/oe/ue/ss for ä/ö/ü/ß (unless `strict`).
 * "close" = missing umlaut dots or a single typo (still counted as wrong).
 */
export function checkAnswer(input: string, answer: string, { strict = false }: CheckOptions = {}): Verdict {
  const a = normalize(input);
  const b = normalize(answer);
  if (!a) return 'wrong';
  if (a === b) return 'correct';
  const folded = foldUmlauts(a) === foldUmlauts(b);
  if (folded && !strict) return 'correct';
  if (folded || stripUmlauts(a) === stripUmlauts(b)) return 'close';
  if (b.length >= 4 && levenshtein(foldUmlauts(a), foldUmlauts(b)) === 1) return 'close';
  return 'wrong';
}

/**
 * While typing: does what's typed so far match the beginning of the answer?
 * (Same rules as checkAnswer: any case, ae/oe/ue/ss unless strict.)
 */
export function onTrack(input: string, answer: string, { strict = false }: CheckOptions = {}): boolean {
  const a = input.normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('de-DE');
  const b = normalize(answer);
  if (b.startsWith(a)) return true;
  return !strict && foldUmlauts(b).startsWith(foldUmlauts(a));
}

/* ---------- dictation: the whole sentence ---------- */

export interface DictWord {
  text: string;
  /** matched (right) or not (missing / misspelled) */
  ok: boolean;
}

export interface DictationResult {
  verdict: Verdict;
  /** the sentence's words, each marked right or not */
  expected: DictWord[];
  /** what was typed, each word marked right or not (extra / misspelled) */
  typed: DictWord[];
}

export const DICT_WORD = /[\p{L}\p{N}]+(?:[-'’][\p{L}\p{N}]+)*/gu;

/**
 * Compare a typed sentence with the original word by word (any case, punctuation ignored,
 * ae/oe/ue/ss accepted unless strict). "close" = just one word off by a single letter or
 * missing umlaut dots (still counted as wrong, like a near miss in Type mode).
 */
export function checkDictation(input: string, sentence: string, { strict = false }: CheckOptions = {}): DictationResult {
  const exp = sentence.match(DICT_WORD) ?? [];
  const got = input.match(DICT_WORD) ?? [];
  const key = (w: string) => (strict ? normalize(w) : foldUmlauts(normalize(w)));
  const a = exp.map(key);
  const b = got.map(key);
  // longest common subsequence of words
  const L = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const okA = new Array<boolean>(a.length).fill(false);
  const okB = new Array<boolean>(b.length).fill(false);
  for (let i = 0, j = 0; i < a.length && j < b.length; ) {
    if (a[i] === b[j]) {
      okA[i++] = true;
      okB[j++] = true;
    } else if (L[i + 1][j] >= L[i][j + 1]) i++;
    else j++;
  }
  const expected = exp.map((text, i) => ({ text, ok: okA[i] }));
  const typed = got.map((text, i) => ({ text, ok: okB[i] }));
  const missed = expected.filter((w) => !w.ok);
  const extra = typed.filter((w) => !w.ok);
  let verdict: Verdict = 'wrong';
  if (!got.length) verdict = 'wrong';
  else if (!missed.length && !extra.length) verdict = 'correct';
  else if (missed.length === 1 && extra.length === 1 && checkAnswer(extra[0].text, missed[0].text, { strict }) !== 'wrong') verdict = 'close';
  return { verdict, expected, typed };
}
