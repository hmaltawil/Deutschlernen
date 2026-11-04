#!/usr/bin/env python3
"""Copy the deck's native-speaker recordings from Tatoeba and pack them per level.

1. Downloads each recording to data/audio/<audioId>.mp3 (local cache, not published).
2. Writes one bundle per level, public/audio/level-NN.pack (the MP3s back to back),
   and stores each recording's [offset, length] in the deck as `ap`.

Thirty bundles instead of ~11,000 files keeps offline storage fast to open on
iPhones (Safari slows down a lot with thousands of stored items). The app reads a
recording with a byte-range request, or from the bundle saved on the device.
Licences (CC BY / CC BY-NC) allow redistribution with attribution; speaker and
licence stay in the deck.

Run after build_deck.py:  python3 scripts/fetch_audio.py [--workers 6]
Already-downloaded files are skipped, so it is safe to re-run.
"""
from __future__ import annotations

import argparse
import bz2
import json
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DECK = ROOT / "public" / "deck"
OUT = ROOT / "data" / "audio"
PACKS = ROOT / "public" / "audio"
# Static file host (fast, parallel-friendly): one file per sentence, its first recording.
STATIC_URL = "https://audio.tatoeba.org/sentences/deu/{}.mp3"
# Per-recording endpoint (rate-limited): used when a sentence has several recordings,
# so the file always matches the speaker credited in the deck.
RECORDING_URL = "https://tatoeba.org/en/audio/download/{}"
AUDIO_INDEX = ROOT / "data" / "raw" / "deu_sentences_with_audio.tsv.bz2"
HEADERS = {"User-Agent": "luecke-deck-builder/1.0 (+https://github.com/hmaltawil/Deutschlernen)"}


def is_mp3(data: bytes) -> bool:
    return data[:3] == b"ID3" or (len(data) > 1 and data[0] == 0xFF and (data[1] & 0xE0) == 0xE0)


def fetch(audio_id: int, url: str) -> tuple[int, str]:
    dest = OUT / f"{audio_id}.mp3"
    if dest.exists() and dest.stat().st_size > 0:
        return audio_id, "skip"
    for attempt in range(4):
        try:
            req = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=30) as r:
                data = r.read()
            if not is_mp3(data):
                return audio_id, "not-mp3"
            tmp = dest.with_suffix(".part")
            tmp.write_bytes(data)
            tmp.replace(dest)
            return audio_id, "ok"
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return audio_id, "404"
            time.sleep(2 ** attempt * (5 if e.code == 429 else 1))
        except Exception:
            time.sleep(2 ** attempt)
    return audio_id, "failed"


def build_packs(manifest: dict) -> None:
    """One bundle per level; each item with a recording gets ap = [offset, length]."""
    PACKS.mkdir(parents=True, exist_ok=True)
    for old in PACKS.glob("*"):
        old.unlink()
    total = 0
    for lv in manifest["levels"]:
        path = DECK / lv["file"]
        items = json.loads(path.read_text(encoding="utf-8"))
        name = f"level-{lv['n']:02d}.pack"
        offset = 0
        with open(PACKS / name, "wb") as pack:
            for it in items:
                it.pop("ap", None)
                if "au" not in it:
                    continue
                src = OUT / f"{it['au'][0]}.mp3"
                if not src.exists():
                    continue  # app falls back to tatoeba.org / neural voice
                data = src.read_bytes()
                pack.write(data)
                it["ap"] = [offset, len(data)]
                offset += len(data)
        path.write_text(json.dumps(items, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        lv["pack"] = name
        lv["packBytes"] = offset
        total += offset
    manifest["audioBytes"] = total
    (DECK / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"packs: {len(manifest['levels'])} bundles, {total / 1e6:.0f} MB in {PACKS.relative_to(ROOT)}", file=sys.stderr)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--workers", type=int, default=6)
    args = ap.parse_args()
    manifest = json.loads((DECK / "manifest.json").read_text())
    # how many recordings each sentence has (multi-recording sentences need the per-recording URL)
    per_sentence: dict[int, int] = {}
    if AUDIO_INDEX.exists():
        with bz2.open(AUDIO_INDEX, "rt", encoding="utf-8") as f:
            for line in f:
                sid = int(line.split("\t", 1)[0])
                per_sentence[sid] = per_sentence.get(sid, 0) + 1
    jobs: list[tuple[int, str]] = []
    for lv in manifest["levels"]:
        for it in json.loads((DECK / lv["file"]).read_text()):
            if "au" in it:
                aid = it["au"][0]
                single = per_sentence.get(it["id"], 2) == 1
                jobs.append((aid, STATIC_URL.format(it["id"]) if single else RECORDING_URL.format(aid)))
    ids = [a for a, _ in jobs]
    OUT.mkdir(parents=True, exist_ok=True)
    stats: dict[str, int] = {}
    bad: list[int] = []
    t0 = time.time()
    with ThreadPoolExecutor(args.workers) as pool:
        futs = [pool.submit(fetch, aid, url) for aid, url in jobs]
        for n, f in enumerate(as_completed(futs), 1):
            aid, status = f.result()
            stats[status] = stats.get(status, 0) + 1
            if status not in ("ok", "skip"):
                bad.append(aid)
            if n % 500 == 0:
                print(f"  {n:,}/{len(ids):,} {stats} {time.time() - t0:.0f}s", file=sys.stderr, flush=True)
    size = sum(p.stat().st_size for p in OUT.glob("*.mp3"))
    build_packs(manifest)
    print(f"recordings: {stats}, {size / 1e6:.0f} MB in {OUT.relative_to(ROOT)}", file=sys.stderr)
    if bad:
        print(f"missing (app falls back to tatoeba.org / neural voice): {bad[:20]}{'…' if len(bad) > 20 else ''}", file=sys.stderr)


if __name__ == "__main__":
    main()
