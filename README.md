# Lücke — German in context

A cloze-sentence trainer for German. You learn words by filling the gap in real sentences, most common words first. It has spaced repetition, natural audio, points, daily goals and streaks.

- **30,000 sentences** in 30 levels covering ~8,900 words. Each sentence teaches its rarest common word, so level 1 is the ~400 most frequent words and later levels go further down the frequency list.
- **Three ways to answer:** multiple choice (4 pts), typing (8 pts) or listening (10 pts). A streak of correct answers adds up to +50%.
- **Spaced repetition.** Each correct answer moves a sentence 25% → 50% → 75% → 100% and waits 1 / 7 / 30 / 120 days before the next review (you can change the intervals). A wrong answer resets it to 0% and asks it again at the end of the round.
- **Natural audio, best source first:**
  1. **Native-speaker recordings** for ~10,900 sentences, streamed from Tatoeba.
  2. **Neural German voice** for everything else. Piper runs on your device and is downloaded once (~63 MB). After that it works offline.
  3. The browser's own voice, used only if the neural voice isn't available.
- **Stats:** points per day, mastery breakdown, upcoming reviews, progress per level.
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

`public/deck/` is generated and already included. To rebuild it from the latest Tatoeba export (downloads ~40 MB into `data/raw/`, takes about a minute):

```bash
python3 scripts/build_deck.py            # options: --target 30000 --per-word-audio 8
```

## Project layout

| Path | What |
|---|---|
| `scripts/build_deck.py` | Deck builder: frequency ranking, cloze choice, distractors, levels |
| `scripts/copy-tts-assets.mjs` | Copies the ONNX Runtime + Piper phonemizer WASM into `public/tts/` (runs automatically) |
| `src/lib/srs.ts` | Spaced-repetition scheduling |
| `src/lib/session.ts` | Builds rounds (due reviews first, then new sentences by level) |
| `src/lib/answer.ts` | Answer checking (case-insensitive; accepts ae/oe/ue/ss) |
| `src/lib/scoring.ts` | Points, daily stats, streaks |
| `src/lib/db.ts` | IndexedDB storage, backup export/import |
| `src/lib/audio/` + `src/workers/piper.worker.ts` | Audio sources: recording → neural voice → system voice |
| `src/components/` | Screens: Home, Play, Levels, Stats, Settings, Credits |

## Licences & credits

- Sentences and translations: [Tatoeba](https://tatoeba.org), CC BY 2.0 FR.
- Recordings: Tatoeba contributors, **CC BY 4.0 or CC BY-NC 4.0**. The speaker and licence are shown on every card. Because some recordings are NC (non-commercial), don't use the app commercially without first removing them. Recordings with no reusable licence are not used.
- Neural voice: Piper (MIT), piper-tts-web (MIT), ONNX Runtime Web (MIT). Voice models are by their dataset authors; see each model card.

Lücke is an independent project, not affiliated with any other language-learning service.
