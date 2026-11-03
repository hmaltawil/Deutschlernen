import { describe, expect, it } from 'vitest';
import { scoreVoice } from './webspeech';

const v = (name: string, lang: string) => ({ name, lang, localService: true });

describe('system voice ranking', () => {
  it('prefers natural/neural German voices and ignores other languages', () => {
    const voices = [
      v('eSpeak German', 'de'),
      v('Anna', 'de-DE'),
      v('Microsoft Katja Online (Natural) - German (Germany)', 'de-DE'),
      v('Google US English', 'en-US'),
      v('Google Deutsch', 'de-DE'),
    ];
    const ranked = [...voices].sort((a, b) => scoreVoice(b) - scoreVoice(a)).map((x) => x.name);
    expect(ranked[0]).toMatch(/Natural/);
    expect(ranked[1]).toBe('Google Deutsch');
    expect(scoreVoice(v('Google US English', 'en-US'))).toBe(-1);
    expect(scoreVoice(v('eSpeak German', 'de'))).toBeLessThan(scoreVoice(v('Anna', 'de-DE')));
  });
});
