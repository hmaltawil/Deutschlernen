import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { checkAnswer, onTrack, type Verdict } from '../lib/answer';
import { getItems, loadLevel, tatoebaUrl, type Item } from '../lib/deck';
import { pointsFor } from '../lib/scoring';
import { choices, currentLevel, makeCards, pickNew, pickReviews, requeue, type Card, type Mode, type RoundKind } from '../lib/session';
import { DAY, mastery, type Progress } from '../lib/srs';
import { piper, play, preload, stop, plannedSource, type Source } from '../lib/audio';
import { VOICES, type Settings } from '../lib/settings';
import { useStore } from '../store';
import { go } from '../router';
import { IconCheck, IconPlay, IconVolume, IconX } from './Icons';
import { Ring } from './Ring';
import { syncSoon } from '../lib/sync/engine';
import { applyUpdateIfReady, ensureLevelSaved } from '../lib/offline';

interface Outcome {
  points: number;
  before: Progress | null;
  after: Progress | null;
  /** settles once the answer is stored on the device */
  saved: Promise<void>;
}

interface Result extends Outcome {
  item: Item;
  correct: boolean;
  isNew: boolean;
  retry: boolean;
  given: string;
}

type Phase = 'loading' | 'playing' | 'done' | 'empty' | 'error';

