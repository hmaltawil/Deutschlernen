import { describe, expect, it } from 'vitest';
import { checkAnswer, checkDictation, foldUmlauts, levenshtein, normalize, onTrack } from './answer';

describe('answer checking', () => {
  it('ignores case, whitespace and edge punctuation', () => {
    expect(checkAnswer('  hund ', 'Hund')).toBe('correct');
    expect(checkAnswer('Hund.', 'Hund')).toBe('correct');
    expect(normalize('  Groß  ')).toBe('groß');
  });
  it('accepts ae/oe/ue/ss spellings', () => {
    expect(checkAnswer('fuer', 'für')).toBe('correct');
    expect(checkAnswer('Strasse', 'Straße')).toBe('correct');
    expect(checkAnswer('schoen', 'schön')).toBe('correct');
    expect(checkAnswer('Äpfel', 'Äpfel')).toBe('correct');
    expect(foldUmlauts('größer')).toBe('groesser');
  });
  it('handles decomposed unicode input', () => {
    expect(checkAnswer('für', 'für')).toBe('correct');
  });
  it('flags missing umlauts and single typos as close (not correct)', () => {
    expect(checkAnswer('fur', 'für')).toBe('close');
    expect(checkAnswer('Schwster', 'Schwester')).toBe('close');
    expect(checkAnswer('ab', 'an')).toBe('wrong'); // too short for typo tolerance
  });
  it('strict umlauts: ae/oe/ue/ss count as "close", not right', () => {
    const strict = { strict: true };
    expect(checkAnswer('für', 'für', strict)).toBe('correct');
    expect(checkAnswer('FÜR', 'für', strict)).toBe('correct');
    expect(checkAnswer('fuer', 'für', strict)).toBe('close');
    expect(checkAnswer('Strasse', 'Straße', strict)).toBe('close');
    expect(checkAnswer('fur', 'für', strict)).toBe('close');
    expect(checkAnswer('Michael', 'Michael', strict)).toBe('correct'); // a real "ae" is fine
  });
  it('tells whether typing is on track', () => {
    expect(onTrack('', 'Straße')).toBe(true);
    expect(onTrack('st', 'Straße')).toBe(true);
    expect(onTrack('Strass', 'Straße')).toBe(true);
    expect(onTrack('straß', 'Straße')).toBe(true);
    expect(onTrack('Strae', 'Straße')).toBe(false);
    expect(onTrack('fue', 'für')).toBe(true);
    expect(onTrack('fue', 'für', { strict: true })).toBe(false);
    expect(onTrack('fü', 'für', { strict: true })).toBe(true);
    expect(onTrack('E-', 'E-Mail')).toBe(true);
    expect(onTrack('fürs', 'für')).toBe(false);
  });
  it('rejects wrong and empty answers', () => {
    expect(checkAnswer('Katze', 'Hund')).toBe('wrong');
    expect(checkAnswer('', 'Hund')).toBe('wrong');
  });
  it('computes edit distance', () => {
    expect(levenshtein('kitten', 'sitting')).toBe(3);
    expect(levenshtein('', 'abc')).toBe(3);
  });
});

describe('dictation', () => {
  const S = 'Ich zog das Hemd aus.';
  it('accepts the sentence in any case and without punctuation', () => {
    expect(checkDictation('ich zog das hemd aus', S).verdict).toBe('correct');
    expect(checkDictation('Ich zog das Hemd aus.', S).verdict).toBe('correct');
    expect(checkDictation('Wir muessen gehen', 'Wir müssen gehen!').verdict).toBe('correct');
    expect(checkDictation('Wir muessen gehen', 'Wir müssen gehen!', { strict: true }).verdict).toBe('close');
  });
  it('marks missing, misspelled and extra words', () => {
    const r = checkDictation('Ich zog Hemd aus heute', S);
    expect(r.verdict).toBe('wrong');
    expect(r.expected.filter((w) => !w.ok).map((w) => w.text)).toEqual(['das']);
    expect(r.typed.filter((w) => !w.ok).map((w) => w.text)).toEqual(['heute']);
  });
  it('one small typo is "close"', () => {
    expect(checkDictation('Ich zog das Hemt aus', S).verdict).toBe('close');
    expect(checkDictation('Ich zog das Hemt auf', S).verdict).toBe('wrong'); // two words off
    expect(checkDictation('', S).verdict).toBe('wrong');
  });
  it('keeps hyphenated words and apostrophes together', () => {
    expect(checkDictation("Wie geht's dem E-Mail-Team?", "Wie geht's dem E-Mail-Team?").expected.map((w) => w.text)).toEqual(['Wie', "geht's", 'dem', 'E-Mail-Team']);
  });
});
