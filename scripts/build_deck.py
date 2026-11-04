#!/usr/bin/env python3
"""Build the Lücke sentence deck from Tatoeba exports.

Downloads German/English sentences, their links and the German audio index
from https://downloads.tatoeba.org (CC BY 2.0 FR), then:

  1. ranks every German word form by corpus frequency,
  2. filters sentences to clean, translated ones (3–22 words),
  3. picks the rarest eligible word in each sentence as the missing (cloze) word,
  4. gives every sentence a difficulty score for the WHOLE sentence:
       - how rare the missing word is            (vocabulary)
       - how rare the other words are            (context)
       - how long the sentence is                (length)
       - grammar: subordinate/relative clauses, Konjunktiv, passive,
         um … zu, genitive prepositions, several clauses
  5. keeps 1–3 sentences per word (native-speaker audio preferred), covering
     the most common ~25,000 word forms,
  6. sorts by difficulty into 30 equal levels and adds multiple-choice distractors.

Output: public/deck/manifest.json and public/deck/level-NN.json
Run:    python3 scripts/build_deck.py [--offline] [--report]
Then:   python3 scripts/fetch_audio.py   (recordings + per-level bundles)
Stdlib only; deterministic for a given set of input files.
"""
from __future__ import annotations

import argparse
import bisect
import bz2
import collections
import json
import math
import random
import re
import statistics
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

DECK_VERSION = 2
LEVELS = 30
MAX_CLOZE_RANK = 25000      # missing word must be among the N most frequent forms
MAX_ANY_RANK = 50000        # skip sentences containing rarer (non-name) words
MIN_TOKENS, MAX_TOKENS = 3, 22
MAX_CHARS = 160
MAX_EN_CHARS = 220
SEED = 20261104


def per_word(rank: int) -> int:
    """How many sentences to keep for a missing word of this rank."""
    if rank <= 1500:
        return 3
    if rank <= 6000:
        return 2
    return 1


def extra_audio(rank: int) -> int:
    """Extra sentences allowed for a word, only if they have native-speaker audio."""
    if rank <= 3000:
        return 4
    if rank <= 10000:
        return 2
    return 1


AUDIO_FIT = 0.25  # an extra recorded sentence must be this close to the level's structure target


# difficulty weights (sum 1): vocabulary, context, length, grammar
W_VOCAB, W_CONTEXT, W_LENGTH, W_GRAMMAR = 0.42, 0.18, 0.22, 0.18

WORD_RE = re.compile(r"[^\W\d_]+(?:-[^\W\d_]+)*")
EN_WORD_RE = re.compile(r"[A-Za-z]+")
ALLOWED_RE = re.compile(r"^[A-Za-zÄÖÜäöüßéèêàáâçñóôíúëïÉ ,.;:!?\-–—…„“”\"»«‚‘()]+$")
ENDING_RE = re.compile(r"[.!?…]$")
GERMAN_ONLY = re.compile(r"^[A-Za-zÄÖÜäöüß]+$")

# ---- grammar markers -------------------------------------------------------
SUBORDINATORS = {
    "dass", "weil", "obwohl", "obgleich", "falls", "ob", "damit", "nachdem", "bevor", "ehe",
    "seitdem", "sobald", "solange", "sodass", "indem", "wenn", "als", "während", "bis", "seit",
}
RELATIVE_RE = re.compile(
    r", (?:\w+ )?(?:der|die|das|dem|den|deren|dessen|denen|welche[rsmn]?|wo|was|wor\w+|wom\w+|wof\w+|wob\w+)\b"
)
KONJ2 = {
    "wäre", "wären", "wärst", "wäret", "hätte", "hätten", "hättest", "hättet", "würde", "würden",
    "würdest", "würdet", "könnte", "könnten", "könntest", "müsste", "müssten", "müsstest", "dürfte",
    "dürften", "wüsste", "wüssten", "käme", "kämen", "ginge", "gäbe", "bliebe", "täte",
}

