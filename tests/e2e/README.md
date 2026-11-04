# Browser test suites

Real-browser checks (Playwright + Chromium) for the things unit tests can't see:
audio sources, offline mode, saving, sync between devices, layout on phones.

```bash
npm run e2e                         # build, serve locally, run the local suites
bash tests/e2e/run-all.sh --sync    # + two-device sync (writes test data to the real Firebase project)
bash tests/e2e/run-all.sh --live    # same suites against https://hmaltawil.github.io/Deutschlernen/
node tests/e2e/known.cjs http://localhost:4173/Deutschlernen/   # one suite
```

Setup outside the Claude Code cloud environment (which has Chromium preinstalled):
`npm i -g playwright && npx playwright install chromium`.
Each suite takes the app URL (with the `/Deutschlernen/` base path) as its first argument
and prints `PASS`/`FAIL` lines; it exits non-zero on failure. Screenshots go to
`tests/e2e/screenshots/` (git-ignored) — look at them for layout changes.

| Suite | What it checks |
|---|---|
| `main.cjs` | Full rounds in all modes, wrong answers re-asked, points, persistence after reload, ASCII umlaut input, listening mode, native recording + neural voice download, export/reset/import, stats chart, phone layout without sideways scrolling |
| `modes.cjs` | Choose / Type / Listen: after an answer the card shows points, mastery, "I know this", and audio plays |
| `options.cjs` | Settings → While you answer: speaker hidden before answering (and the option to show it), colour hint while typing, same-size box, strict ä/ö/ü/ß, second try for small typos |
| `update.cjs` | A new version (simulated by changing `dist/sw.js`) never reloads the page during a round; it loads when you leave the round or tap "Next round", and right away on Home. Local preview only |
| `known.cjs` | "I know this" (button, K key, undo, no re-ask, Known filter, Review again) and "your level" on Home |
| `migrate.cjs` | Progress from an older deck is re-filed under the new levels once |
| `recordings.cjs` | Recording bundles: auto-save of the played level, offline playback, Save all / Stop / Remove, cleanup of outdated bundles and of the old per-recording cache |
| `offline.cjs` | Service worker: the app opens with no internet (server really stopped), saved recordings play, unsaved ones fall back to the neural voice, progress is kept |
| `sync.cjs` | Three browsers sharing a sync code: merge, points, settings, offline answers, join via link, reset reaches all, turning off keeps data. **Uses the real Firebase project** (or an emulator build, below) |
| `dropdb.cjs` | Safari dropping the database connection (iPhone app in background): answers still show, play audio and save. Needs a test build (below) |
| `layout-choices.cjs`, `layout-feedback.cjs` | Longest German words at 320–1000 px in light and dark: nothing sticks out of the card (uses the built CSS; run `npm run build` first) |
| `startup.cjs` | Startup time with the CPU slowed 6× in several states (voice, all recordings saved, sync on) |

Special builds:

```bash
# test hook for dropdb.cjs (window.__dropDb); never deploy this build
BASE_PATH=/Deutschlernen/ VITE_TEST_HOOKS=1 npx vite build --outDir /tmp/dist-test
BASE_PATH=/Deutschlernen/ npx vite preview --outDir /tmp/dist-test --port 4184

# sync against the local Firestore emulator instead of the real project (needs Java)
npx -y firebase-tools@15.34.0 emulators:start --only firestore --project demo-luecke &
BASE_PATH=/Deutschlernen/ VITE_FIREBASE_CONFIG='{"projectId":"demo-luecke","apiKey":"demo","appId":"demo"}' \
  VITE_FIRESTORE_EMULATOR=127.0.0.1:8085 npx vite build --outDir /tmp/dist-emu
```

Tips: a suite that waits ~30 s and times out on the live site is usually network
flakiness — run it again. When matching processes with `pkill -f`, use a bracket
pattern (`vite.*previe[w]`) so the command doesn't match the shell running it.
