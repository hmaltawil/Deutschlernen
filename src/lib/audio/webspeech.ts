/** Last-resort fallback: the browser's own speech synthesis, picking its most natural German voice. */

const QUALITY_HINTS = [/natural/i, /neural/i, /online/i, /premium/i, /enhanced/i, /google/i, /siri/i];

let voicesReady: Promise<SpeechSynthesisVoice[]> | null = null;

function getVoices(): Promise<SpeechSynthesisVoice[]> {
  if (typeof speechSynthesis === 'undefined') return Promise.resolve([]);
  voicesReady ??= new Promise((resolve) => {
    const now = speechSynthesis.getVoices();
    if (now.length) return resolve(now);
    const done = () => resolve(speechSynthesis.getVoices());
    speechSynthesis.addEventListener('voiceschanged', done, { once: true });
    setTimeout(done, 1500);
  });
  return voicesReady;
}

export function scoreVoice(v: Pick<SpeechSynthesisVoice, 'name' | 'lang' | 'localService'>): number {
  if (!/^de([-_]|$)/i.test(v.lang)) return -1;
  let s = 1;
  QUALITY_HINTS.forEach((re, i) => {
    if (re.test(v.name)) s += 10 * (QUALITY_HINTS.length - i);
  });
  if (/^de[-_]DE/i.test(v.lang)) s += 2;
  if (/espeak|robot/i.test(v.name)) s -= 5;
  return s;
}

export async function bestGermanVoice(): Promise<SpeechSynthesisVoice | null> {
  const voices = await getVoices();
  let best: SpeechSynthesisVoice | null = null;
  let bestScore = -1;
  for (const v of voices) {
    const s = scoreVoice(v);
    if (s > bestScore) [best, bestScore] = [v, s];
  }
  return best;
}

export async function speakSystem(text: string, rate: number): Promise<boolean> {
  if (typeof speechSynthesis === 'undefined') return false;
  const voice = await bestGermanVoice();
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'de-DE';
  if (voice) u.voice = voice;
  u.rate = rate;
  return new Promise((resolve) => {
    u.onend = () => resolve(true);
    u.onerror = () => resolve(false);
    speechSynthesis.speak(u);
  });
}

export function stopSystem() {
  if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
}