PASSIVE_AUX = {"wurde", "wurden", "worden", "wird", "werden", "wirst", "werde"}
PERFECT_AUX = {"hatte", "hatten", "hattest", "war", "waren", "warst"}
GENITIVE_PREP = {"wegen", "trotz", "statt", "anstatt", "innerhalb", "außerhalb", "aufgrund", "mithilfe", "angesichts", "bezüglich", "infolge"}


def looks_participle(w: str) -> bool:
    return len(w) > 4 and (w.startswith("ge") or "ge" in w[2:6]) and (w.endswith("t") or w.endswith("en"))


def grammar_points(text: str, lows: list[str]) -> tuple[float, list[str]]:
    """Rough difficulty points for grammar; returns (points, tags)."""
    tags: list[str] = []
    s = set(lows)
    commas = text.count(",") + text.count(";")
    if s & SUBORDINATORS and commas:
        tags.append("clause")
    if RELATIVE_RE.search(text):
        tags.append("relative")
    if s & KONJ2:
        tags.append("konj2")
    if "sei" in s or "seien" in s or ({"habe", "werde"} & s and ("dass" not in s) and commas and any(w in s for w in ("sagte", "behauptet", "meint", "sagt"))):
        tags.append("konj1")
    if "worden" in s or (s & PASSIVE_AUX and any(looks_participle(w) for w in lows[1:])):
        tags.append("passive")
    if s & PERFECT_AUX and any(looks_participle(w) for w in lows[1:]):
        tags.append("pluperfect")
    if ("um" in s and "zu" in s) or re.search(r", (?:\w+ )*zu \w+en\b", text):
        tags.append("zu-inf")
    if s & GENITIVE_PREP:
        tags.append("genitive")
    weights = {"clause": 1.0, "relative": 1.2, "konj2": 0.9, "konj1": 1.2, "passive": 1.0, "pluperfect": 0.6, "zu-inf": 0.8, "genitive": 0.6}
    pts = sum(weights[t] for t in tags) + 0.5 * max(0, commas - 1)
    return min(pts, 4.0), tags


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
    ap.add_argument("--offline", action="store_true")
    ap.add_argument("--report", action="store_true", help="print per-level statistics")
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
        if sid not in audio or (audio[sid][2] != "BY" and entry[2] == "BY"):
            audio[sid] = entry
    log(f"  {len(audio):,} sentences with reusable native audio")

    # ---- 4. Names / giveaways ----------------------------------------------
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
    # Tatoeba's stock characters whose names are translated (Maria/Marie → Mary)
    names |= {"maria", "marias", "marie", "maries"}
    log(f"  {len(names):,} name-like words excluded from cloze")

    # ---- 5. Candidate sentences with difficulty features -----------------
    log("scoring candidates…")
    log_vocab = math.log(MAX_CLOZE_RANK)
    log_ctx = math.log(MAX_ANY_RANK)
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
        trans = sorted(e for e in es if e in eng and len(eng[e]) <= MAX_EN_CHARS)
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
            if lw.endswith("s") and lw[:-1] in names and w[0].isupper():
                continue  # possessive of a name (Lisas, Toms)
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
        others = [rank[lw] for lw in lows if lw != m.group().lower() and lw not in names]
        rarest_other = max(others) if others else 1
        g, tags = grammar_points(text, lows)
        vocab = min(math.log(r) / log_vocab, 1.0)
        context = min(math.log(max(rarest_other, 1)) / log_ctx, 1.0)
        length = (len(toks) - MIN_TOKENS) / (MAX_TOKENS - MIN_TOKENS)
        grammar = g / 4.0
        # structure = how hard the sentence is apart from the missing word
        structure = (W_LENGTH * length + W_GRAMMAR * grammar + W_CONTEXT * context) / (W_LENGTH + W_GRAMMAR + W_CONTEXT)
        score = W_VOCAB * vocab + W_CONTEXT * context + W_LENGTH * length + W_GRAMMAR * grammar
        cands.append({
            "id": sid, "de": text, "c": [m.start(), m.end()], "a": m.group(),
            "en": en, "r": r, "lw": m.group().lower(), "n": len(toks), "ro": rarest_other,
            "g": round(g, 2), "tags": tags, "s": score, "st": structure, "au": audio.get(sid), "toks": set(lows),
        })
    log(f"  {len(cands):,} candidate sentences ({sum(1 for c in cands if c['au']):,} with audio)")

    # ---- 6. Deck selection --------------------------------------------------
    # Words are placed along the 30 levels by frequency. For each word we pick the
    # sentences whose *structure* (length, grammar, other words) fits that place, so
    # common words come in simple sentences and rare words in longer, more complex
    # ones — both kinds of difficulty rise together from level 1 to 30.
    st_sorted = sorted(c["st"] for c in cands)
    for c in cands:
        c["sp"] = bisect.bisect_left(st_sorted, c["st"]) / len(st_sorted)  # structure percentile
    by_word: dict[str, list[dict]] = collections.defaultdict(list)
    for c in cands:
        by_word[c["lw"]].append(c)
    words = sorted(by_word, key=lambda w: rank[w])
    def plan(w: str) -> int:
        n_audio = sum(1 for c in by_word[w] if c["au"])
        return min(per_word(rank[w]), len(by_word[w])) + min(extra_audio(rank[w]), n_audio)

    planned = [plan(w) for w in words]  # upper bound, used only to place words along the deck
    total = sum(planned)

    deck: list[dict] = []
    pos = 0
    for w, k in zip(words, planned):
        frac = (pos + k / 2) / total          # where this word sits in the deck (0 … 1)
        pos += k
        # structure percentile that fits there; most Tatoeba sentences are short and simple,
        # so the curve is tilted to reach longer, more complex sentences sooner
        target = 0.03 + 0.96 * frac ** 0.6
        pool = by_word[w]
        chosen: list[dict] = []
        base = min(per_word(rank[w]), len(pool))
        for j in range(base):
            k = base
            t = min(0.99, max(0.01, target + (j - (k - 1) / 2) * 0.10))
            best = min(
                (c for c in pool if c not in chosen),
                key=lambda c: (abs(c["sp"] - t) - (0.12 if c["au"] else 0), c["id"]),
            )
            chosen.append(best)
        # extra sentences with native audio that still fit this place in the deck
        extras = sorted(
            (c for c in pool if c["au"] and c not in chosen and abs(c["sp"] - target) <= AUDIO_FIT),
            key=lambda c: (abs(c["sp"] - target), c["id"]),
        )[: extra_audio(rank[w])]
        chosen.extend(extras)
        for c in chosen:
            c["vf"] = frac
        deck.extend(chosen)
    words_covered = len({c["lw"] for c in deck})
    log(f"  deck: {len(deck):,} sentences for {words_covered:,} words")

    # ---- 7. Order by difficulty, 30 equal levels --------------------------
    # difficulty = word frequency position and sentence structure, equally weighted;
    # a word can't appear before the level whose rarity cap allows it
    def min_level_frac(r: int) -> float:
        lo, hi = math.log(1200), math.log(MAX_CLOZE_RANK)
        lv = 1 + (LEVELS - 1) * max(0.0, (math.log(r) - lo) / (hi - lo)) if r > 1200 else 1
        return (math.ceil(lv) - 1) / LEVELS

    for c in deck:
        c["key"] = max(0.5 * c["vf"] + 0.5 * c["sp"] ** (1 / 0.6), min_level_frac(c["r"]))
    deck.sort(key=lambda c: (c["key"], c["id"]))
    level_size = math.ceil(len(deck) / LEVELS)

    # ---- 8. Distractors ----------------------------------------------------
    pool: dict[bool, list[str]] = {True: [], False: []}
    for w, r in sorted(rank.items(), key=lambda x: x[1]):
        if r > MAX_CLOZE_RANK + 5000:
            break
        if w in names or not GERMAN_ONLY.match(w) or len(w) < 2 or freq[w] < 4:
            continue
        pool[is_noun(w)].append(w)
    pool_rank_index = {k: [rank[w] for w in v] for k, v in pool.items()}

    def distractors(c) -> list[str]:
        ans = c["a"]
        lw = c["lw"]
        noun = ans[0].isupper() if c["c"][0] > 0 else is_noun(lw)
        words, ranks = pool[noun], pool_rank_index[noun]
        rng = random.Random(SEED + c["id"])
        pre = lw[: min(4, len(lw))]
        chosen: list[str] = []
        tol = max(3, len(lw) // 4)  # long compounds get a looser length match
        for width, t in ((max(300, c["r"] // 10), tol), (max(800, c["r"] // 4), tol), (3000, tol), (8000, tol * 2), (60000, 99)):
            lo = bisect.bisect_left(ranks, c["r"] - width)
            hi = bisect.bisect_right(ranks, c["r"] + width)
            opts = [
                w for w in words[lo:hi]
                if w != lw and w not in chosen and w not in c["toks"]
                and abs(len(w) - len(lw)) <= t
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

    # ---- 9. Write -----------------------------------------------------------
    OUT.mkdir(parents=True, exist_ok=True)
    for old in OUT.glob("level-*.json"):
        old.unlink()
    levels = []
    audio_total = 0
    report = []
    for li in range(LEVELS):
        chunk = deck[li * level_size:(li + 1) * level_size]
        if not chunk:
            break
        stats = {
            "medianRank": int(statistics.median(c["r"] for c in chunk)),
            "avgWords": round(statistics.mean(c["n"] for c in chunk), 1),
            "complex": round(sum(1 for c in chunk if c["tags"]) / len(chunk), 2),
        }
        report.append((li + 1, chunk, stats))
        random.Random(SEED + li).shuffle(chunk)
        items = []
        for c in chunk:
            item = {"id": c["id"], "de": c["de"], "c": c["c"], "a": c["a"], "en": c["en"], "d": distractors(c), "r": c["r"]}
            if c["au"]:
                item["au"] = list(c["au"])
            items.append(item)
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
            "minRank": min(c["r"] for c in chunk), "maxRank": max(c["r"] for c in chunk), **stats,
        })
    ids = [c["id"] for c in deck]
    assert len(ids) == len(set(ids)), "duplicate sentence ids"
    manifest = {
        "version": DECK_VERSION,
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
    log(f"deck v{DECK_VERSION}: {len(deck):,} sentences, {words_covered:,} words, {audio_total:,} with native audio, "
        f"{len(levels)} levels, {size / 1e6:.1f} MB")

    if args.report:
        def pct(chunk, tag):
            return round(100 * sum(1 for c in chunk if tag in c["tags"]) / len(chunk))
        print("lvl | word rank: median  max | words avg  ≥12 | rarest-other median | grammar: any clause relative konj passive")
        for n, chunk, st in report:
            print(f"{n:>3} | {st['medianRank']:>13,} {max(c['r'] for c in chunk):>6,} | {st['avgWords']:>9} {round(100*sum(c['n']>=12 for c in chunk)/len(chunk)):>3}% |"
                  f" {int(statistics.median(c['ro'] for c in chunk)):>19,} | {round(100*st['complex']):>11}% {pct(chunk,'clause'):>6}% {pct(chunk,'relative'):>8}%"
                  f" {pct(chunk,'konj2')+pct(chunk,'konj1'):>4}% {pct(chunk,'passive'):>7}%")
        rng = random.Random(7)
        for n in (1, 10, 20, 30):
            chunk = next(ch for m, ch, _ in report if m == n)
            print(f"\nlevel {n} samples:")
            for c in rng.sample(chunk, 6):
                s, e = c["c"]
                print(f"  {c['de'][:s]}[{c['a']}]{c['de'][e:]}")


if __name__ == "__main__":
    main()
