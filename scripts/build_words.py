#!/usr/bin/env python3
"""Build the word info shown after an answer: public/deck/words/level-NN.json.

For the missing word of every sentence it finds, in English Wiktionary's German entries
(machine-readable extract by Wiktextract / kaikki.org, CC BY-SA 4.0):

  l   base form (lemma)                      p   part of speech (noun, verb, adj, …)
  g   gender of nouns: m / f / n             pl  plural of nouns
  vf  verbs: [past tense, "hat/ist" + past participle]
  f   what form this is, in plain English ("past tense · ich, er/sie/es", "genitive", …)
  m   English meaning
  parts  compound nouns Wiktionary doesn't list: [[part, meaning], …]

Words with several readings (sein = "to be" / "his") are resolved with the sentence's
English translation: the reading whose meaning shares the most words with it wins.

Run:  python3 scripts/build_words.py [--report]
Input: data/raw/kaikki-German.jsonl (downloaded once, ~1.1 GB; not in git).
Stdlib only; reads the deck in public/deck/ and never changes it.
"""
from __future__ import annotations

import argparse
import collections
import json
import random
import re
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw" / "kaikki-German.jsonl"
URL = "https://kaikki.org/dictionary/German/kaikki.org-dictionary-German.jsonl"
DECK = ROOT / "public" / "deck"
OUT = DECK / "words"

POS = {
    "noun": "noun", "verb": "verb", "adj": "adjective", "adv": "adverb", "pron": "pronoun", "det": "determiner",
    "article": "article", "prep": "preposition", "postp": "preposition", "conj": "conjunction", "num": "number",
    "particle": "particle", "intj": "interjection", "contraction": "contraction", "name": "name",
}
SKIP_SENSE = {"archaic", "obsolete", "dated", "rare", "misspelling", "nonstandard", "dialectal", "Austrian", "Swiss"}
PERSON = {"first-person": 1, "second-person": 2, "third-person": 3}
INFLECTION = set(PERSON) | {
    "singular", "plural", "nominative", "genitive", "dative", "accusative", "preterite", "present", "past",
    "participle", "imperative", "subjunctive-i", "subjunctive-ii", "comparative", "superlative", "infinitive",
    "zu-infinitive",
}
STOP = set("""a an the to of and or in on at by for with from as is be been are was were one one's oneself someone
something somebody etc e g i used use form""".split())
RARE_VERB_FORM = {"first-person", "singular", "present", "imperative", "form-of"}
SEPARABLE = """ab an auf aus bei dar durch ein empor entgegen fern fest fort heim her herab heran herauf heraus
herein herum herunter hervor hin hinauf hinaus hinein hinunter hinzu los mit nach nieder vor voran voraus vorbei
vorüber weg weiter wieder zu zurecht zurück zusammen""".split()


IRREGULAR = {"known": "know", "knew": "know", "given": "give", "gave": "give", "taken": "take", "took": "take",
             "gone": "go", "went": "go", "done": "do", "did": "do", "seen": "see", "saw": "see", "written": "write",
             "wrote": "write", "spoken": "speak", "spoke": "speak", "eaten": "eat", "ate": "eat", "drunk": "drink",
             "drank": "drink", "found": "find", "left": "leave", "made": "make", "thought": "think", "brought": "bring",
             "bought": "buy", "caught": "catch", "taught": "teach", "told": "tell", "said": "say", "felt": "feel",
             "kept": "keep", "slept": "sleep", "met": "meet", "lost": "lose", "won": "win", "sold": "sell", "sent": "send",
             "built": "build", "held": "hold", "stood": "stand", "understood": "understand", "began": "begin",
             "begun": "begin", "ran": "run", "came": "come", "became": "become", "forgot": "forget", "forgotten": "forget",
             "got": "get", "gotten": "get", "broke": "break", "broken": "break", "chose": "choose", "chosen": "choose",
             "fell": "fall", "fallen": "fall", "flew": "fly", "flown": "fly", "grew": "grow", "grown": "grow",
             "hid": "hide", "hidden": "hide", "rode": "ride", "ridden": "ride", "rose": "rise", "risen": "rise",
             "sang": "sing", "sung": "sing", "swam": "swim", "swum": "swim", "threw": "throw", "thrown": "throw",
             "wore": "wear", "worn": "wear", "children": "child", "men": "man", "women": "woman", "feet": "foot",
             "teeth": "tooth", "mice": "mouse", "better": "good", "best": "good", "worse": "bad", "worst": "bad"}


