import { useEffect, useMemo, useState } from 'react';
import { levelSummary, loadLevel, type Item } from '../lib/deck';
import { mastery, shownStage } from '../lib/srs';
import { currentLevel } from '../lib/session';
import { useStore } from '../store';
import { IconArrowLeft, IconPlay } from './Icons';

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

const STAGE_COLOR = ['var(--m0)', 'var(--m1)', 'var(--m2)', 'var(--m3)', 'var(--m4)'];
type Filter = 'all' | 'played' | 'unplayed' | 'known';

export function LevelDetail({ n }: { n: number }) {
  const { manifest, progress, playedPerLevel, setKnown } = useStore();
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
            : !progress.has(it.id),
    );
  }, [items, filter, progress]);
  const info = manifest?.levels.find((l) => l.n === n);
  if (!info) return <div className="card">No such level.</div>;
  const played = playedPerLevel.get(n) ?? 0;

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
      <div className="seg" role="group" aria-label="Filter sentences">
        {(['all', 'played', 'unplayed', 'known'] as Filter[]).map((f) => (
          <button key={f} aria-pressed={filter === f} onClick={() => setFilter(f)}>
            {f[0].toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>
      <section className="card" style={{ padding: '4px 16px' }}>
        {!items ? (
          <div className="spinner" />
        ) : shown.length === 0 ? (
          <p className="muted">Nothing here yet.</p>
        ) : (
          shown.slice(0, limit).map((it) => {
            const p = progress.get(it.id);
            return (
              <div key={it.id} className="sent-row">
                <span
                  className="dot"
                  style={{ background: p ? STAGE_COLOR[shownStage(p)] : 'transparent', border: p ? 0 : '1.5px solid var(--line)' }}
                  title={p ? (p.known ? 'Known' : `${mastery(p.stage)}% mastered`) : 'Not played yet'}
                />
                <div>
                  <div className="de" lang="de">
                    {it.de.slice(0, it.c[0])}
                    <b>{it.a}</b>
                    {it.de.slice(it.c[1])}
                  </div>
                  <div className="small muted">
                    {it.en}
                    {it.au ? ' · native audio' : ''}
                  </div>
                  {p?.known && (
                    <div className="row" style={{ gap: 8, marginTop: 4 }}>
                      <span className="badge">known · not reviewed</span>
                      <button className="btn ghost" style={{ minHeight: 0, padding: '2px 8px' }} onClick={() => setKnown(it.id, false)}>
                        Review again
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })
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
