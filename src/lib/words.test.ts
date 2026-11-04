import { describe, expect, it } from 'vitest';
import { wordLines, wiktionaryUrl, type WordInfo } from './words';

describe('word info lines', () => {
  it('nouns: article, plural, form', () => {
    expect(wordLines({ l: 'Hemd', p: 'noun', g: 'n', pl: 'Hemden', m: 'shirt' }, 'Hemd')).toEqual({
      head: 'das Hemd · die Hemden', pos: 'noun', meaning: 'shirt', form: undefined, parts: undefined,
    });
    expect(wordLines({ l: 'Meeresspiegel', p: 'noun', g: 'm', pl: 'Meeresspiegel', f: 'genitive', m: 'sea level' }, 'Meeresspiegels'))
      .toMatchObject({ head: 'der Meeresspiegel · die Meeresspiegel', form: 'Meeresspiegels = genitive' });
  });
  it('verbs: principal parts and which form it is', () => {
    const w: WordInfo = { l: 'stellen', p: 'verb', vf: ['stellte', 'hat gestellt'], f: 'past tense · ich, er/sie/es', m: 'to put' };
    expect(wordLines(w, 'stellte')).toMatchObject({ head: 'stellen · stellte · hat gestellt', form: 'stellte = past tense · ich, er/sie/es' });
  });
  it('words used as nouns and compounds', () => {
    expect(wordLines({ l: 'aufstehen', p: 'noun', g: 'n', m: 'to get up', f: 'verb used as a noun' }, 'Aufstehen'))
      .toMatchObject({ head: 'das Aufstehen', form: 'the verb aufstehen used as a noun' });
    expect(wordLines({ l: 'anwesend', p: 'noun', m: 'present', f: 'adjective used as a noun' }, 'Anwesenden'))
      .toMatchObject({ head: 'Anwesenden', form: 'the adjective anwesend used as a noun' });
    expect(wordLines({ l: 'Abgabefrist', p: 'noun', g: 'f', pl: 'Abgabefristen', parts: [['Abgabe', 'levy'], ['Frist', 'deadline']] }, 'Abgabefrist'))
      .toMatchObject({ head: 'die Abgabefrist · die Abgabefristen', parts: 'Abgabe (levy) + Frist (deadline)' });
  });
  it('links to Wiktionary', () => {
    expect(wiktionaryUrl({ l: 'Größe', p: 'noun' })).toBe('https://en.wiktionary.org/wiki/Gr%C3%B6%C3%9Fe#German');
  });
});