def tokens(text: str) -> set[str]:
    out = set()
    for w in re.findall(r"[a-z]+", text.lower()):
        w = IRREGULAR.get(w, w)
        if w in STOP or len(w) < 2:
            continue
        for suf in ("ing", "ed", "es", "s", "e"):  # crude stemming: moved / moves / move → mov
            if len(w) > len(suf) + 2 and w.endswith(suf):
                w = w[: -len(suf)]
                break
        out.add(w)
    return out


def clean_gloss(glosses: list[str]) -> str:
    g = glosses[-1]  # sub-senses list the parent gloss first; the last one is the specific meaning
    g = re.sub(r"^[^:]{0,80}\bof \w+: ", "", g)  # "causative of stehen: to put …" → "to put …"
    g = re.sub(r"\s*\[[^\]]*\]", "", g)  # "[auxiliary haben]"
    if len(g) > 40:
        while re.search(r"\([^()]*\)", g):  # nested brackets too
            g = re.sub(r"\s*\([^()]*\)", "", g)
        g = g.replace("(", "").replace(")", "")
    if len(g) > 70:  # long definitions often end in short synonyms: "…, industry, operation"
        tail = [p for p in g.split(", ")[1:] if len(p.split()) <= 3 and " of " not in p]
        if tail:
            g = ", ".join(tail[-3:])
    g = re.sub(r"\s+", " ", g).strip(" ;,.")
    return g if len(g) <= 90 else g[:87].rsplit(" ", 1)[0] + "…"


UNHELPFUL = re.compile(
    r"^(alternative|obsolete|archaic|dated|nonstandard)( form| spelling)? of |\(as above\)|"
    r"^(gerund|verbal noun|ellipsis|clipping|abbreviation) of |^(forms|used|use|Used) "
)


def is_inflection(sense: dict) -> bool:
    if not sense.get("form_of"):
        return False
    gl = (sense.get("glosses") or [""])[0]
    return gl.startswith("inflection of") or bool(set(sense.get("tags") or []) & INFLECTION)


# ---------------------------------------------------------------- reading Wiktionary

def read_wiktionary(needed: set[str]):
    """One pass: base-form info for every word, inflection links for the words we need."""
    lemmas: dict[str, list[dict]] = collections.defaultdict(list)
    inflections: dict[str, list[dict]] = collections.defaultdict(list)
    derived: dict[str, list[dict]] = collections.defaultdict(list)
    with open(RAW, encoding="utf-8") as f:
        for n, line in enumerate(f):
            if n % 200000 == 0:
                print(f"  … {n:,} entries", file=sys.stderr)
            e = json.loads(line)
            pos = POS.get(e.get("pos", ""))
            word = e.get("word", "")
            if not pos or not word:
                continue
            senses = [s for s in e.get("senses", []) if s.get("glosses") and not (set(s.get("tags") or []) & SKIP_SENSE)]
            base = [s for s in senses if not is_inflection(s)]
            # meanings first; "alternative form of …", "(as above)" only if there's nothing else
            glosses = [clean_gloss(s["glosses"]) for s in base]
            good = [g for g, s in zip(glosses, base) if not UNHELPFUL.search(s["glosses"][-1]) and "alt-of" not in (s.get("tags") or [])]
            glosses = (good or glosses)[:12]
            if base:
                info = {"pos": pos, "glosses": glosses}
                tags = [t for s in base for t in (s.get("tags") or [])]
                if pos == "noun":
                    g = next((t for t in tags if t in ("masculine", "feminine", "neuter")), None)
                    if not g:
                        exp = next((h.get("expansion", "") for h in e.get("head_templates", [])), "")
                        mm = re.match(r"^\S+ ([mfn])\b", exp)
                        g = {"m": "masculine", "f": "feminine", "n": "neuter"}[mm.group(1)] if mm else None
                    if g:
                        info["g"] = g[0]
                    pl = next((x["form"] for x in e.get("forms", []) if x.get("tags") == ["plural"]), None)
                    if pl and pl != "-":
                        info["pl"] = pl
                if pos == "verb":
                    forms = e.get("forms", [])
                    past = next((x["form"] for x in forms if x.get("tags") == ["past"]), None)
                    pp = next((x["form"] for x in forms if x.get("tags") == ["participle", "past"]), None)
                    aux = next((x["form"] for x in forms if x.get("tags") == ["auxiliary"]), None)
                    if past and pp:
                        info["vf"] = [past, f"{'ist' if aux == 'sein' else 'hat'} {pp}"]
                    for form, tags in verb_forms(past, pp, forms):
                        if form in needed:
                            derived[form].append({"pos": "verb", "lemma": word, "tags": tags, "gloss": [f"inflection of {word}:"]})
                lemmas[word].append(info)
            if word in needed:
                for s in senses:
                    if is_inflection(s):
                        inflections[word].append(
                            {"pos": pos, "lemma": s["form_of"][0]["word"], "tags": set(s.get("tags") or []), "gloss": s["glosses"]}
                        )
    for form, items in derived.items():  # only where Wiktionary has no verb reading of this form
        if not any(x["pos"] == "verb" for x in inflections.get(form, [])) and not any(i["pos"] == "verb" for i in lemmas.get(form, [])):
            inflections[form].extend(items)
    return lemmas, inflections


