#!/usr/bin/env python3
"""Build the Lücke sentence deck from Tatoeba exports.

Downloads German/English sentences, their links and the German audio index
from https://downloads.tatoeba.org (CC BY 2.0 FR), then:

  1. ranks every German word form by corpus frequency,
  2. filters sentences to short, clean, translated ones,
  3. picks the rarest eligible word in each sentence as the cloze word,
  4. keeps up to a few sentences per word (native-speaker audio first),
  5. sorts by difficulty into levels and adds multiple-choice distractors.

Output: public/deck/manifest.json and public/deck/level-NN.json
Run:    python3 scripts/build_deck.py [--target 30000] [--offline]
Stdlib only; deterministic for a given set of input files.
"""
from __future__ import annotations

import argparse
import bz2
import collections
import json
import random
import re
import sys
import unicodedata
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
OUT = ROOT / "public" / "deck"
BASE_URL = "https://downloads.tatoeba.org/exports/per_language"
FILES = {
    "deu": "deu/deu_sentences.tsv.bz2",
    "eng": "eng/eng_sentences.tsv.bz2",
    "links": "deu/deu-eng_links.tsv.bz2",
    "audio": "deu/deu_sentences_with_audio.tsv.bz2",
}

LEVEL_SIZE = 1000
MAX_CLOZE_RANK = 20000      # cloze word must be among the N most frequent forms
MAX_ANY_RANK = 40000        # skip sentences containing rarer (non-name) words
PER_WORD = 3                # sentences per cloze word
PER_WORD_AUDIO = 8           # ... allowed when the extra ones have human audio
MIN_TOKENS, MAX_TOKENS = 3, 14
MAX_CHARS = 95
SEED = 20261103

WORD_RE = re.compile(r"[^\W\d_]+(?:-[^\W\d_]+)*")
EN_WORD_RE = re.compile(r"[A-Za-z]+")
ALLOWED_RE = re.compile(r"^[A-Za-zÄÖÜäöüßéèêàáâçñóôíúëïÉ ,.;:!?\-–—…„“”\"»«‚‘()]+$")
ENDING_RE = re.compile(r"[.!?…]$")
GERMAN_ONLY = re.compile(r"^[A-Za-zÄÖÜäöüß]+$")


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def ensure_downloads(offline: bool):
    RAW.mkdir(parents=True, exist_ok=True)
    for rel in FILES.values():
        dest = RAW / Path(rel).name
        if dest.exists() and dest.stat().st_size > 0:
            continue
        if offline:
            sys.exit(f"missing {dest} (offline mode)")
        url = f"{BASE_URL}/{rel}"
        log(f"downloading {url}")
        with urllib.request.urlopen(url, timeout=300) as r, open(dest, "wb") as f:
            while chunk := r.read(1 << 20):
                f.write(chunk)


def tsv(name: str):
    with bz2.open(RAW / Path(FILES[name]).name, "rt", encoding="utf-8") as f:
        for line in f:
            yield line.rstrip("\n").split("\t")


