# Lücke — German cloze-sentence trainer

Notes for AI assistants (and humans) working on this repo. Read this first; it records how the
app fits together, decisions that were made on purpose, and bugs that were hard to find.

- **Live app:** https://hmaltawil.github.io/Deutschlernen/ (GitHub Pages, deployed on every push to `main`)
- **Repo:** https://github.com/hmaltawil/Deutschlernen (public — required for free GitHub Pages)
- **What it is:** learn German vocabulary in context by filling the gap in real Tatoeba sentences.
  Clozemaster-style mechanics, but its own name and design (don't copy Clozemaster branding/look).

## Working with the owner

- The owner is **not a developer**. Explain in plain language, give numbered click-by-click steps for
  anything they must do themselves (consoles, settings), and never ask them to paste secrets into chat.
- They use the app mostly as an **iPhone Home Screen app** (Safari / WebKit, iOS 18.7, dark mode) and
  on a computer. Hints/translations are in **English**. **Natural audio matters** to them.
- Keep **30 levels**. Ask before big or destructive changes; deploy and then verify on the live site.
- iPhone behaviour can't be tested here (no WebKit build in the cloud environment). For iPhone-only
  problems, ask for a screenshot and the numbers from **Settings → Startup time → Copy these numbers**.

## Commands

```bash
npm ci                                  # also copies voice runtime files into public/tts/<version>/
npm run dev                             # http://localhost:5173 (no service worker in dev)
BASE_PATH=/Deutschlernen/ npm run build # production build into dist/ (CI sets BASE_PATH itself)
npm test                                # unit tests (Vitest)
npm run test:rules                      # Firestore rules + sync against the emulator (needs Java)
npm run e2e                             # browser suites, see tests/e2e/README.md
python3 scripts/build_deck.py --report  # rebuild the sentence deck (downloads Tatoeba to data/raw/)
python3 scripts/fetch_audio.py          # download recordings to data/audio/ and rebuild the bundles
```

## Deploying

- Push to `main` → `.github/workflows/deploy.yml` runs `npm ci`, `npm test`, builds with
  `BASE_PATH=/<repo>/` and publishes to GitHub Pages (repo Settings → Pages → Source: GitHub Actions).
  Check with `gh run watch <id> --repo hmaltawil/Deutschlernen`.
- Users get updates automatically (service worker `autoUpdate`, `skipWaiting`). The new version takes
  over a few seconds after opening and the page reloads — **but never during a round**: `needReload()`
  in `src/lib/offline.ts` waits until you leave `/play` or tap "Next round" (`applyUpdateIfReady`).
  `watchForUpdates()` (at startup) also catches an update that took over before the registration ran.
- **Large binaries (recording bundles):** commit them in batches of ≤ 35 MB and push one commit at a
  time (`git push origin <sha>:refs/heads/main`) — big pushes through the proxy can fail. Push new
  bundles *before* the deck/code commit that references them, and delete old bundles in that last
  commit, so the live site never points at missing files.
- Renaming the repo or moving to a custom domain changes the origin: every user's local data
  (progress, saved voice/recordings) would be left behind. Avoid it.

## Layout

```
scripts/build_deck.py        deck builder (stdlib Python): Tatoeba → public/deck/{manifest,level-NN}.json
scripts/fetch_audio.py       recordings → data/audio/*.mp3 (local) → public/audio/level-NN-<hash>.pack
scripts/copy-tts-assets.mjs  ONNX Runtime + Piper phonemizer WASM → public/tts/<TTS_VERSION>/
scripts/tts-version.mjs      TTS_VERSION = ort<ver>-piper<ver> (also injected as __TTS_VERSION__)
public/deck/                 generated deck (committed)        public/audio/  generated bundles (committed)
src/store.tsx                React context: progress, days, settings; recordAnswer / setKnown; migrations
src/lib/db.ts                IndexedDB ('luecke' v1: progress, days, kv) — every call goes through withDb()
src/lib/srs.ts               stages 0–4, intervals 1/7/30/120 days, "known" sentences (keep their stage)
src/lib/session.ts           rounds (due reviews first, then new), currentLevel(), choices (seededRandom), requeue
src/lib/scoring.ts           points, day stats, streaks, goal history (goalOn)
src/lib/answer.ts            typed-answer checking (case-insensitive, ae/oe/ue/ss unless strict), onTrack()
src/lib/audio/               index.ts (source chain, unlock), recordings.ts (bundles), piper.ts, webspeech.ts
src/workers/                 piper.worker.ts (neural voice), recordings.worker.ts (writes bundles to OPFS)
src/lib/offline.ts           service-worker registration, saving bundles, cleanup of old caches
src/lib/sync/                code.ts (sync codes), core.ts (pure merge), firestore.ts, engine.ts, config.ts
src/lib/startup.ts           startup timing marks (Settings → Startup time), afterFirstScreen()
src/components/              Home, Play (card, summary), Levels, Stats, Settings, Sync, Credits, …
firestore.rules, firebase.json, tests/   Firestore security rules and their emulator tests
tests/e2e/                   Playwright browser suites (README there)
```

Not in git (rebuildable): `data/raw/` (Tatoeba exports), `data/audio/` (individual MP3s),
`public/tts/` (copied from node_modules), `dist/`.

## How the deck is built (deck v2)

`scripts/build_deck.py` (constants at the top; `--report` prints per-level statistics — always check them):

1. Rank every German word form across all ~786k Tatoeba sentences by frequency.
2. Candidates: 3–22 words, ≤ 160 chars, clean characters, ends with . ! ? …, has an English
   translation, no pre-1996 spelling (daß), no word rarer than rank 50,000.
3. Missing word = the rarest eligible word (rank ≤ 25,000; not a name — names are words that appear
   verbatim in the English translation, plus Maria/Marie and name possessives like "Lisas").
4. Difficulty = vocabulary (log rank of the missing word) + structure (length, rarest other word,
   grammar: clauses, relative clauses, Konjunktiv I/II, passive, pluperfect, um…zu, genitive
   prepositions, several clauses). Words are placed along the deck by frequency and get sentences
   whose structure percentile fits that place (curve tilted with `frac ** 0.6`), so common words come
   in short sentences and rare words in long, complex ones. Extra sentences with native audio are
   allowed for common words. A rarity cap per level keeps rare words out of early levels.
5. 30 equal levels (~1,090 sentences); 3 multiple-choice distractors per item (similar rank, same
   noun/non-noun class, similar length, no shared prefix).

Result: 32,672 sentences, 22,685 words, 6,148 with native audio (mostly in early levels — Tatoeba
recordings are short everyday sentences; later levels mostly use the neural voice).

Item format: `{id, de, c:[start,end], a, en, d:[3], r, au?:[audioId, speaker, "BY"|"BY-NC"], ap?:[offset,length]}`.

**Changing level assignment:** bump `DECK_VERSION`. On first start after the update the app re-files
every progress record under its new level (`migrateProgress`) and sync switches to new chunk ids
(`v<N>p<lv>`), so old and new levels never mix. Progress is keyed by the permanent Tatoeba sentence id.

## Audio (natural first)

1. **Native-speaker recording** (CC BY / CC BY-NC only; NC means non-commercial use only). Stored as
   **one bundle per level**: `public/audio/level-NN-<hash>.pack` = MP3s back to back; `ap` gives each
   recording's byte range. Played from the bundle saved on the device (OPFS `recordings/`), otherwise
   via an HTTP Range request to the bundle on the site, last resort tatoeba.org.
   A level's bundle is saved automatically when you start that level (setting); Settings → Offline →
   Save all recordings (89 MB). Bundle names carry a content hash; outdated ones are deleted on start.
2. **Neural voice** — Piper (`@mintplex-labs/piper-tts-web`, default `de_DE-thorsten-medium`, ~63 MB
   model from Hugging Face, stored in OPFS by the library) in a Web Worker.
3. **Browser speech** only if the neural voice isn't downloaded.

`fetch_audio.py` uses the fast static host `audio.tatoeba.org/sentences/deu/<sentenceId>.mp3` for
sentences with one recording; the per-recording endpoint is rate-limited (~1 request per 2 s).

## Offline

`vite-plugin-pwa` (generateSW, `autoUpdate`, `clientsClaim` + `skipWaiting` so the very first visit is
controlled). Precache = app shell + all deck JSON (~7 MB). Runtime cache `tts-runtime` for the voice
runtime files under `/tts/<TTS_VERSION>/`. **Recordings are never put in Cache Storage** (see pitfalls).

## Sync (optional, Firebase)

- Firebase project **`lucke-c0dc9`** (Spark/free plan), config in `src/lib/sync/config.ts` (public by
  design). Rules in `firestore.rules` (published by the owner in the Firebase console — if you change
  the file, give them the new text to paste into Firestore → Rules → Publish).
- No accounts: one device creates a 24-character sync code (Crockford base32, shown with a QR/link
  `#/sync?code=…`); the server only sees `SHA-256("luecke-sync-v1:" + code)` → `sync/<id>/chunks/<chunk>`.
  Rules allow read + create/update with size/shape checks; no listing across codes, no deletes.
- Chunks: `meta` (versions, resetAt), `v2p1…v2p30` (progress per level), `days` (per device), `settings`.
  One Firestore Lite transaction per sync; only changed chunks are read/written.
- Merge (`src/lib/sync/core.ts`, pure + unit-tested): per sentence the latest answer wins; each device
  owns its own day stats (totals are sums); newer settings win; "Reset progress" stores `resetAt` and
  clears every device. "Known" is an optional 8th column in progress rows.
- **Device-only settings** (`DEVICE_SETTINGS` in `src/lib/settings.ts`: voice, theme, autoSaveRecordings)
  are never taken from another device (a synced voice used to leave the other device on the robotic
  browser voice). They are still uploaded, so devices on an older version keep theirs. Changing only
  those doesn't bump `settingsUpdated`.
- **Import backup** (`importBackup`): re-files sentences under the current deck's levels (`levelIndex()`)
  and drops ones that left the deck; records older than `resetAt` get `last = resetAt + 1` (otherwise the
  next sync deletes a backup restored after a reset); if the reset came after the backup, the backup's
  other-device days become this device's own. Settings syncs first to learn about remote resets.
- Dirty marks (`markDirty`) are stored and also kept in memory; every step of the chain catches errors,
  so one failed IndexedDB write can't block sync for the rest of the session.
- Triggers: start, ~15 s after changes, end of round, online/visibility changes, every 3 min while open.
- Normal use is ~1% of the free daily quotas; the sync e2e suite writes ~150 docs per run.

## Hard-won lessons (don't regress these)

1. **iPhone + many stored items = slow start.** ~11,000 recordings as separate Cache Storage entries
   made Safari take ~10 s to open the app (0.2 s after removing them). Never store thousands of small
   items; bundle them (OPFS files) instead.
2. **iPhone drops IndexedDB connections** of apps left in the background ("Connection to Indexed
   Database server lost"). All DB calls go through `withDb()` (reconnect + retry once), and the UI never
   waits for a save: `recordAnswer` returns the new state immediately plus a `saved` promise.
3. **iPhone autoplay** needs a recent tap: audio is unlocked with a short silence on the first tap
   (`unlockAudio`), and the card calls `speak()` before any `await`.
4. Startup: only the deck manifest + IndexedDB are needed for the first screen; everything else runs in
   `afterFirstScreen()`. Don't enumerate caches/OPFS at startup.
5. GitHub Pages serves `.mp3` as `audio/mp3` (not `audio/mpeg`); `vite preview` answers missing files
   with `index.html` + 200 — always check the content type of fetched audio.
6. `piper-tts-web`'s `TtsSession` is a singleton: reset `TtsSession._instance` to switch voices. The
   ONNX Runtime WASM must match its JS version — hence the versioned `public/tts/<version>/` folder.
7. Long German compounds: choice buttons use `minmax(0, 1fr)`, stack one per row on phones when an option
   has ≥ 11 letters, and wrap with hyphenation (checked by `layout-*.cjs`).
8. Firestore emulator tests must run files one at a time (`fileParallelism: false`) — the rules test wipes
   the emulator between tests.
9. Playwright's `setOffline` doesn't stop service-worker fetches or media requests; the offline suites stop
   the local server / block the host for a real offline test.
10. **Choice order:** the old shuffle multiplied the seed by 1103515245 in plain JS numbers; above 2^53 the
   low bits are lost, so the answer was on button 1 in 0.1% and on button 4 in 47% of sentences. Use
   32-bit math (`Math.imul`, `seededRandom`); `session.test.ts` checks each button gets ~25%.
11. **Streaks** use the goal that applied on each day (`settings.goalHistory`, written when the goal
   changes), so changing the goal never rewrites past streak days.

## Ideas discussed, not built yet

**Per-sentence explanations** (button after answering). Agreed format, stored per level
(e.g. `public/deck/explain/level-NN.json`, loaded only when the button is first tapped, never at startup):

```json
{ "id": 9922313,
  "word": { "form": "Meeresspiegels", "lemma": "Meeresspiegel", "pos": "noun", "article": "der",
            "plural": "Meeresspiegel", "meaning": "sea level" },
  "why": "*Anstieg des …* means \"rise of the …\", which German says with the genitive …",
  "parts": "*Meer* (sea) + *Spiegel* (mirror, level)",
  "extra": "*den Behörden* is dative plural: *etwas ist jemandem verboten* = …" }
```

Rules: plain English, grammar terms explained, explain the German (not the loose English translation),
`why` ≤ 45 words, `extra` ≤ 30 words, ~90 words max, short for simple sentences, *italics* for German and
**bold** for the key ending only, leave optional fields out when unsure. Size ≈ 20 MB raw / ~6 MB
compressed for all sentences. Plan: pilot on level 1 (≈1,090 sentences) and compare two models before
doing all levels. Generating everything in a Claude session ≈ 5M output tokens (≈ 10× all code written for
this project); via the Batch API (list prices Oct 2026) roughly Haiku 5.5 ≈ $4–7, Sonnet 5.5 ≈ $75,
Opus 5.5 ≈ $150. An API key would be stored by the owner in the cloud environment's settings
(Network secrets) as `ANTHROPIC_API_KEY`, never pasted into chat. Dictionary facts (lemma, gender, POS)
could come from Wiktionary data instead of the model.
