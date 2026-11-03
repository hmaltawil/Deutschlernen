import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // GitHub Pages serves the site from /<repo>/; the deploy workflow sets BASE_PATH.
  base: process.env.BASE_PATH || '/',
  plugins: [react()],
  // The TTS libraries load their WASM at runtime; keep them out of pre-bundling.
  optimizeDeps: { exclude: ['@mintplex-labs/piper-tts-web', 'onnxruntime-web'] },
  worker: { format: 'es' },
  build: { target: 'es2022' },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
