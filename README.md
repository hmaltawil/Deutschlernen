# Lücke — German in context

A cloze-sentence trainer for German. You learn words by filling the gap in real sentences, most common words first. It has spaced repetition, natural audio, points, daily goals and streaks.

- **30,000 sentences** in 30 levels covering ~8,900 words. Each sentence teaches its rarest common word, so level 1 is the ~400 most frequent words and later levels go further down the frequency list.
- **Three ways to answer:** multiple choice (4 pts), typing (8 pts) or listening (10 pts). A streak of correct answers adds up to +50%.
- **Spaced repetition.** Each correct answer moves a sentence 25% → 50% → 75% → 100% and waits 1 / 7 / 30 / 120 days before the next review (you can change the intervals). A wrong answer resets it to 0% and asks it again at the end of the round.
- **Natural audio, best source first:**
  1. **Native-speaker recordings** for ~10,900 sentences, stored with the app as one bundle per level (`public/audio/level-NN.pack`), with tatoeba.org as a fallback.
  2. **Neural German voice** for everything else. Piper runs on your device and is downloaded once (~63 MB). After that it works offline.
  3. The browser's own voice, used only if the neural voice isn't available.
- **Works offline.** A service worker saves the app and all 30,000 sentences on the device (~6 MB). A level's recordings are saved on the device when you start playing it (0.4–12 MB per level), or all at once from Settings → Offline (148 MB). Without internet, recordings of unsaved levels are read by the neural voice.
  Recordings are kept as 30 bundles in the browser's private file system rather than ~11,000 separate cache entries: with that many entries Safari on iPhone took ~10 s to open the app (0.2 s with bundles).
- **Stats:** points per day, mastery breakdown, upcoming reviews, progress per level.
- **Sync between devices (optional).** Settings → Sync gives one device a secret 24-character sync code (with a QR code). Enter it on other devices and progress, points, streaks and settings stay in step. No account is needed; data is stored in Firebase Firestore under the SHA-256 of the code. Each sentence keeps its most recent answer, each device's points add up, and everything keeps working offline and syncs when you reconnect.
- **Your data stays on your device** (IndexedDB). Settings has export/import for backups.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
```

Production build (static files in `dist/`, can be hosted anywhere static):

```bash
npm run build
npm run preview
```

Tests:

```bash
npm test
```

## Rebuild the sentence deck

`public/deck/` and `public/audio/` are generated and already included. To rebuild them from the latest Tatoeba export (downloads ~40 MB into `data/raw/`, takes about a minute):

```bash
python3 scripts/build_deck.py            # options: --target 30000 --per-word-audio 8
```

Then download the recordings (~150 MB into `data/audio/`, about 15 minutes; files you already have are skipped) and rebuild the level bundles:

```bash
python3 scripts/fetch_audio.py
```

## Sync setup (Firebase)

1. Create a free Firebase project and a Firestore database (Standard edition, production mode).
2. Paste [`firestore.rules`](firestore.rules) into Firestore → Rules and publish.
3. Register a web app (Project settings → Your apps → `</>`) and put its `firebaseConfig` into `PROJECT` in [`src/lib/sync/config.ts`](src/lib/sync/config.ts). These values are public by design; the rules control access.

Without a config, the sync section is hidden and the app works locally as before.

Test the rules and the sync against the local Firestore emulator (needs Java):

```bash
npm run test:rules
```

## Project layout

| Path | What |
|---|---|
| `scripts/build_deck.py` | Deck builder: frequency ranking, cloze choice, distractors, levels |
| `scripts/fetch_audio.py` | Downloads the deck's recordings from Tatoeba and packs them into per-level bundles |
| `scripts/copy-tts-assets.mjs` | Copies the ONNX Runtime + Piper phonemizer WASM into `public/tts/` (runs automatically) |
| `src/lib/srs.ts` | Spaced-repetition scheduling |
| `src/lib/session.ts` | Builds rounds (due reviews first, then new sentences by level) |
| `src/lib/answer.ts` | Answer checking (case-insensitive; accepts ae/oe/ue/ss) |
| `src/lib/scoring.ts` | Points, daily stats, streaks |
| `src/lib/db.ts` | IndexedDB storage, backup export/import |
| `src/lib/offline.ts` + `vite.config.ts` (VitePWA) | Service worker, offline status, saving recording bundles |
| `src/lib/audio/recordings.ts` + `src/workers/recordings.worker.ts` | Reading recordings from bundles (device or byte ranges), saving bundles to the device |
| `src/lib/startup.ts` | Startup timing (Settings → Startup time) |
| `src/lib/sync/` | Sync: codes (`code.ts`), merge logic (`core.ts`), Firestore (`firestore.ts`), scheduling (`engine.ts`) |
| `firestore.rules`, `tests/` | Security rules and their emulator tests |
| `src/lib/audio/` + `src/workers/piper.worker.ts` | Audio sources: recording → neural voice → system voice |
| `src/components/` | Screens: Home, Play, Levels, Stats, Settings, Credits |

## Licences & credits

- Sentences and translations: [Tatoeba](https://tatoeba.org), CC BY 2.0 FR.
- Recordings: Tatoeba contributors, **CC BY 4.0 or CC BY-NC 4.0**, redistributed here with attribution. The speaker and licence are shown on every card. Because some recordings are NC (non-commercial), don't use the app commercially without first removing them. Recordings with no reusable licence are not used.
- Neural voice: Piper (MIT), piper-tts-web (MIT), ONNX Runtime Web (MIT). Voice models are by their dataset authors; see each model card.

Lücke is an independent project, not affiliated with any other language-learning service.
