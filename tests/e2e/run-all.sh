#!/usr/bin/env bash
# Build the app, serve it locally, and run the browser test suites.
#   tests/e2e/run-all.sh            # local suites (no Firebase writes)
#   tests/e2e/run-all.sh --sync     # also the two-device sync suite (writes test data to the real Firebase project)
#   tests/e2e/run-all.sh --live     # run against the live site instead of a local build
# Needs Node + Playwright with Chromium (see README.md).
set -u
cd "$(dirname "$0")/../.."

PORT=4173
BASE=/Deutschlernen/
URL="http://localhost:${PORT}${BASE}"
SYNC=0
for arg in "$@"; do
  case "$arg" in
    --sync) SYNC=1 ;;
    --live) URL="https://hmaltawil.github.io${BASE}" ;;
  esac
done

if [[ "$URL" == http://localhost* ]]; then
  BASE_PATH=$BASE npm run build >/dev/null || { echo "build failed"; exit 1; }
  (BASE_PATH=$BASE npx vite preview --port $PORT --strictPort >/dev/null 2>&1 &)
  for _ in $(seq 1 40); do curl -s -o /dev/null "$URL" && break; sleep 0.5; done
fi

suites=(main modes options known home-levels migrate recordings offline update layout-choices layout-feedback layout-typing)
[[ $SYNC == 1 ]] && suites+=(sync)

failed=()
for s in "${suites[@]}"; do
  echo "== $s"
  out=$(node "tests/e2e/$s.cjs" "$URL" 2>&1)
  code=$?
  echo "$out" | grep -E "PASS|FAIL|ALL PASSED|FAILED|overflow|Error|Type |Listen |Choose " || true
  [[ $code == 0 ]] || failed+=("$s")
done

if [[ "$URL" == http://localhost* ]]; then pkill -f "vite.*previe[w] --port $PORT" || true; fi

if (( ${#failed[@]} )); then echo "FAILED: ${failed[*]}"; exit 1; fi
echo "all suites passed"