def verb_forms(past: str | None, pp: str | None, forms: list[dict]):
    """Past-tense forms (erlaubte, erlaubten, erlaubtest, erlaubtet), participle, er/sie/es present."""
    if past and " " not in past:
        stem = past[:-1] if past.endswith("e") else past
        e = "e" if past.endswith("e") else ""
        yield past, {"first-person", "third-person", "singular", "preterite"}
        yield stem + ("en" if not e else "en"), {"first-person", "third-person", "plural", "preterite"}
        yield stem + e + "st", {"second-person", "singular", "preterite"}
        yield stem + e + "t", {"second-person", "plural", "preterite"}
    if pp and " " not in pp:
        yield pp, {"participle", "past"}
    third = next((x["form"] for x in forms if x.get("tags") == ["present", "singular", "third-person"]), None)
    if third and " " not in third:
        yield third, {"third-person", "singular", "present"}


# ---------------------------------------------------------------- describing a form

PRONOUNS = {(1, "singular"): "ich", (2, "singular"): "du", (3, "singular"): "er/sie/es",
            (1, "plural"): "wir", (2, "plural"): "ihr", (3, "plural"): "sie/Sie"}
CASES = ["nominative", "accusative", "dative", "genitive"]


def describe(pos: str, form: str, lemma: str, infl: list[dict]) -> str | None:
    if not infl:
        return None
    tags = [i["tags"] for i in infl]
    if pos == "verb":
        groups: dict[str, list[str]] = {}
        for t in tags:
            if "participle" in t:
                name = "past participle" if "past" in t else "present participle"
            elif "zu-infinitive" in t:
                name = "zu-infinitive"
            elif "imperative" in t:
                name = "command form"
            elif "subjunctive-ii" in t:
                name = "Konjunktiv II"
            elif "subjunctive-i" in t:
                name = "Konjunktiv I"
            elif "preterite" in t or "past" in t:
                name = "past tense"
            elif "present" in t:
                name = "present tense"
            else:
                continue
            people = groups.setdefault(name, [])
            num = "plural" if "plural" in t else "singular"
            for p, k in PERSON.items():
                if p in t:
                    pr = PRONOUNS[(k, num)]
                    if pr not in people:
                        people.append(pr)
        if groups.get("past tense") and groups.get("past tense") == groups.get("Konjunktiv II"):
            groups["past tense or Konjunktiv II"] = groups.pop("past tense")
            del groups["Konjunktiv II"]
        order = ["present tense", "past tense", "past tense or Konjunktiv II", "past participle", "Konjunktiv II",
                 "Konjunktiv I", "command form", "present participle", "zu-infinitive"]
        parts = [f"{g} · {', '.join(groups[g])}" if groups[g] else g for g in order if g in groups]
        return "; ".join(parts[:2]) or None
    if pos == "adjective" or pos == "adverb":
        if any("superlative" in t for t in tags):
            return "superlative"
        if any("comparative" in t for t in tags):
            return "comparative"
        if form.lower().startswith(lemma.lower()) and len(form) > len(lemma):
            return f"with the ending -{form[len(lemma):]}"
        return "inflected form"
    if pos == "noun":
        t = set().union(*tags)
        number = "plural" if "plural" in t and "singular" not in t else "singular"
        cases = [c for c in CASES if c in t]
        if number == "plural":
            return "plural" if len(cases) != 1 else f"{cases[0]} plural"
        return cases[0] if len(cases) == 1 and cases[0] != "nominative" else None
    # articles, determiners, pronouns: case, gender, number
    best = max(tags, key=len)
    cases = "/".join(c for c in CASES if c in best)
    genders = "/".join(g for g in ("masculine", "feminine", "neuter") if g in best)
    number = "plural" if "plural" in best else ("singular" if "singular" in best else "")
    rest = " ".join(x for x in (genders, number) if x)
    return " · ".join(x for x in (cases, rest) if x) or None


