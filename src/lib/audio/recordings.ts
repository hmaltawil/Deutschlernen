/**
 * Native-speaker recordings, stored as one bundle per level.
 *
 * - Saved bundles live in the origin-private file system (OPFS): 30 files at most,
 *   which keeps the app quick to open on iPhone (thousands of separately stored
 *   recordings made Safari take ~10 s to open the app).
 * - A recording is a byte range of its bundle: read from the saved file, or
 *   fetched from the website with a Range request when the bundle isn't saved.
 */
import { packName, packUrl, type Item } from '../deck';

const DIR = 'recordings';
const files = new Map<number, Promise<File | null>>();

export const opfsSupported = () => typeof navigator !== 'undefined' && !!navigator.storage?.getDirectory;

async function dir(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(DIR, { create: true });
}

/** The saved bundle of a level, if it is complete (size matches). */
export function savedBundle(lv: number, expectedSize?: number): Promise<File | null> {
  let p = files.get(lv);
  if (!p) {
    p = (async () => {
      if (!opfsSupported()) return null;
      try {
        const f = await (await (await dir()).getFileHandle(packName(lv))).getFile();
        return expectedSize === undefined || f.size === expectedSize ? f : null;
      } catch {
        return null;
      }
    })();
    files.set(lv, p);
  }
  return p;
}

export function forgetBundle(lv?: number) {
  if (lv === undefined) files.clear();
  else files.delete(lv);
}

/** The recording of an item as an audio blob: from the saved bundle, else from the website. */
export async function recordingBlob(item: Item, expectedSize?: number): Promise<Blob> {
  if (!item.ap) throw new Error('no bundled recording');
  const [off, len] = item.ap;
  const f = await savedBundle(item.lv, expectedSize);
  if (f) return f.slice(off, off + len, 'audio/mpeg');
  const res = await fetch(packUrl(item.lv), { headers: { Range: `bytes=${off}-${off + len - 1}` } });
  if (res.status === 206) return new Blob([await res.arrayBuffer()], { type: 'audio/mpeg' });
  if (res.ok) return (await res.blob()).slice(off, off + len, 'audio/mpeg'); // server ignored Range
  throw new Error(`recording unavailable (${res.status})`);
}

/** Sizes of the complete saved bundles, by level. */
export async function savedLevels(expected: Map<number, number>): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  if (!opfsSupported()) return out;
  try {
    const d = await dir();
    for (const [lv, size] of expected) {
      try {
        const f = await (await d.getFileHandle(packName(lv))).getFile();
        if (f.size === size) out.set(lv, size);
      } catch {
        /* not saved */
      }
    }
  } catch {
    /* no OPFS */
  }
  return out;
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
  }
  return worker;
}

/** Download a level's bundle into the device's storage. */
export function saveBundle(lv: number, size: number, onProgress?: (done: number) => void): Promise<number> {
  const reqId = ++seq;
  forgetBundle(lv);
  return new Promise<number>((resolve, reject) => {
    pending.set(reqId, { resolve, reject, onProgress });
    w().postMessage({ reqId, url: new URL(packUrl(lv), location.href).href, name: packName(lv), size });
  }).finally(() => forgetBundle(lv));
}

export async function removeBundles(): Promise<void> {
  forgetBundle();
  try {
    const root = await navigator.storage.getDirectory();
    await root.removeEntry(DIR, { recursive: true });
  } catch {
    /* nothing saved */
  }
}