def norm(text: str) -> str:
    return re.sub(r"\s+", " ", unicodedata.normalize("NFC", text)).strip()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--target", type=int, default=30000)
    ap.add_argument("--offline", action="store_true")
    ap.add_argument("--per-word-audio", type=int, default=PER_WORD_AUDIO)
    args = ap.parse_args()
    ensure_downloads(args.offline)

    # ---- 1. German corpus + word frequencies -------------------------------
    log("reading German sentences…")
    deu: dict[int, str] = {}
    freq = collections.Counter()
    cap_mid = collections.Counter()      # capitalised, not sentence-initial
    low_mid = collections.Counter()      # lowercase, not sentence-initial
    for row in tsv("deu"):
        if len(row) < 3:
            continue
        sid, text = int(row[0]), norm(row[2])
        deu[sid] = text
        for i, m in enumerate(WORD_RE.finditer(text)):
            w = m.group()
            lw = w.lower()
            freq[lw] += 1
            if i > 0:
                (cap_mid if w[0].isupper() else low_mid)[lw] += 1
    rank = {w: i + 1 for i, (w, _) in enumerate(freq.most_common())}
    log(f"  {len(deu):,} sentences, {len(rank):,} word forms")

    def is_noun(lw: str) -> bool:
        c, l = cap_mid[lw], low_mid[lw]
        return c + l > 0 and c / (c + l) >= 0.6

    # ---- 2. English translations ------------------------------------------
    log("reading links…")
    links: dict[int, list[int]] = collections.defaultdict(list)
    for row in tsv("links"):
        if len(row) >= 2:
            links[int(row[0])].append(int(row[1]))
    need = {e for es in links.values() for e in es}
    log("reading English sentences…")
    eng: dict[int, str] = {}
    for row in tsv("eng"):
        if len(row) >= 3:
            eid = int(row[0])
            if eid in need:
                eng[eid] = norm(row[2])

    # ---- 3. Native-speaker audio (only reusable licences) -----------------
    audio: dict[int, tuple[int, str, str]] = {}
    for row in tsv("audio"):
        if len(row) < 4:
            continue
        lic = row[3].strip()
        if lic not in ("CC BY 4.0", "CC BY-NC 4.0"):
            continue
        sid = int(row[0])
        entry = (int(row[1]), row[2], "BY" if lic == "CC BY 4.0" else "BY-NC")
        # prefer the more permissive licence when a sentence has several
        if sid not in audio or (audio[sid][2] != "BY" and entry[2] == "BY"):
            audio[sid] = entry
    log(f"  {len(audio):,} sentences with reusable native audio")

    # ---- 4. Names / giveaways ----------------------------------------------
    # A capitalised word that shows up verbatim in the English translation
    # most of the time is a name or international word (Tom, Maria, Boston).
    seen_cap = collections.Counter()
    in_en = collections.Counter()
    for sid, es in links.items():
        text = deu.get(sid)
        if not text:
            continue
        en_tokens = set()
        for e in es:
            if e in eng:
                en_tokens.update(EN_WORD_RE.findall(eng[e]))
        for m in WORD_RE.finditer(text):
            w = m.group()
            if w[0].isupper():
                seen_cap[w] += 1
                if w in en_tokens:
                    in_en[w] += 1
    names = {w.lower() for w, n in seen_cap.items() if n >= 3 and in_en[w] / n >= 0.5}
    log(f"  {len(names):,} name-like words excluded from cloze")

    # ---- 5. Candidate sentences -------------------------------------------
    log("selecting candidates…")
    cands = []
    for sid, es in links.items():
        text = deu.get(sid)
        if not text or len(text) > MAX_CHARS or not ALLOWED_RE.match(text) or not ENDING_RE.search(text):
            continue
        toks = list(WORD_RE.finditer(text))
        if not (MIN_TOKENS <= len(toks) <= MAX_TOKENS):
            continue
        if any(len(m.group()) == 1 and m.group().lower() not in ("a", "o") for m in toks):
            continue
        trans = sorted((e for e in es if e in eng and len(eng[e]) <= 120), key=lambda e: e)
        if not trans:
            continue
        en = eng[trans[0]]
        en_lower = {t.lower() for t in EN_WORD_RE.findall(en)}
        lows = [m.group().lower() for m in toks]
        counts = collections.Counter(lows)
        if any(rank[lw] > MAX_ANY_RANK and lw not in names for lw in lows):
            continue
        if any("ß" in lw and freq[lw.replace("ß", "ss")] > freq[lw] for lw in lows):
            continue  # pre-1996 spelling (daß, muß, paßt)
        best = None
        for m, lw in zip(toks, lows):
            w = m.group()
            if lw in names or counts[lw] > 1 or not GERMAN_ONLY.match(w) or len(w) < 2:
                continue
            r = rank[lw]
            if r > MAX_CLOZE_RANK:
                continue
            if len(lw) >= 4 and lw in en_lower:          # giveaway (Hotel → hotel)
                continue
            if best is None or r > best[0]:
                best = (r, m)
        if best is None:
            continue
        r, m = best
        cands.append({
            "id": sid, "de": text, "c": [m.start(), m.end()], "a": m.group(),
            "en": en, "r": r, "lw": m.group().lower(), "n": len(toks),
            "au": audio.get(sid), "toks": set(lows),
        })
    log(f"  {len(cands):,} candidate sentences ({sum(1 for c in cands if c['au']):,} with audio)")

    # ---- 6. Deck selection ------------------------------------------------
    by_word: dict[str, list[dict]] = collections.defaultdict(list)
    for c in cands:
        by_word[c["lw"]].append(c)

    def pref(c):  # audio first, then ~7 tokens, then shorter, then id
        return (c["au"] is None, abs(c["n"] - 7), len(c["de"]), c["id"])

    deck: list[dict] = []
    for lw in sorted(by_word, key=lambda w: rank[w]):
        group = sorted(by_word[lw], key=pref)
        picked = group[:PER_WORD]
        picked += [c for c in group[PER_WORD:args.per_word_audio] if c["au"]]
        for k, c in enumerate(picked):
            c["k"] = k
        deck.extend(picked)
        if len(deck) >= args.target:
            break
    deck = deck[: args.target]
    words_covered = len({c["lw"] for c in deck})

    # Order by difficulty. Later sentences for the same word are pushed back a
    # bit so the same word does not appear three times in a row.
    deck.sort(key=lambda c: (c["r"] * (1 + 0.25 * c["k"]) + 40 * c["k"], c["id"]))

    # ---- 7. Distractors ----------------------------------------------------
    pool: dict[bool, list[str]] = {True: [], False: []}
    for w, r in sorted(rank.items(), key=lambda x: x[1]):
        if r > MAX_CLOZE_RANK + 5000:
            break
        if w in names or not GERMAN_ONLY.match(w) or len(w) < 2 or freq[w] < 5:
            continue
        pool[is_noun(w)].append(w)
    pool_rank_index = {k: [rank[w] for w in v] for k, v in pool.items()}

    import bisect

    def distractors(c) -> list[str]:
        ans = c["a"]
        lw = c["lw"]
        noun = ans[0].isupper() if c["c"][0] > 0 else is_noun(lw)
        words, ranks = pool[noun], pool_rank_index[noun]
        rng = random.Random(SEED + c["id"])
        pre = lw[: min(4, len(lw))]
        chosen: list[str] = []
        for width in (300, 800, 2000, 6000, 30000):
            lo = bisect.bisect_left(ranks, c["r"] - width)
            hi = bisect.bisect_right(ranks, c["r"] + width)
            opts = [
                w for w in words[lo:hi]
                if w != lw and w not in chosen and w not in c["toks"]
                and abs(len(w) - len(lw)) <= 3
                and not w.startswith(pre) and not lw.startswith(w[: min(4, len(w))])
            ]
            rng.shuffle(opts)
            for w in opts:
                if len(chosen) == 3:
                    break
                chosen.append(w)
            if len(chosen) == 3:
                break
        out = []
        for w in chosen:
            if noun or c["c"][0] == 0:
                w = w[0].upper() + w[1:]
            out.append(w)
        return out

    # ---- 8. Write -----------------------------------------------------------
    OUT.mkdir(parents=True, exist_ok=True)
    for old in OUT.glob("level-*.json"):
        old.unlink()
    levels = []
    n_levels = (len(deck) + LEVEL_SIZE - 1) // LEVEL_SIZE
    audio_total = 0
    for li in range(n_levels):
        chunk = deck[li * LEVEL_SIZE:(li + 1) * LEVEL_SIZE]
        random.Random(SEED + li).shuffle(chunk)
        items = []
        for c in chunk:
            item = {"id": c["id"], "de": c["de"], "c": c["c"], "a": c["a"], "en": c["en"],
                    "d": distractors(c), "r": c["r"]}
            if c["au"]:
                item["au"] = list(c["au"])
            items.append(item)
        # ---- sanity checks
        for it in items:
            s, e = it["c"]
            assert it["de"][s:e] == it["a"], it
            assert len(it["d"]) == 3 and len(set(x.lower() for x in it["d"])) == 3, it
            assert it["a"].lower() not in (x.lower() for x in it["d"]), it
        n_audio = sum(1 for it in items if "au" in it)
        audio_total += n_audio
        fname = f"level-{li + 1:02d}.json"
        (OUT / fname).write_text(json.dumps(items, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        levels.append({
            "n": li + 1, "file": fname, "count": len(items), "audio": n_audio,
            "minRank": min(c["r"] for c in chunk), "maxRank": max(c["r"] for c in chunk),
        })
    manifest = {
        "version": 1,
        "language": "de",
        "hintLanguage": "en",
        "total": len(deck),
        "audio": audio_total,
        "words": words_covered,
        "levels": levels,
        "credits": {
            "sentences": "Sentences and translations from Tatoeba (https://tatoeba.org), CC BY 2.0 FR.",
            "audio": "Native-speaker recordings from Tatoeba contributors, CC BY 4.0 / CC BY-NC 4.0 as marked.",
        },
    }
    (OUT / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")
    size = sum(p.stat().st_size for p in OUT.glob("*.json"))
    log(f"deck: {len(deck):,} sentences, {words_covered:,} words, {audio_total:,} with native audio, "
        f"{n_levels} levels, {size / 1e6:.1f} MB")
    assert len(deck) >= min(args.target, 1000)


if __name__ == "__main__":
    main()
