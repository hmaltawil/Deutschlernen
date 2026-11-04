/**
 * Audio, most natural source first:
 *   1. native-speaker recording (from the level bundle — saved on the device or
 *      read from the website; tatoeba.org as a last fallback)
 *   2. on-device neural voice (Piper)
 *   3. browser speech synthesis (only if the neural voice is unavailable)
 */
import { loadManifest, remoteAudioUrl, type Item } from '../deck';
import { recordingBlob } from './recordings';
import { piper } from './piper';
import { speakSystem, stopSystem } from './webspeech';

export type Source = 'human' | 'neural' | 'system';

let el: HTMLAudioElement | null = null;
let playToken = 0;
const clips = new Map<number, Promise<string>>(); // sentence id → object URL
const CLIP_MAX = 30;
let bundleSizes: Promise<Map<number, number>> | null = null;
const sizeOf = async (lv: number) => {
  bundleSizes ??= loadManifest().then((m) => new Map(m.levels.map((l) => [l.n, l.packBytes ?? 0])));
  return (await bundleSizes).get(lv);
};

function player(): HTMLAudioElement {
  el ??= new Audio();
  return el;
}

/** A recording as a blob URL (from the saved bundle, else a byte range from the website). */
function clip(item: Item): Promise<string> {
  const key = item.id;
  const hit = clips.get(key);
  if (hit) {
    clips.delete(key);
    clips.set(key, hit);
    return hit;
  }
  const p = sizeOf(item.lv)
    .then((size) => recordingBlob(item, size))
    .then((b) => URL.createObjectURL(b));
  p.catch(() => clips.delete(key));
  clips.set(key, p);
  while (clips.size > CLIP_MAX) {
    const [k, v] = clips.entries().next().value as [number, Promise<string>];
    clips.delete(k);
    v.then((u) => URL.revokeObjectURL(u)).catch(() => {});
  }
  return p;
}

export function plannedSource(item: Item): Source {
  if (item.au) return 'human';
  return piper.status.state === 'ready' ? 'neural' : 'system';
}

function playUrl(url: string, rate: number, token: number, onStart?: () => void): Promise<void> {
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
    a.play()
      .then(() => onStart?.())
      .catch((e) => (cleanup(), reject(e)));
  });
}

type OnSource = (s: Source) => void;

async function playHuman(item: Item, rate: number, token: number, onSource?: OnSource): Promise<boolean> {
  if (!item.au) return false;
  try {
    if (!item.ap) throw new Error('no bundled copy');
    const url = await clip(item);
    if (token !== playToken) return true;
    await playUrl(url, rate, token, () => onSource?.('human'));
    return true;
  } catch (e) {
    if ((e as Error).name === 'NotAllowedError') throw e; // autoplay blocked: let the UI show a play button
  }
  if (token !== playToken || !navigator.onLine) return false;
  try {
    await playUrl(remoteAudioUrl(item.au), rate, token, () => onSource?.('human'));
    return true;
  } catch (e) {
    if ((e as Error).name === 'NotAllowedError') throw e;
    return false;
  }
}

async function playNeural(item: Item, rate: number, voice: string, token: number, onSource?: OnSource): Promise<boolean> {
  if (piper.status.state !== 'ready' || piper.status.voiceId !== voice) return false;
  try {
    const url = await piper.synth(item.de, voice);
    if (token !== playToken) return true;
    await playUrl(url, rate, token, () => onSource?.('neural'));
    return true;
  } catch {
    return false;
  }
}

/**
 * Play the sentence; resolves with the source actually used (null if nothing could play)
 * once playback ends. `onSource` fires as soon as a source starts playing.
 */
export async function play(item: Item, rate: number, voice: string, onSource?: OnSource): Promise<Source | null> {
  const token = ++playToken;
  stopSystem();
  if (await playHuman(item, rate, token, onSource)) return 'human';
  if (token !== playToken) return null;
  if (await playNeural(item, rate, voice, token, onSource)) return 'neural';
  if (token !== playToken) return null;
  onSource?.('system');
  return (await speakSystem(item.de, rate)) ? 'system' : null;
}

export function stop() {
  playToken++;
  el?.pause();
  stopSystem();
}

/** Warm up the next card's audio so it starts instantly (and is cached for offline use). */
export function preload(item: Item, voice: string) {
  if (item.au && item.ap) clip(item).catch(() => {});
  else if (piper.status.state === 'ready' && piper.status.voiceId === voice) piper.synth(item.de, voice).catch(() => {});
}

/** Speak arbitrary text with the neural voice (or the system voice if it isn't ready). */
export async function speakText(text: string, rate: number, voice: string): Promise<Source | null> {
  const fake = { id: -1, de: text, c: [0, 0], a: '', en: '', d: [], r: 0, lv: 0 } as Item;
  return play(fake, rate, voice);
}

export { piper };
