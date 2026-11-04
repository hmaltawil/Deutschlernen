import { useEffect, useMemo, useState } from 'react';
import { levelSummary, loadLevel, type Item } from '../lib/deck';
import { currentLevel } from '../lib/session';
import { useStore } from '../store';
import { IconArrowLeft, IconCheck, IconPlay, IconReset } from './Icons';
import { confirmResetLevel } from './LevelCard';
import { SentenceRow } from './SentenceRow';
import { useSync } from './Sync';
import { statOf } from '../lib/levels';

export function Levels() {
  const { manifest, playedPerLevel, masteredPerLevel, settings } = useStore();
  if (!manifest) return null;
  const mine = currentLevel(playedPerLevel, manifest.levels, settings.currentLevel);
  return (
    <div className="stack" style={{ gap: 20 }}>
      <div>
        <h1>Levels</h1>
        <p className="muted small" style={{ margin: '4px 0 0' }}>
          {manifest.total.toLocaleString()} sentences · {manifest.words.toLocaleString()} words ·{' '}
          {manifest.audio.toLocaleString()} recorded by native speakers. Levels get harder in two ways: rarer missing
          words, and longer sentences with more complex grammar.
        </p>
      </div>
      <section className="card" style={{ padding: '6px 16px' }}>
        {manifest.levels.map((l) => {
          const played = playedPerLevel.get(l.n) ?? 0;
          const done = masteredPerLevel.get(l.n) ?? 0;
          return (
            <a key={l.n} className="level-row" href={`#/levels/${l.n}`}>
              <span className="lv">
                Level {l.n}
                {l.n === mine && (
                  <span className="badge review" style={{ display: 'table', marginTop: 4 }}>
                    yours
                  </span>
                )}
              </span>
              <div className="stack" style={{ gap: 4 }}>
                <div className="meter thin" aria-hidden="true">
                  <span className="m-done" style={{ width: `${(done / l.count) * 100}%` }} />
                  <span style={{ width: `${((played - done) / l.count) * 100}%` }} />
                </div>
                <span className="tiny muted">
                  {levelSummary(l)} · {Math.round((l.audio / l.count) * 100)}% recorded
                </span>
              </div>
              <span className="small muted" style={{ fontVariantNumeric: 'tabular-nums' }}>
                {played}/{l.count}
              </span>
            </a>
          );
        })}
      </section>
      <p className="tiny muted">Dark segment = mastered (100%), light = played.</p>
    </div>
  );
}

type Filter = 'all' | 'played' | 'unplayed' | 'known' | 'favourites';

export function LevelDetail({ n }: { n: number }) {
  const { manifest, progress, playedPerLevel, levelStats, homeLevels, pinLevels, resetLevel, favoriteIds } = useStore();
  const sync = useSync();
  const syncing = sync.state !== 'off' && sync.state !== 'unavailable';
  const [msg, setMsg] = useState('');
  const [items, setItems] = useState<Item[] | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [limit, setLimit] = useState(60);
  useEffect(() => {
    setItems(null);
    loadLevel(n).then(setItems).catch(() => setItems([]));
  }, [n]);
  const shown = useMemo(() => {
    if (!items) return [];
    return items.filter((it) =>
      filter === 'all'
        ? true
        : filter === 'played'
          ? progress.has(it.id)
          : filter === 'known'
            ? !!progress.get(it.id)?.known
            : filter === 'favourites'
              ? favoriteIds.has(it.id)
              : !progress.has(it.id),
    );
  }, [items, filter, progress, favoriteIds]);
  const info = manifest?.levels.find((l) => l.n === n);
  if (!info) return <div className="card">No such level.</div>;
  const played = playedPerLevel.get(n) ?? 0;
  const due = statOf(levelStats, n).due;
  const onHome = homeLevels.includes(n);
  const reset = async () => {
    const k = await confirmResetLevel(n, played, syncing, resetLevel);
    if (k !== null) setMsg(`Level ${n} was reset: ${k.toLocaleString()} sentences are new again.`);
  };

  return (
    <div className="stack" style={{ gap: 16 }}>
      <a href="#/levels" className="btn ghost" style={{ alignSelf: 'flex-start', paddingLeft: 4 }}>
        <IconArrowLeft size={18} /> All levels
      </a>
      <div className="spread">
        <div>
          <h1>Level {n}</h1>
          <div className="small muted">
            {levelSummary(info)} · {played}/{info.count} played
          </div>
        </div>
        <a className="btn primary" href={`#/play?kind=new&level=${n}`}>
          <IconPlay size={16} /> Play this level
        </a>
      </div>
      <div className="row" style={{ gap: 8 }}>
        <a
          className="btn"
          href={due > 0 ? `#/play?kind=review&level=${n}` : undefined}
          aria-disabled={due === 0}
          onClick={(e) => due === 0 && e.preventDefault()}
        >
          Review ({due.toLocaleString()})
        </a>
        <button className="btn" aria-pressed={onHome} onClick={() => pinLevels([n], !onHome)}>
          {onHome ? <IconCheck size={16} /> : null} {onHome ? 'On Home' : 'Show on Home'}
        </button>
        <button className="btn ghost danger" onClick={reset} disabled={played === 0}>
          <IconReset size={16} /> Reset level
        </button>
      </div>
      {msg && (
        <p className="small" role="status" style={{ margin: 0 }}>
          {msg}
        </p>
      )}
      <div className="seg" role="group" aria-label="Filter sentences">
        {(['all', 'played', 'unplayed', 'known', 'favourites'] as Filter[]).map((f) => (
          <button key={f} aria-pressed={filter === f} onClick={() => setFilter(f)} aria-label={f === 'favourites' ? 'Favourites' : undefined}>
            {f === 'favourites' ? '★' : f[0].toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>
      <section className="card" style={{ padding: '4px 16px' }}>
        {!items ? (
          <div className="spinner" />
        ) : shown.length === 0 ? (
          <p className="muted">Nothing here yet.</p>
        ) : (
          shown.slice(0, limit).map((it) => <SentenceRow key={it.id} item={it} />)
        )}
      </section>
      {shown.length > limit && (
        <button className="btn" onClick={() => setLimit((l) => l + 100)}>
          Show more ({shown.length - limit} left)
        </button>
      )}
    </div>
  );
}
