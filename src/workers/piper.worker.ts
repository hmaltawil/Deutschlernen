/// <reference lib="webworker" />
/**
 * On-device neural German TTS (Piper via ONNX Runtime WASM).
 * Voice models are downloaded once from HuggingFace and cached in OPFS by the library.
 */
import { TtsSession, stored, remove } from '@mintplex-labs/piper-tts-web';

type Req =
  | { type: 'stored'; reqId: number }
  | { type: 'load'; reqId: number; voiceId: string }
  | { type: 'speak'; reqId: number; voiceId: string; text: string }
  | { type: 'remove'; reqId: number; voiceId: string };

const origin = self.location.origin;
const base = new URL(import.meta.env.BASE_URL, origin).href; // ends with /
const wasmPaths = {
  onnxWasm: `${base}tts/ort/`,
  piperData: `${base}tts/piper/piper_phonemize.data`,
  piperWasm: `${base}tts/piper/piper_phonemize.wasm`,
};

let session: TtsSession | null = null;
let sessionVoice = '';
let chain: Promise<unknown> = Promise.resolve();

function post(msg: unknown) {
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg);
}

async function ensure(voiceId: string, reqId: number): Promise<TtsSession> {
  if (session && sessionVoice === voiceId) return session;
  // TtsSession is a singleton inside the library: drop it to switch voices.
  TtsSession._instance = null;
  session = null;
  const s = new TtsSession({
    voiceId,
    wasmPaths,
    progress: (p) => {
      if (p.url.endsWith('.onnx')) post({ type: 'progress', reqId, loaded: p.loaded, total: p.total });
    },
  });
  await s.waitReady;
  session = s;
  sessionVoice = voiceId;
  return s;
}

async function handle(req: Req) {
  switch (req.type) {
    case 'stored':
      return { voices: await stored() };
    case 'load':
      await ensure(req.voiceId, req.reqId);
      return {};
    case 'speak': {
      const s = await ensure(req.voiceId, req.reqId);
      return { blob: await s.predict(req.text) };
    }
    case 'remove':
      if (sessionVoice === req.voiceId) {
        session = null;
        sessionVoice = '';
        TtsSession._instance = null;
      }
      await remove(req.voiceId);
      return {};
  }
}

self.onmessage = (e: MessageEvent<Req>) => {
  const req = e.data;
  // Serialise work: one model init / inference at a time.
  chain = chain.then(async () => {
    try {
      post({ type: 'done', reqId: req.reqId, ...(await handle(req)) });
    } catch (err) {
      if (req.type === 'load' || req.type === 'speak') {
        session = null;
        sessionVoice = '';
        TtsSession._instance = null;
      }
      post({ type: 'error', reqId: req.reqId, message: err instanceof Error ? err.message : String(err) });
    }
  });
};
