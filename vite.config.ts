import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  // GitHub Pages serves the site from /<repo>/; the deploy workflow sets BASE_PATH.
  base: process.env.BASE_PATH || '/',
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
        globPatterns: ['**/*.{js,css,html,svg,png,json,webmanifest}'],
        globIgnores: ['tts/**', 'audio/**'],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            // Neural-voice runtime (ONNX Runtime + phonemizer): cached the first time the voice is used.
            urlPattern: ({ url, sameOrigin }) => sameOrigin && url.pathname.includes('/tts/'),
            handler: 'CacheFirst',
            options: { cacheName: 'tts-runtime', cacheableResponse: { statuses: [200] } },
          },
          {
            // Native-speaker recordings: cached as they are played (or all at once from Settings).
            urlPattern: ({ url, sameOrigin }) => sameOrigin && /\/audio\/\d+\.mp3$/.test(url.pathname),
            handler: 'CacheFirst',
            options: {
              cacheName: 'recordings',
              cacheableResponse: { statuses: [200], headers: { 'content-type': 'audio/mpeg' } },
              expiration: { maxEntries: 20000 },
            },
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
