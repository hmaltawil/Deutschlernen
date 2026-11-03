// Version tag for the on-device voice runtime files. It goes into their URL
// (public/tts/<version>/…), so an app update that changes these libraries makes
// browsers fetch the new files instead of reusing cached old ones.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const nm = join(dirname(fileURLToPath(import.meta.url)), '..', 'node_modules');
const ver = (pkg) => JSON.parse(readFileSync(join(nm, pkg, 'package.json'), 'utf8')).version;

export const TTS_VERSION = `ort${ver('onnxruntime-web')}-piper${ver('@diffusionstudio/piper-wasm')}`;
