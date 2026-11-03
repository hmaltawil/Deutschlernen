/**
 * Audio, most natural source first:
 *   1. native-speaker recording (copy stored with the app; tatoeba.org as fallback)
 *   2. on-device neural voice (Piper)
 *   3. browser speech synthesis (only if the neural voice is unavailable)
 *
 * Recordings are fetched with fetch() and played from a blob, so the service
 * worker can cache them (no media Range requests) and they work offline.
 */
import { audioUrl, remoteAudioUrl, type Item } from '../deck';
import { piper } from './piper';
import { speakSystem, stopSystem } from './webspeech';

export type Source = 'human' | 'neural' | 'system';

let el: HTMLAudioElement | null = null;
let playToken = 0;
const clips = new Map<string, Promise<string>>(); // recording URL → object URL
const CLIP_MAX = 30;

function player(): HTMLAudioElement {
  el ??= new Audio();
  return el;
}

/** Fetch a recording (through the service worker cache) and return a blob URL. */
function clip(url: string): Promise<string> {
  const hit = clips.get(url);
  if (hit) {
    clips.delete(url);
    clips.set(url, hit);
    return hit;
  }
  const p = fetch(url).then(async (r) => {
    if (!r.ok || !(r.headers.get('content-type') ?? '').startsWith('audio/')) throw new Error(`recording unavailable (${r.status})`);
    return URL.createObjectURL(await r.blob());
  });
  p.catch(() => clips.delete(url));
  clips.set(url, p);
  while (clips.size > CLIP_MAX) {
    const [k, v] = clips.entries().next().value as [string, Promise<string>];
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
    const url = await clip(audioUrl(item.au));
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
  if (item.au) clip(audioUrl(item.au)).catch(() => {});
  else if (piper.status.state === 'ready' && piper.status.voiceId === voice) piper.synth(item.de, voice).catch(() => {});
}

/** Speak arbitrary text with the neural voice (or the system voice if it isn't ready). */
export async function speakText(text: string, rate: number, voice: string): Promise<Source | null> {
  const fake = { id: -1, de: text, c: [0, 0], a: '', en: '', d: [], r: 0, lv: 0 } as Item;
  return play(fake, rate, voice);
}

export { piper };
