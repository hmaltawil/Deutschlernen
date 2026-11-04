/** Offline mode: service worker registration, status, and saving recording bundles to the device. */
import { registerSW } from 'virtual:pwa-register';
import { loadManifest } from './deck';
import { mark } from './startup';
import { opfsSupported, removeBundles, saveBundle, savedLevels } from './audio/recordings';

export type OfflineState = 'unsupported' | 'saving' | 'ready';

export interface OfflineStatus {
  app: OfflineState;
  /** levels whose recordings are saved on this device */
  savedLevels: number;
  totalLevels: number;
  savedBytes: number;
  totalBytes: number;
  /** progress of "save all recordings" in bytes (null when idle) */
  job: { done: number; todo: number } | null;
  /** level being saved in the background (auto-save), if any */
  background: number | null;
  error?: string;
}

const base = import.meta.env.BASE_URL;
let status: OfflineStatus = {
  app: 'saving',
  savedLevels: 0,
  totalLevels: 0,
  savedBytes: 0,
  totalBytes: 0,
  job: null,
  background: null,
};
const listeners = new Set<(s: OfflineStatus) => void>();
let cancelJob = false;
let busy: Promise<unknown> = Promise.resolve(); // one bundle download at a time

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
    // look only in the app's own cache
    const name = (await caches.keys()).find((n) => n.startsWith('workbox-precache'));
    if (!name) return false;
    return !!(await (await caches.open(name)).match(`${base}deck/manifest.json`, { ignoreSearch: true }));
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
  deckIsCached().then((ok) => {
    if (ok) set({ app: 'ready' });
    mark('offline');
  });
  pruneOldVoiceRuntime();
  dropPerRecordingCache();
}

async function bundleSizes(): Promise<Map<number, number>> {
  const m = await loadManifest();
  return new Map(m.levels.filter((l) => l.packBytes).map((l) => [l.n, l.packBytes!]));
}

export async function refreshCounts(): Promise<void> {
  try {
    const sizes = await bundleSizes();
    const saved = await savedLevels(sizes);
    let savedBytes = 0;
    for (const b of saved.values()) savedBytes += b;
    let totalBytes = 0;
    for (const b of sizes.values()) totalBytes += b;
    set({ savedLevels: saved.size, totalLevels: sizes.size, savedBytes, totalBytes });
  } catch {
    /* ignore */
  }
}

/** Download every level's recordings (already saved levels are skipped). */
export async function saveAllRecordings(): Promise<void> {
  if (status.job || !opfsSupported()) return;
  cancelJob = false;
  navigator.storage?.persist?.().catch(() => {});
  set({ job: { done: 0, todo: 0 }, error: undefined });
  try {
    await busy; // let a background save finish first
    const sizes = await bundleSizes();
    const saved = await savedLevels(sizes);
    const todo = [...sizes].filter(([lv]) => !saved.has(lv));
    const total = todo.reduce((s, [, b]) => s + b, 0);
    let done = 0;
    set({ job: { done, todo: total } });
    for (const [lv, size] of todo) {
      if (cancelJob) break;
      if (!navigator.onLine) {
        set({ error: 'Stopped: no internet connection. Tap again to continue.' });
        break;
      }
      await saveBundle(lv, size, (d) => set({ job: { done: done + d, todo: total } }));
      done += size;
      set({ job: { done, todo: total } });
      await refreshCounts();
    }
  } catch (e) {
    set({ error: navigator.onLine ? (e as Error).message : 'Stopped: no internet connection. Tap again to continue.' });
  } finally {
    set({ job: null });
    await refreshCounts();
  }
}

/** Stop "save all" after the level that is downloading now. */
export function stopSavingRecordings() {
  cancelJob = true;
}

const tried = new Set<number>();

/** Save a level's recordings in the background (used when you start playing that level). */
export function ensureLevelSaved(lv: number) {
  if (!opfsSupported() || !navigator.onLine || status.job || tried.has(lv)) return;
  tried.add(lv);
  busy = busy.then(async () => {
    try {
      const size = (await bundleSizes()).get(lv);
      if (!size) return;
      if ((await savedLevels(new Map([[lv, size]]))).has(lv)) return;
      set({ background: lv });
      await saveBundle(lv, size);
      navigator.storage?.persist?.().catch(() => {});
    } catch {
      tried.delete(lv); // try again another time
    } finally {
      set({ background: null });
      refreshCounts();
    }
  });
}

export async function removeSavedRecordings(): Promise<void> {
  await busy;
  await removeBundles();
  tried.clear();
  await refreshCounts();
}

/** Drop cached voice runtime files from older versions (~30 MB each). */
async function pruneOldVoiceRuntime() {
  try {
    const cache = await caches.open('tts-runtime');
    for (const req of await cache.keys()) {
      if (!new URL(req.url).pathname.includes(`/tts/${__TTS_VERSION__}/`)) await cache.delete(req);
    }
  } catch {
    /* ignore */
  }
}

/**
 * Older versions kept every recording as its own cache entry (up to ~11,000),
 * which made the app take ~10 s to open on iPhone. Remove that cache once.
 */
async function dropPerRecordingCache() {
  try {
    if ((await caches.keys()).includes('recordings')) await caches.delete('recordings');
    indexedDB.deleteDatabase('workbox-expiration');
  } catch {
    /* ignore */
  }
}
