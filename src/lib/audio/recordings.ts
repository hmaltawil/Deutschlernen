/**
 * Native-speaker recordings, stored as one bundle per level.
 *
 * - Saved bundles live in the origin-private file system (OPFS): 30 files at most,
 *   which keeps the app quick to open on iPhone (thousands of separately stored
 *   recordings made Safari take ~10 s to open the app).
 * - A recording is a byte range of its bundle: read from the saved file, or
 *   fetched from the website with a Range request when the bundle isn't saved.
 * - Bundle names carry a content fingerprint, so a deck update never mixes old
 *   and new audio; outdated bundles are deleted.
 */
import { bundles, packUrl, type BundleInfo, type Item } from '../deck';

const DIR = 'recordings';
const files = new Map<string, Promise<File | null>>();

export const opfsSupported = () => typeof navigator !== 'undefined' && !!navigator.storage?.getDirectory;

async function dir(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(DIR, { create: true });
}

/** A saved bundle, if it is complete (size matches). */
export function savedBundle(b: BundleInfo): Promise<File | null> {
  let p = files.get(b.name);
  if (!p) {
    p = (async () => {
      if (!opfsSupported()) return null;
      try {
        const f = await (await (await dir()).getFileHandle(b.name)).getFile();
        return f.size === b.size ? f : null;
      } catch {
        return null;
      }
    })();
    files.set(b.name, p);
  }
  return p;
}

function forget(name?: string) {
  if (name === undefined) files.clear();
  else files.delete(name);
}

/** The recording of an item as an audio blob: from the saved bundle, else from the website. */
export async function recordingBlob(item: Item): Promise<Blob> {
  const b = (await bundles()).get(item.lv);
  if (!item.ap || !b) throw new Error('no bundled recording');
  const [off, len] = item.ap;
  const f = await savedBundle(b);
  if (f) return f.slice(off, off + len, 'audio/mpeg');
  const res = await fetch(packUrl(b.name), { headers: { Range: `bytes=${off}-${off + len - 1}` } });
  if (res.status === 206) return new Blob([await res.arrayBuffer()], { type: 'audio/mpeg' });
  if (res.ok) return (await res.blob()).slice(off, off + len, 'audio/mpeg'); // server ignored Range
  throw new Error(`recording unavailable (${res.status})`);
}

/** Levels whose bundle is completely saved, with their sizes. */
export async function savedLevels(expected: Map<number, BundleInfo>): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  for (const [lv, b] of expected) if (await savedBundle(b)) out.set(lv, b.size);
  return out;
}

/** Delete saved bundles that no longer belong to the current deck. */
export async function pruneBundles(): Promise<void> {
  if (!opfsSupported()) return;
  try {
    const keep = new Set([...(await bundles()).values()].map((b) => b.name));
    const d = await dir();
    const stale: string[] = [];
    for await (const name of (d as unknown as { keys(): AsyncIterable<string> }).keys()) if (!keep.has(name)) stale.push(name);
    for (const name of stale) await d.removeEntry(name);
  } catch {
    /* ignore */
  }
}

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, { resolve: (n: number) => void; reject: (e: Error) => void; onProgress?: (done: number) => void }>();

function w(): Worker {
  if (!worker) {
    worker = new Worker(new URL('../../workers/recordings.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const m = e.data;
      const p = pending.get(m.reqId);
      if (!p) return;
      if (m.type === 'progress') return p.onProgress?.(m.done);
      pending.delete(m.reqId);
      if (m.type === 'done') p.resolve(m.bytes);
      else p.reject(new Error(m.message));
    };
    worker.onerror = (e) => {
      const err = new Error(e.message || 'download worker failed');
      for (const p of pending.values()) p.reject(err);
      pending.clear();
      worker = null;
    };
  }
  return worker;
}

/** Download a bundle into the device's storage. */
export function saveBundle(b: BundleInfo, onProgress?: (done: number) => void): Promise<number> {
  const reqId = ++seq;
  forget(b.name);
  return new Promise<number>((resolve, reject) => {
    pending.set(reqId, { resolve, reject, onProgress });
    w().postMessage({ reqId, url: new URL(packUrl(b.name), location.href).href, name: b.name, size: b.size });
  }).finally(() => forget(b.name));
}

export async function removeBundles(): Promise<void> {
  forget();
  try {
    const root = await navigator.storage.getDirectory();
    await root.removeEntry(DIR, { recursive: true });
  } catch {
    /* nothing saved */
  }
}