export function Play({ kind, level }: { kind: RoundKind; level?: number }) {
  const store = useStore();
  const { manifest, settings } = store;
  const progressRef = useRef(store.progress);
  progressRef.current = store.progress;
  const [round, setRound] = useState(0);
  const [mode, setMode] = useState<Mode>(settings.mode);
  const [cards, setCards] = useState<Card[]>([]);
  const [idx, setIdx] = useState(0);
  const [phase, setPhase] = useState<Phase>('loading');
  const [results, setResults] = useState<Result[]>([]);
  const [combo, setCombo] = useState(0);
  const [err, setErr] = useState('');

  // starting a level from the Levels page makes it your current level (shown on Home)
  useEffect(() => {
    if (level && level !== settings.currentLevel) store.updateSettings({ currentLevel: level });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [level]);

  // build a round
  useEffect(() => {
    if (!manifest) return;
    let cancelled = false;
    setPhase('loading');
    setMode(settings.mode);
    (async () => {
      const now = Date.now();
      const prog = progressRef.current;
      const reviews = pickReviews(prog.values(), now, settings.roundSize, kind);
      const reviewItems = await getItems(reviews);
      const need = kind === 'review' ? 0 : settings.roundSize - reviewItems.length;
      const played = new Map<number, number>();
      for (const p of prog.values()) played.set(p.lv, (played.get(p.lv) ?? 0) + 1);
      const from = level ?? currentLevel(played, manifest.levels, settings.currentLevel);
      const fresh = need > 0 ? await pickNew(prog, need, from, manifest.levels.length, loadLevel) : [];
      if (cancelled) return;
      const c = makeCards(reviewItems, fresh);
      setCards(c);
      setIdx(0);
      setResults([]);
      setCombo(0);
      setPhase(c.length ? 'playing' : 'empty');
      piper.warm(settings.voice);
      // keep this level's recordings on the device for offline use
      if (settings.autoSaveRecordings) for (const lv of new Set(fresh.map((x) => x.lv))) ensureLevelSaved(lv);
    })().catch((e) => {
      if (!cancelled) {
        setErr((e as Error).message);
        setPhase('error');
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manifest, round, kind, level]);

  useEffect(() => () => stop(), []);

  // preload the next card's audio
  useEffect(() => {
    const next = cards[idx + 1];
    if (next) preload(next.item, settings.voice);
  }, [cards, idx, settings.voice]);

  const onAnswer = useCallback(
    (correct: boolean, given: string, hint: boolean, usedMode: Mode): Outcome => {
      const card = cards[idx];
      const points = correct && !card.retry ? pointsFor(usedMode, combo, hint) : 0;
      const { before, after, saved } = store.recordAnswer({ item: card.item, correct, points, isNew: card.isNew, retry: card.retry });
      if (!card.retry) setCombo((c) => (correct ? c + 1 : 0));
      setCards((cs) => requeue(cs, idx, correct));
      setResults((rs) => [...rs, { item: card.item, correct, points, isNew: card.isNew, retry: card.retry, given, before, after, saved }]);
      return { points, before, after, saved };
    },
    [cards, idx, combo, store],
  );

  const [knownIds, setKnownIds] = useState<Set<number>>(new Set());
  const onKnown = useCallback(
    async (known: boolean, restore: Progress | null): Promise<Progress | null> => {
      const id = cards[idx].item.id;
      const prev = store.progress.get(id) ?? null;
      await store.setKnown(id, known, restore);
      setKnownIds((s) => {
        const n = new Set(s);
        if (known) n.add(id);
        else n.delete(id);
        return n;
      });
      // a known sentence doesn't need its "practice again" repeat at the end of the round
      if (known) setCards((cs) => cs.filter((c, i) => i <= idx || c.item.id !== id));
      return prev;
    },
    [cards, idx, store],
  );

  const onNext = useCallback(() => {
    stop();
    if (idx + 1 < cards.length) setIdx(idx + 1);
    else setPhase('done');
  }, [idx, cards.length]);

  if (phase === 'loading') return <div className="spinner" aria-label="Loading" />;
  if (phase === 'error') return <div className="card">Could not load sentences: {err}</div>;
  if (phase === 'empty') {
    return (
      <div className="card stack center">
        <h2>{kind === 'review' ? 'Nothing to review right now' : 'You have played every sentence!'}</h2>
        <p className="muted">
          {kind === 'review' ? 'Reviews come back as their intervals run out.' : 'Keep reviewing to reach 100% mastery.'}
        </p>
        <div className="row" style={{ justifyContent: 'center' }}>
          <a className="btn" href="#/">
            Home
          </a>
          {kind === 'review' && (
            <a className="btn primary" href="#/play?kind=new">
              Learn new sentences
            </a>
          )}
        </div>
      </div>
    );
  }
  if (phase === 'done') return <Summary results={results} known={knownIds} onAgain={() => applyUpdateIfReady() || setRound((r) => r + 1)} />;

  const card = cards[idx];
  const roundPoints = results.reduce((s, r) => s + r.points, 0);
  return (
    <div>
      <div className="play-head">
        <button className="btn ghost icon-btn" onClick={() => go('/')} aria-label="Quit round" title="Quit (progress is saved)">
          <IconX />
        </button>
        <div className="meter" role="progressbar" aria-valuenow={idx} aria-valuemax={cards.length} aria-label="Round progress">
          <span style={{ width: `${(idx / cards.length) * 100}%` }} />
        </div>
        <span className="combo" aria-live="polite">
          {combo >= 2 ? `×${combo}` : ''}
        </span>
        <span className="play-points" aria-label="Points this round">
          {roundPoints} pts
        </span>
      </div>
      <ClozeCard
        key={`${round}-${idx}`}
        card={card}
        mode={mode}
        settings={settings}
        onAnswer={onAnswer}
        onKnown={onKnown}
        onNext={onNext}
        isLast={idx + 1 >= cards.length}
        stage={store.progress.get(card.item.id)?.stage ?? 0}
      />
    </div>
  );
}

/* ------------------------------------------------------------------------ */

const WORD = /[^\s.,;:!?…"„“”‚‘'()«»\-–—]+/g;

function Masked({ text }: { text: string }) {
  const parts: JSX.Element[] = [];
  let last = 0;
  for (const m of text.matchAll(WORD)) {
    if (m.index! > last) parts.push(<span key={`s${last}`}>{text.slice(last, m.index)}</span>);
    parts.push(<span key={m.index} className="mask-word" style={{ width: `${m[0].length * 0.5}em` }} />);
    last = m.index! + m[0].length;
  }
  if (last < text.length) parts.push(<span key={`s${last}`}>{text.slice(last)}</span>);
  return <>{parts}</>;
}

function sourceLabel(src: Source | null, item: Item, voice: string) {
  if (src === 'human' && item.au) {
    return (
      <>
        Native speaker <strong>{item.au[1]}</strong> · CC {item.au[2]}
      </>
    );
  }
  if (src === 'neural') return <>Neural voice · {(VOICES.find((v) => v.id === voice)?.label ?? voice).split(' —')[0]}</>;
  if (src === 'system') return <>Browser voice (download the natural voice in Settings)</>;
  return null;
}

function nextReviewText(p: Progress | null): string {
  if (!p) return '';
  const days = Math.round((p.due - p.last) / DAY);
  if (days <= 0) return 'You’ll see it again soon.';
  return `Next review in ${days} day${days === 1 ? '' : 's'}.`;
}

interface CardProps {
  card: Card;
  mode: Mode;
  settings: Settings;
  isLast: boolean;
  stage: number;
  onAnswer(correct: boolean, given: string, hint: boolean, usedMode: Mode): Outcome;
  /** mark as known (or undo); resolves with the record from before the change */
  onKnown(known: boolean, restore: Progress | null): Promise<Progress | null>;
  onNext(): void;
}

function ClozeCard({ card, mode, settings, isLast, stage, onAnswer, onKnown, onNext }: CardProps) {
  const { item } = card;
  const [startStage] = useState(stage);
  const [given, setGiven] = useState('');
  const [chosen, setChosen] = useState<string | null>(null);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [hint, setHint] = useState(false);
  const [revealed, setRevealed] = useState(mode !== 'listen');
  const [revealedEarly, setRevealedEarly] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [source, setSource] = useState<Source | null>(null);
  const [blocked, setBlocked] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const answeredAt = useRef(0);
  const answered = verdict !== null;
  const [known, setKnown] = useState(false);
  const [beforeKnown, setBeforeKnown] = useState<Progress | null>(null);
  const answerSaved = useRef<Promise<unknown> | null>(null);
  const [saveError, setSaveError] = useState(false);
  /** a near-miss was typed and the learner may fix it once (setting "second try") */
  const [secondChance, setSecondChance] = useState(false);
  const knownBusy = useRef(false);
  const toggleKnown = useCallback(async () => {
    if (knownBusy.current) return;
    knownBusy.current = true;
    try {
      await answerSaved.current; // keep the order: the answer is stored before the "known" mark
      if (!known) {
        setKnown(true);
        setBeforeKnown(await onKnown(true, null));
      } else {
        setKnown(false);
        await onKnown(false, beforeKnown);
      }
    } catch {
      setSaveError(true);
    } finally {
      knownBusy.current = false;
    }
  }, [known, beforeKnown, onKnown]);
  const opts = useMemo(() => choices(item), [item]);
  const before = item.de.slice(0, item.c[0]);
  const after = item.de.slice(item.c[1]);
  const typing = mode === 'text' || mode === 'listen';
  // Choose/Type: hearing the sentence before answering gives the missing word away (setting)
  const canHear = answered || mode === 'listen' || settings.audioBeforeAnswer;
  const strict = settings.strictUmlauts;

  const speak = useCallback(async () => {
    try {
      const src = await play(item, settings.rate, settings.voice, setSource);
      if (src) setSource(src);
      setBlocked(false);
    } catch {
      setBlocked(true); // autoplay was blocked: show a big play button
    }
  }, [item, settings.rate, settings.voice]);

  useEffect(() => {
    if (mode === 'listen') speak();
    else setSource(plannedSource(item));
    if (typing) inputRef.current?.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = useCallback(
    async (value: string, fromChoice: boolean, giveUp = false) => {
      if (verdict) return;
      const v: Verdict = fromChoice ? (value === item.a ? 'correct' : 'wrong') : checkAnswer(value, item.a, { strict });
      if (v === 'close' && !giveUp && settings.secondTry && !secondChance) {
        setSecondChance(true); // one letter off: let them fix it (counts as right for half points)
        inputRef.current?.focus();
        return;
      }
      answeredAt.current = performance.now();
      setVerdict(v);
      setRevealed(true);
      if (fromChoice) setChosen(value);
      const used: Mode = mode === 'listen' && revealedEarly ? 'text' : mode;
      // play first, while the tap is fresh (iPhone only lets sound start right after a tap)
      if (settings.autoplay) speak();
      const res = onAnswer(v === 'correct', value, hint || secondChance, used);
      setOutcome(res);
      answerSaved.current = res.saved.catch(() => {});
      res.saved.catch(() => setSaveError(true));
    },
    [verdict, item.a, mode, revealedEarly, hint, onAnswer, settings.autoplay, settings.secondTry, speak, strict, secondChance],
  );

  useEffect(() => {
    if (answered) nextRef.current?.focus({ preventScroll: true });
  }, [answered]);

  // keyboard: 1–4 choose, Enter next, R replay
  const keyState = useRef({ answered, opts, submit, onNext, speak, mode, toggleKnown, outcome, canHear });
  keyState.current = { answered, opts, submit, onNext, speak, mode, toggleKnown, outcome, canHear };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = keyState.current;
      const tag = (e.target as HTMLElement)?.tagName;
      const inField = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      if (!s.answered && s.mode === 'mc' && /^[1-4]$/.test(e.key)) {
        e.preventDefault();
        s.submit(s.opts[Number(e.key) - 1], true);
      } else if (s.answered && e.key === 'Enter' && tag !== 'BUTTON' && tag !== 'A') {
        if (performance.now() - answeredAt.current < 350) return;
        e.preventDefault();
        s.onNext();
      } else if (!inField && s.canHear && (e.key === 'r' || e.key === 'R')) {
        e.preventDefault();
        s.speak();
      } else if (!inField && s.answered && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        s.toggleKnown();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const insert = (ch: string) => {
    const el = inputRef.current;
    if (!el || answered) return;
    const start = el.selectionStart ?? given.length;
    const end = el.selectionEnd ?? given.length;
    const next = given.slice(0, start) + ch + given.slice(end);
    setGiven(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + ch.length, start + ch.length);
    });
  };

  const onSubmitForm = (e: FormEvent) => {
    e.preventDefault();
    if (!answered && given.trim()) submit(given, false);
  };

  const useHint = () => {
    setHint(true);
    if (!given) setGiven(item.a[0]);
    inputRef.current?.focus();
  };

  const track = settings.typingColor && given.trim() ? (onTrack(given, item.a, { strict }) ? ' on-track' : ' off-track') : '';
  // The box takes the real width of the text, measured by invisible copies in the same spot
  // (counting letters doesn't work: "m" is three times as wide as "l"). fitBox: as wide as the
  // missing word; otherwise the same size for every word. Either way it grows while you type.
  const gap = answered ? (
    <span className={`filled ${verdict === 'correct' ? 'ok' : 'bad'}`}>{item.a}</span>
  ) : typing ? (
    <span className={`blank-wrap${settings.fitBox ? '' : ' same-size'}`}>
      <input
        ref={inputRef}
        className={`blank-input${track}`}
        size={1}
        value={given}
        onChange={(e) => setGiven(e.target.value)}
        aria-label="Missing word"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        enterKeyHint="done"
        placeholder={hint ? `${item.a[0]}…` : ''}
      />
      {settings.fitBox && (
        <span className="blank-sizer" aria-hidden="true">
          {item.a}
        </span>
      )}
      <span className="blank-sizer" aria-hidden="true">
        {given || (hint ? `${item.a[0]}…` : '')}
        {'​'}
      </span>
    </span>
  ) : (
    <span className="blank" style={{ width: '5ch' }} aria-label="blank">
      &nbsp;
    </span>
  );

  return (
    <form className="card cloze-card" onSubmit={onSubmitForm} data-id={item.id}>
      <div className="spread">
        <div className="row" style={{ gap: 6 }}>
          {card.retry ? (
            <span className="badge">Practice again</span>
          ) : card.isNew ? (
            <span className="badge new">New</span>
          ) : (
            <span className="badge review">Review · {mastery(startStage)}%</span>
          )}
          <span className="badge" title="Frequency rank of the missing word">
            #{item.r.toLocaleString()}
          </span>
        </div>
        <button
          type="button"
          className="btn ghost icon-btn"
          onClick={speak}
          aria-label="Play sentence audio (R)"
          title="Play audio (R)"
          disabled={!canHear}
          aria-hidden={!canHear}
          style={canHear ? undefined : { visibility: 'hidden' }}
        >
          <IconVolume />
        </button>
      </div>

      <div className="sentence" lang="de">
        {revealed ? before : <Masked text={before} />}
        {gap}
        {revealed ? after : <Masked text={after} />}
      </div>

      {(settings.showHint || answered) && <div className="translation">{item.en}</div>}

      {mode === 'listen' && !answered && (
        <div className="row" style={{ marginTop: 14 }}>
          {blocked ? (
            <button type="button" className="btn primary" onClick={speak}>
              <IconPlay size={16} /> Play sentence
            </button>
          ) : (
            <button type="button" className="btn" onClick={speak}>
              <IconVolume size={18} /> Replay
            </button>
          )}
          {!revealed && (
            <button
              type="button"
              className="btn ghost"
              onClick={() => {
                setRevealed(true);
                setRevealedEarly(true);
                inputRef.current?.focus();
              }}
            >
              Show text (8 pts)
            </button>
          )}
        </div>
      )}

      {mode === 'mc' && (
        <div className={`choices ${Math.max(...opts.map((o) => o.length)) >= 11 ? 'long' : ''}`} role="group" aria-label="Choices">
          {opts.map((o, i) => {
            const cls = !answered ? '' : o === item.a ? 'ok' : o === chosen ? 'bad' : 'dim';
            return (
              <button key={o} type="button" className={`choice ${cls}`} disabled={answered} onClick={() => submit(o, true)} lang="de">
                <span className="kbd">{i + 1}</span>
                <span className="choice-word">{o}</span>
              </button>
            );
          })}
        </div>
      )}

      {typing && !answered && (
        <div className="stack" style={{ marginTop: 18, gap: 12 }}>
          {secondChance && (
            <div className="try-again small" role="status">
              Almost! Check the spelling and try again.
            </div>
          )}
          <div className="spread">
            {settings.umlautButtons && (
              <div className="umlauts" aria-label="Insert special characters">
                {['ä', 'ö', 'ü', 'ß'].map((c) => (
                  <button type="button" key={c} onMouseDown={(e) => e.preventDefault()} onClick={() => insert(c)}>
                    {c}
                  </button>
                ))}
              </div>
            )}
            <div className="row" style={{ gap: 6 }}>
              <button type="button" className="btn ghost" onClick={useHint} disabled={hint}>
                Hint
              </button>
              <button type="button" className="btn ghost" onClick={() => submit(given, false, true)}>
                Don’t know
              </button>
            </div>
          </div>
          <button type="submit" className="btn primary block" disabled={!given.trim()}>
            Check <span className="kbd" style={{ color: 'inherit', borderColor: 'currentColor' }}>Enter</span>
          </button>
        </div>
      )}

      {answered && (
        <div className="feedback stack" style={{ gap: 10 }} aria-live="polite">
          <div className="spread">
            {verdict === 'correct' ? (
              <span className="verdict ok">
                <IconCheck /> Richtig!
              </span>
            ) : (
              <span className="verdict bad">
                <IconX /> {verdict === 'close' ? 'Almost — check the spelling:' : given || chosen ? 'Not quite — it’s' : 'The answer is'}{' '}
                <span lang="de">“{item.a}”</span>
              </span>
            )}
            {outcome && outcome.points > 0 && <span className="pts-pop">+{outcome.points}</span>}
          </div>
          {typing && given && verdict !== 'correct' && (
            <div className="small">
              You wrote <span className="struck">{given}</span>
            </div>
          )}
          {outcome && !card.retry && outcome.after && (
            <div className="small muted">
              {verdict === 'correct' ? (
                <>
                  Mastery {mastery(outcome.before?.stage ?? 0)}% → <strong>{mastery(outcome.after.stage)}%</strong> ·{' '}
                </>
              ) : (
                <>Mastery {(outcome.before?.stage ?? 0) > 0 ? 'back to' : 'stays at'} 0% · </>
              )}
              {nextReviewText(outcome.after)}
            </div>
          )}
          {card.retry && <div className="small muted">Practice round — no points, schedule unchanged.</div>}
          {saveError && (
            <div className="small" role="alert" style={{ color: 'var(--bad)' }}>
              This answer couldn’t be saved on your device. Close the app completely and open it again.
            </div>
          )}
          <div className="audio-row">
            <button type="button" className="btn" onClick={speak}>
              <IconVolume size={18} /> Listen <span className="kbd">R</span>
            </button>
            <span className="source">{sourceLabel(source, item, settings.voice)}</span>
          </div>
          <div className="small">
            <a href={tatoebaUrl(item.id)} target="_blank" rel="noreferrer">
              Sentence #{item.id} on Tatoeba
            </a>
          </div>
          {outcome && (
            <div className="known-row" aria-live="polite">
              {known ? (
                <>
                  <span className="small">
                    <IconCheck size={16} /> Marked as known — it won’t come back in reviews.
                  </span>
                  <button type="button" className="btn ghost" onClick={toggleKnown}>
                    Undo
                  </button>
                </>
              ) : (
                <>
                  <button type="button" className="btn" onClick={toggleKnown} data-testid="known">
                    <IconCheck size={18} /> I know this <span className="kbd">K</span>
                  </button>
                  <span className="tiny muted">Too easy? It won’t come back in reviews.</span>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {answered && (
        <div className="next-bar">
          <button type="button" ref={nextRef} className="btn primary big" onClick={onNext}>
            {isLast ? 'Finish' : 'Next'} <span className="kbd" style={{ color: 'inherit', borderColor: 'currentColor' }}>Enter</span>
          </button>
        </div>
      )}
    </form>
  );
}

/* ------------------------------------------------------------------------ */

function Summary({ results, known, onAgain }: { results: Result[]; known: Set<number>; onAgain(): void }) {
  const { settings, days, today } = useStore();
  useEffect(() => syncSoon(500), []);
  const first = results.filter((r) => !r.retry);
  const points = results.reduce((s, r) => s + r.points, 0);
  const correct = first.filter((r) => r.correct).length;
  const fresh = first.filter((r) => r.isNew).length;
  const todayPts = days.get(today)?.points ?? 0;
  return (
    <div className="stack" style={{ gap: 20 }}>
      <section className="card hero">
        <Ring value={todayPts} max={settings.dailyGoal}>
          <strong>{todayPts}</strong>
          <span className="tiny muted">/ {settings.dailyGoal}</span>
        </Ring>
        <div className="stack" style={{ gap: 4 }}>
          <h1>Runde geschafft!</h1>
          <div className="muted">
            +{points} points · {correct}/{first.length} correct · {fresh} new · {first.length - fresh} reviews
          </div>
          {todayPts >= settings.dailyGoal && <div className="small">Daily goal reached — streak extended.</div>}
        </div>
      </section>
      <div className="row">
        <button className="btn primary big" style={{ flex: 1 }} onClick={onAgain} autoFocus>
          Next round
        </button>
        <a className="btn big" href="#/" style={{ flex: 1 }}>
          Home
        </a>
      </div>
      <section className="card">
        <h2 style={{ marginBottom: 6 }}>This round</h2>
        <ul className="summary-list">
          {first.map((r) => (
            <li key={r.item.id}>
              <span className={r.correct ? 'mark-ok' : 'mark-bad'} aria-label={r.correct ? 'correct' : 'wrong'}>
                {r.correct ? <IconCheck size={18} /> : <IconX size={18} />}
              </span>
              <div>
                <div lang="de" style={{ fontFamily: 'var(--serif)', fontSize: '1.05rem' }}>
                  {r.item.de.slice(0, r.item.c[0])}
                  <strong style={{ color: 'var(--accent)' }}>{r.item.a}</strong>
                  {r.item.de.slice(r.item.c[1])}
                </div>
                <div className="small muted">
                  {r.item.en}
                  {known.has(r.item.id) && <span className="badge" style={{ marginLeft: 6 }}>known</span>}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
