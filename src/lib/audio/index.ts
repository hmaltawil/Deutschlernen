/**
 * Audio, most natural source first:
 *   1. native-speaker recording from Tatoeba
 *   2. on-device neural voice (Piper)
 *   3. browser speech synthesis (only if the neural voice is unavailable)
 */
import { audioUrl, type Item } from '../deck';
import { piper } from './piper';
import { speakSystem, stopSystem } from './webspeech';

export type Source = 'human' | 'neural' | 'system';

let el: HTMLAudioElement | null = null;
const preloaded = new Map<string, HTMLAudioElement>();
let playToken = 0;

function player(): HTMLAudioElement {
  el ??= new Audio();
  return el;
}

export function plannedSource(item: Item): Source {
  if (item.au) return 'human';
  return piper.status.state === 'ready' ? 'neural' : 'system';
}

function playUrl(url: string, rate: number, token: number): Promise<void> {
  const a = player();
  a.pause();
  a.src = url;
  a.playbackRate = rate;
  a.preservesPitch = true;
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      a.onended = a.onerror = null;
    };
    a.onended = () => (cleanup(), resolve());
    a.onerror = () => (cleanup(), reject(new Error('audio failed to load')));
    if (token !== playToken) return resolve();
    a.play().catch((e) => (cleanup(), reject(e)));
  });
}

async function playNeural(item: Item, rate: number, voice: string, token: number): Promise<boolean> {
  if (piper.status.state !== 'ready' || piper.status.voiceId !== voice) return false;
  try {
    const url = await piper.synth(item.de, voice);
    if (token !== playToken) return true;
    await playUrl(url, rate, token);
    return true;
  } catch {
    return false;
  }
}

/** Play the sentence; resolves with the source actually used (null if nothing could play). */
export async function play(item: Item, rate: number, voice: string): Promise<Source | null> {
  const token = ++playToken;
  stopSystem();
  if (item.au) {
    try {
      await playUrl(audioUrl(item.au), rate, token);
      return 'human';
    } catch (e) {
      if ((e as Error).name === 'NotAllowedError') throw e; // autoplay blocked: let the UI show a play button
    }
  }
  if (token !== playToken) return null;
  if (await playNeural(item, rate, voice, token)) return 'neural';
  if (token !== playToken) return null;
  return (await speakSystem(item.de, rate)) ? 'system' : null;
}

export function stop() {
  playToken++;
  el?.pause();
  stopSystem();
}

/** Warm up the next card's audio so it starts instantly. */
export function preload(item: Item, voice: string) {
  if (item.au) {
    const url = audioUrl(item.au);
    if (preloaded.has(url)) return;
    const a = new Audio();
    a.preload = 'auto';
    a.src = url;
    preloaded.set(url, a);
    if (preloaded.size > 6) preloaded.delete(preloaded.keys().next().value as string);
  } else if (piper.status.state === 'ready' && piper.status.voiceId === voice) {
    piper.synth(item.de, voice).catch(() => {});
  }
}

export { piper };

/** Speak arbitrary text with the neural voice (or the system voice if it isn't ready). */
export async function speakText(text: string, rate: number, voice: string): Promise<Source | null> {
  const fake = { id: -1, de: text, c: [0, 0], a: '', en: '', d: [], r: 0, lv: 0 } as Item;
  return play(fake, rate, voice);
}