# ---------------------------------------------------------------- choosing a reading

def options_for(form: str, lemmas, inflections):
    out = []
    for i, info in enumerate(lemmas.get(form, [])):
        out.append({"lemma": form, "info": info, "infl": [], "order": i})
    by_lemma: dict[tuple[str, str], list[dict]] = collections.defaultdict(list)
    for x in inflections.get(form, []):
        by_lemma[(x["lemma"], x["pos"])].append(x)
    for (lemma, pos), infl in by_lemma.items():
        cands = [i for i in lemmas.get(lemma, []) if i["pos"] == pos] or lemmas.get(lemma, [])
        if cands:
            out.append({"lemma": lemma, "info": cands[0], "infl": infl, "order": 10})
    return out


def choose(item: dict, lemmas, inflections):
    a, de = item["a"], item["de"]
    en = tokens(item["en"])
    at_start = item["c"][0] == 0 or bool(re.search(r"[.!?:]\s*[„\"]?$", de[: item["c"][0]]))
    forms = [a] + ([a[0].lower() + a[1:]] if a[0].isupper() and at_start else [])
    after = de[item["c"][1]:].lstrip()
    before_noun = bool(re.match(r"[A-ZÄÖÜ]", after))  # "das Spiel", "sein Hund"
    before_punct = not after or not after[0].isalpha()  # "mit ihr?"
    tail = re.findall(r"(\w+)\s*[.!?,]", de)
    particle = tail[-1].lower() if tail and tail[-1].lower() in SEPARABLE else None
    best, best_score = None, -1e9
    for form in forms:
        for o in options_for(form, lemmas, inflections):
            pos = o["info"]["pos"]
            if a[0].islower() and pos == "noun":
                continue
            glosses = o["info"]["glosses"]
            if pos == "verb" and particle:  # "Ich zog das Hemd aus": zog → ausziehen
                sep = next((i for i in lemmas.get(particle + o["lemma"], []) if i["pos"] == "verb"), None)
                if sep and len(tokens(" ".join(sep["glosses"])) & en) >= len(tokens(" ".join(glosses)) & en):
                    o = {**o, "lemma": particle + o["lemma"], "info": sep}
                    glosses = sep["glosses"]
            overlap = [len(tokens(g) & en) for g in glosses]
            extra = max((len(tokens(" ".join(x["gloss"][1:] or x["gloss"]).split(":")[-1]) & en) for x in o["infl"]), default=0)
            score = 3 * (max(overlap, default=0) + extra) + (2 if form == a else 0) - 0.1 * o["order"]
            # an inflected verb (erlaubte, gewesen) usually beats an adjective made from the participle
            if pos == "verb" and o["infl"]:
                score += 1.5
            # "ich besser" / "besser!" (verb bessern) are rare next to "besser" = better
            if pos == "verb" and o["infl"] and all(x["tags"] <= RARE_VERB_FORM for x in o["infl"]):
                score -= 3
            if a[0].isupper() and not at_start:
                score += 4 if pos == "noun" else (-1 if pos == "name" else -4)
            if pos in ("article", "determiner"):
                score += 3 if before_noun else (-3 if before_punct else 0)
            if score > best_score:
                best, best_score = (o, form, overlap), score
    if not best:
        return fallback(a, lemmas, en)
    o, form, overlap = best
    info = o["info"]
    glosses = info["glosses"]
    first = max(range(len(glosses)), key=lambda i: 10 * overlap[i] - i - (2 if len(glosses[i]) > 70 else 0))
    meaning = glosses[first]
    if len(meaning) < 30:
        nxt = next((g for i, g in enumerate(glosses) if i != first and not tokens(g) & tokens(meaning)), None)
        if nxt and len(meaning) + len(nxt) < 60:
            meaning = f"{meaning}; {nxt}"
    for x in o["infl"]:
        if x["tags"] & {"comparative", "superlative"} and ";" in x["gloss"][-1]:
            meaning = x["gloss"][-1].split(";", 1)[1].strip(" .")
            break
    if info["pos"] == "article":
        meaning = {"der": "the", "ein": "a, an"}.get(o["lemma"], meaning)
    out = {"l": o["lemma"], "p": info["pos"], "m": meaning}
    for k in ("g", "pl", "vf"):
        if k in info:
            out[k] = info[k]
    f = describe(info["pos"], form, o["lemma"], o["infl"]) if form != o["lemma"] else None
    if f:
        out["f"] = f
    return out


