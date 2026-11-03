/** Main-thread client for the Piper worker, with an LRU cache of synthesized clips. */

export type VoiceState = 'unknown' | 'missing' | 'downloading' | 'ready' | 'error';

export interface VoiceStatus {
  state: VoiceState;
  voiceId: string;
  progress: number; // 0..1 while downloading
  error?: string;
}

type Pending = { resolve: (v: any) => void; reject: (e: Error) => void; onProgress?: (f: number) => void };

const CACHE_MAX = 40;

class PiperClient {
  private worker: Worker | null = null;
  private seq = 0;
  private pending = new Map<number, Pending>();
  private cache = new Map<string, Promise<string>>(); // key → object URL
  private listeners = new Set<(s: VoiceStatus) => void>();
  private loading: Promise<void> | null = null;
  status: VoiceStatus = { state: 'unknown', voiceId: '', progress: 0 };

  private get w(): Worker {
    if (!this.worker) {
      this.worker = new Worker(new URL('../../workers/piper.worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e) => {
        const msg = e.data;
        const p = this.pending.get(msg.reqId);
        if (!p) return;
        if (msg.type === 'progress') {
          p.onProgress?.(msg.total ? msg.loaded / msg.total : 0);
          return;
        }
        this.pending.delete(msg.reqId);
        if (msg.type === 'error') p.reject(new Error(msg.message));
        else p.resolve(msg);
      };
      this.worker.onerror = (e) => {
        const err = new Error(e.message || 'voice worker failed');
        for (const p of this.pending.values()) p.reject(err);
        this.pending.clear();
      };
    }
    return this.worker;
  }

  private call<T>(msg: Record<string, unknown>, onProgress?: (f: number) => void): Promise<T> {
    const reqId = ++this.seq;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(reqId, { resolve, reject, onProgress });
      this.w.postMessage({ ...msg, reqId });
    });
  }

  private set(s: Partial<VoiceStatus>) {
    this.status = { ...this.status, ...s };
    for (const l of this.listeners) l(this.status);
  }

  subscribe(fn: (s: VoiceStatus) => void): () => void {
    this.listeners.add(fn);
    fn(this.status);
    return () => this.listeners.delete(fn);
  }

  get supported(): boolean {
    return typeof Worker !== 'undefined' && typeof WebAssembly !== 'undefined' && !!navigator.storage?.getDirectory;
  }

  /** Check whether the voice is already stored on this device (no download). */
  async check(voiceId: string): Promise<VoiceState> {
    if (!this.supported) {
      this.set({ state: 'error', voiceId, error: 'This browser cannot run the on-device voice.' });
      return 'error';
    }
    if (this.status.voiceId === voiceId && (this.status.state === 'ready' || this.status.state === 'downloading')) {
      return this.status.state;
    }
    try {
      const { voices } = await this.call<{ voices: string[] }>({ type: 'stored' });
      const state: VoiceState = voices.includes(voiceId) ? 'ready' : 'missing';
      this.set({ state, voiceId, progress: state === 'ready' ? 1 : 0, error: undefined });
      return state;
    } catch (e) {
      this.set({ state: 'error', voiceId, error: (e as Error).message });
      return 'error';
    }
  }

  /** Download (if needed) and initialise the voice. */
  load(voiceId: string): Promise<void> {
    if (this.loading && this.status.voiceId === voiceId) return this.loading;
    this.set({ state: 'downloading', voiceId, progress: 0, error: undefined });
    this.cache.clear();
    this.loading = this.call<void>({ type: 'load', voiceId }, (f) => this.set({ progress: f }))
      .then(() => {
        this.set({ state: 'ready', progress: 1 });
        this.primeOffline(voiceId);
        navigator.storage?.persist?.().catch(() => {});
      })
      .catch((e: Error) => {
        this.set({ state: 'error', error: e.message });
        throw e;
      })
      .finally(() => {
        this.loading = null;
      });
    return this.loading;
  }

  /** Load an already-downloaded voice into memory in the background (no status change). */
  warm(voiceId: string): void {
    if (this.status.state !== 'ready' || this.status.voiceId !== voiceId || this.loading) return;
    this.call({ type: 'load', voiceId }).catch(() => {});
    this.primeOffline(voiceId);
  }

  private primed = false;
  /**
   * Speak a word once in the background so every runtime file the voice needs
   * (WASM, phonemizer data) is fetched now and kept by the offline cache.
   */
  private primeOffline(voiceId: string) {
    if (this.primed) return;
    this.primed = true;
    this.synth('Hallo.', voiceId).catch(() => {
      this.primed = false;
    });
  }

  async remove(voiceId: string): Promise<void> {
    await this.call({ type: 'remove', voiceId });
    this.cache.clear();
    this.set({ state: 'missing', voiceId, progress: 0 });
  }

  /** Synthesize `text`; returns an object URL for a WAV clip. Cached per voice+text. */
  synth(text: string, voiceId: string): Promise<string> {
    const key = `${voiceId}\u0000${text}`;
    const hit = this.cache.get(key);
    if (hit) {
      this.cache.delete(key); // refresh LRU position
      this.cache.set(key, hit);
      return hit;
    }
    const p = this.call<{ blob: Blob }>({ type: 'speak', voiceId, text }).then((r) => URL.createObjectURL(r.blob));
    p.catch(() => this.cache.delete(key));
    this.cache.set(key, p);
    while (this.cache.size > CACHE_MAX) {
      const [oldKey, oldP] = this.cache.entries().next().value as [string, Promise<string>];
      this.cache.delete(oldKey);
      oldP.then((u) => URL.revokeObjectURL(u)).catch(() => {});
    }
    return p;
  }
}

export const piper = new PiperClient();
