import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { TTS_VERSION } from './scripts/tts-version.mjs';

export default defineConfig({
  // GitHub Pages serves the site from /<repo>/; the deploy workflow sets BASE_PATH.
  base: process.env.BASE_PATH || '/',
  define: { __TTS_VERSION__: JSON.stringify(TTS_VERSION) },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false, // registered in src/lib/offline.ts
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Lücke · German in context',
        short_name: 'Lücke',
        description: 'Learn German vocabulary by filling the gap in real sentences.',
        lang: 'en',
        start_url: '.',
        scope: '.',
        display: 'standalone',
        background_color: '#f6f4ee',
        theme_color: '#1f6f5c',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // App shell + all 30 sentence levels are saved on install (~6 MB).
        // Recordings are not cached here: they are saved per level as bundles (src/lib/audio/recordings.ts).
        globPatterns: ['**/*.{js,css,html,svg,png,json,webmanifest}'],
        globIgnores: ['tts/**', 'audio/**'],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
        // take control on the very first visit, so going offline right away still works
        clientsClaim: true,
        skipWaiting: true,
        runtimeCaching: [
          {
            // Neural-voice runtime (ONNX Runtime + phonemizer): cached the first time the voice is used.
            urlPattern: ({ url, sameOrigin }) => sameOrigin && url.pathname.includes('/tts/'),
            handler: 'CacheFirst',
            options: { cacheName: 'tts-runtime', cacheableResponse: { statuses: [200] } },
          },
        ],
      },
    }),
  ],
  // The TTS libraries load their WASM at runtime; keep them out of pre-bundling.
  optimizeDeps: { exclude: ['@mintplex-labs/piper-tts-web', 'onnxruntime-web'] },
  worker: { format: 'es' },
  build: { target: 'es2022' },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