# ---------------------------------------------------------------- words Wiktionary doesn't list

def first_meaning(lemmas, word, pos, en: set[str] | None = None):
    info = next((i for i in lemmas.get(word, []) if i["pos"] == pos), None)
    if not info or not info["glosses"]:
        return None
    g = info["glosses"]
    return max(g, key=lambda x: (len(tokens(x) & en), -g.index(x))) if en else g[0]


LINKS = ("", "s", "es", "n", "en", "e", "er")  # "Arbeit-s-platz", "Sonne-n-schein"


def fallback(a: str, lemmas, en: set[str]):
    """Verbs and adjectives used as nouns, and compound nouns split into known parts."""
    if not a[0].isupper():
        return None
    low = a[0].lower() + a[1:]
    m = first_meaning(lemmas, low, "verb", en)
    if m:  # das Aufstehen
        return {"l": low, "p": "noun", "g": "n", "m": m, "f": "verb used as a noun"}
    for end in ("e", "en", "er", "es", "em"):  # das Absurde, die Anwesenden
        if low.endswith(end):
            m = first_meaning(lemmas, low[: -len(end)], "adjective", en)
            if m:
                return {"l": low[: -len(end)], "p": "noun", "m": m, "f": "adjective used as a noun"}
    for i in range(3, len(a) - 2):  # Abgabe + Frist
        tail = a[i].upper() + a[i + 1 :]
        tinfo = next((x for x in lemmas.get(tail, []) if x["pos"] == "noun" and x.get("g")), None)
        if not tinfo or len(tail) < 3:
            continue
        for link in LINKS:
            head = a[:i]
            if link and not head.endswith(link):
                continue
            head = head[: len(head) - len(link)] if link else head
            for h, pos in ((head, "noun"), (head.lower() + "en", "verb"), (head.lower(), "adjective"), (head.lower() + "n", "verb")):
                hm = first_meaning(lemmas, h, pos, en)
                if hm:
                    tm = first_meaning(lemmas, tail, "noun", en)
                    out = {"l": a, "p": "noun", "g": tinfo["g"], "parts": [[h, hm], [tail, tm]]}
                    if tinfo.get("pl") and tinfo["pl"].startswith(tail[:-2]):
                        out["pl"] = a[:i] + tinfo["pl"][0].lower() + tinfo["pl"][1:]
                    return out
    return None


# ---------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--report", action="store_true", help="print coverage and random samples")
    args = ap.parse_args()
    if not RAW.exists():
        print(f"downloading {URL} (~1.1 GB) …", file=sys.stderr)
        RAW.parent.mkdir(parents=True, exist_ok=True)
        urllib.request.urlretrieve(URL, RAW.with_suffix(".part"))
        RAW.with_suffix(".part").rename(RAW)
    manifest = json.loads((DECK / "manifest.json").read_text())
    levels = {l["n"]: json.loads((DECK / l["file"]).read_text()) for l in manifest["levels"]}
    needed = set()
    for items in levels.values():
        for it in items:
            needed.add(it["a"])
            needed.add(it["a"][0].lower() + it["a"][1:])
    print(f"{len(needed):,} word forms to look up", file=sys.stderr)
    lemmas, inflections = read_wiktionary(needed)
    OUT.mkdir(exist_ok=True)
    total = found = 0
    by_pos = collections.Counter()
    samples = []
    for n, items in sorted(levels.items()):
        words = {}
        for it in items:
            total += 1
            w = choose(it, lemmas, inflections)
            if w:
                found += 1
                by_pos[w["p"]] += 1
                words[str(it["id"])] = w
                samples.append((n, it, w))
        (OUT / f"level-{n:02d}.json").write_text(json.dumps(words, ensure_ascii=False, separators=(",", ":")))
    print(f"word info for {found:,} of {total:,} sentences ({found / total:.1%})")
    print("parts of speech:", ", ".join(f"{p} {c:,}" for p, c in by_pos.most_common()))
    if args.report:
        miss = [it for items in levels.values() for it in items if str(it["id"]) not in json.loads((OUT / f"level-{it_level(levels, it):02d}.json").read_text())]
        print("no info, e.g.:", ", ".join(sorted({it["a"] for it in miss})[:60]))
        random.seed(1)
        for n, it, w in random.sample(samples, 40):
            print(f"L{n:02d} {it['a']:<18} {json.dumps(w, ensure_ascii=False)}  | {it['en']}")


def it_level(levels, item):
    return next(n for n, items in levels.items() if item in items)


if __name__ == "__main__":
    main()
