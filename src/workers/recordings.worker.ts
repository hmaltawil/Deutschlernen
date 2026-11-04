/// <reference lib="webworker" />
/**
 * Saves a level's recording bundle into the origin-private file system (OPFS).
 * Runs in a worker because Safari only allows writing OPFS files from workers in
 * some versions (sync access handles); createWritable is used where available.
 */

type Req = { reqId: number; url: string; name: string; size: number };

const post = (m: unknown) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m);

async function save({ reqId, url, name, size }: Req) {
  const root = await navigator.storage.getDirectory();
  const dir = await root.getDirectoryHandle('recordings', { create: true });
  const fh = await dir.getFileHandle(name, { create: true });
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok || !res.body) throw new Error(`download failed (${res.status})`);
  const reader = res.body.getReader();
  let done = 0;
  let lastPost = 0;
  const progress = () => {
    const now = Date.now();
    if (now - lastPost > 250) {
      lastPost = now;
      post({ type: 'progress', reqId, done, size });
    }
  };
  const handle = fh as FileSystemFileHandle & {
    createSyncAccessHandle?: () => Promise<FileSystemSyncAccessHandle>;
    createWritable: () => Promise<FileSystemWritableFileStream>;
  };
  if (typeof handle.createSyncAccessHandle === 'function') {
    const h = await handle.createSyncAccessHandle();
    try {
      h.truncate(0);
      for (;;) {
        const { done: end, value } = await reader.read();
        if (end) break;
        h.write(value, { at: done });
        done += value.byteLength;
        progress();
      }
      h.flush();
    } finally {
      h.close();
    }
  } else {
    const w = await handle.createWritable();
    try {
      for (;;) {
        const { done: end, value } = await reader.read();
        if (end) break;
        await w.write(value);
        done += value.byteLength;
        progress();
      }
    } finally {
      await w.close();
    }
  }
  if (size && done !== size) throw new Error(`incomplete download (${done} of ${size} bytes)`);
  return done;
}

self.onmessage = async (e: MessageEvent<Req>) => {
  try {
    const bytes = await save(e.data);
    post({ type: 'done', reqId: e.data.reqId, bytes });
  } catch (err) {
    post({ type: 'error', reqId: e.data.reqId, message: err instanceof Error ? err.message : String(err) });
  }
};
