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

/**
 * Case-insensitive; accepts ae/oe/ue/ss for ä/ö/ü/ß.
 * "close" = missing umlaut dots or a single typo (still counted as wrong).
 */
export function checkAnswer(input: string, answer: string): Verdict {
  const a = normalize(input);
  const b = normalize(answer);
  if (!a) return 'wrong';
  if (a === b || foldUmlauts(a) === foldUmlauts(b)) return 'correct';
  if (stripUmlauts(a) === stripUmlauts(b)) return 'close';
  if (b.length >= 4 && levenshtein(foldUmlauts(a), foldUmlauts(b)) === 1) return 'close';
  return 'wrong';
}
