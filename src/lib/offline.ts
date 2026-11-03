/** Offline mode: service worker registration, status, and saving recordings to the device. */
import { registerSW } from 'virtual:pwa-register';
import { audioUrl, loadLevel, loadManifest } from './deck';

export type OfflineState = 'unsupported' | 'saving' | 'ready';

export interface OfflineStatus {
  app: OfflineState;
  /** recordings stored on this device */
  saved: number;
  /** recordings in the deck */
  total: number;
  /** size of all recordings in bytes */
  bytes: number;
  /** progress of "save all recordings" (null when idle) */
  job: { done: number; todo: number } | null;
  error?: string;
}

const RECORDINGS_CACHE = 'recordings';
const base = import.meta.env.BASE_URL;
let status: OfflineStatus = { app: 'saving', saved: 0, total: 0, bytes: 0, job: null };
const listeners = new Set<(s: OfflineStatus) => void>();
let cancelJob = false;

function set(p: Partial<OfflineStatus>) {
  status = { ...status, ...p };
  for (const l of listeners) l(status);
}

export function subscribeOffline(fn: (s: OfflineStatus) => void): () => void {
  listeners.add(fn);
  fn(status);
  return () => listeners.delete(fn);
}

async function deckIsCached(): Promise<boolean> {
  try {
    return !!(await caches.match(`${base}deck/manifest.json`, { ignoreSearch: true }));
  } catch {
    return false;
  }
}

export function initOffline() {
  const supported = 'serviceWorker' in navigator && 'caches' in window && !import.meta.env.DEV;
  if (!supported) {
    set({ app: 'unsupported' });
    return;
  }
  registerSW({
    immediate: true,
    onOfflineReady: () => set({ app: 'ready' }),
  });
  deckIsCached().then((ok) => ok && set({ app: 'ready' }));
  refreshCounts();
}

/** All recording URLs in the deck. */
async function recordingUrls(): Promise<string[]> {
  const m = await loadManifest();
  const levels = await Promise.all(m.levels.map((l) => loadLevel(l.n)));
  return levels.flat().flatMap((it) => (it.au ? [audioUrl(it.au)] : []));
}

export async function refreshCounts(): Promise<void> {
  if (!('caches' in window)) return;
  try {
    const m = await loadManifest();
    const cache = await caches.open(RECORDINGS_CACHE);
    const keys = await cache.keys();
    set({ saved: keys.length, total: m.audio, bytes: m.audioBytes ?? m.audio * 14000 });
  } catch {
    /* ignore */
  }
}

/** Download every recording into the offline cache (resumable; already-saved ones are skipped). */
export async function saveAllRecordings(): Promise<void> {
  if (status.job) return;
  cancelJob = false;
  navigator.storage?.persist?.().catch(() => {});
  try {
    const cache = await caches.open(RECORDINGS_CACHE);
    const have = new Set((await cache.keys()).map((r) => new URL(r.url).pathname));
    const todo = (await recordingUrls()).filter((u) => !have.has(new URL(u, location.href).pathname));
    let done = 0;
    set({ job: { done, todo: todo.length }, error: undefined });
    let next = 0;
    const worker = async () => {
      while (!cancelJob && next < todo.length) {
        const url = todo[next++];
        try {
          const res = await fetch(url);
          // only keep real audio (a misconfigured server may answer missing files with a web page)
          if (res.ok && (res.headers.get('content-type') ?? '').startsWith('audio/')) await cache.put(url, res);
        } catch {
          if (!navigator.onLine) cancelJob = true;
        }
        done++;
        if (done % 25 === 0 || done === todo.length) set({ job: { done, todo: todo.length }, saved: have.size + done });
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
    if (cancelJob && !navigator.onLine) set({ error: 'Stopped: no internet connection. Tap again to continue.' });
  } catch (e) {
    set({ error: (e as Error).message });
  } finally {
    set({ job: null });
    await refreshCounts();
  }
}

export function stopSavingRecordings() {
  cancelJob = true;
}

export async function removeSavedRecordings(): Promise<void> {
  await caches.delete(RECORDINGS_CACHE);
  await refreshCounts();
}
