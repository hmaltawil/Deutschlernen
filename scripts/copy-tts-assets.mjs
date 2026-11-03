// Copies the on-device TTS runtime files (ONNX Runtime WASM + Piper phonemizer)
// from node_modules into public/tts so the app never depends on a CDN for them.
import { copyFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const nm = join(root, 'node_modules');
const out = join(root, 'public', 'tts');
const files = [
  ['onnxruntime-web/dist/ort-wasm-simd-threaded.mjs', 'ort/ort-wasm-simd-threaded.mjs'],
  ['onnxruntime-web/dist/ort-wasm-simd-threaded.wasm', 'ort/ort-wasm-simd-threaded.wasm'],
  ['@diffusionstudio/piper-wasm/build/piper_phonemize.wasm', 'piper/piper_phonemize.wasm'],
  ['@diffusionstudio/piper-wasm/build/piper_phonemize.data', 'piper/piper_phonemize.data'],
];
for (const [from, to] of files) {
  const src = join(nm, from);
  const dest = join(out, to);
  mkdirSync(dirname(dest), { recursive: true });
  if (existsSync(dest) && statSync(dest).size === statSync(src).size) continue;
  copyFileSync(src, dest);
  console.log(`tts asset: ${to}`);
}
