// Copies the on-device TTS runtime files (ONNX Runtime WASM + Piper phonemizer)
// from node_modules into public/tts/<version>/ so the app never depends on a CDN
// for them, and a library update gets a new URL (no stale cached copies).
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TTS_VERSION } from './tts-version.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const nm = join(root, 'node_modules');
const base = join(root, 'public', 'tts');
const out = join(base, TTS_VERSION);
const files = [
  ['onnxruntime-web/dist/ort-wasm-simd-threaded.mjs', 'ort/ort-wasm-simd-threaded.mjs'],
  ['onnxruntime-web/dist/ort-wasm-simd-threaded.wasm', 'ort/ort-wasm-simd-threaded.wasm'],
  ['@diffusionstudio/piper-wasm/build/piper_phonemize.wasm', 'piper/piper_phonemize.wasm'],
  ['@diffusionstudio/piper-wasm/build/piper_phonemize.data', 'piper/piper_phonemize.data'],
];
// remove other versions (and the old unversioned layout)
if (existsSync(base)) for (const name of readdirSync(base)) if (name !== TTS_VERSION) rmSync(join(base, name), { recursive: true, force: true });
for (const [from, to] of files) {
  const src = join(nm, from);
  const dest = join(out, to);
  mkdirSync(dirname(dest), { recursive: true });
  if (existsSync(dest) && statSync(dest).size === statSync(src).size) continue;
  copyFileSync(src, dest);
  console.log(`tts asset: ${TTS_VERSION}/${to}`);
}
