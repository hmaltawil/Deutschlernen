import { describe, expect, it } from 'vitest';
import { checkAnswer, foldUmlauts, levenshtein, normalize } from './answer';

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
  it('rejects wrong and empty answers', () => {
    expect(checkAnswer('Katze', 'Hund')).toBe('wrong');
    expect(checkAnswer('', 'Hund')).toBe('wrong');
  });
  it('computes edit distance', () => {
    expect(levenshtein('kitten', 'sitting')).toBe(3);
    expect(levenshtein('', 'abc')).toBe(3);
  });
});
