import { useEffect, useRef, useState } from 'react';
import { levelSummary, type LevelInfo } from '../lib/deck';
import type { LevelStat } from '../lib/levels';
import { useStore } from '../store';
import { IconHide, IconList, IconMore, IconPlay, IconReset } from './Icons';

/** Share of a level as a percentage: one decimal below 10% ("0.5%", "2.0%"), whole numbers above. */
export function percent(n: number, of: number): string {
  if (!of) return '0%';
  const p = (n / of) * 100;
  return `${p > 0 && p < 10 ? p.toFixed(1) : Math.round(p)}%`;
}

/** Ask before resetting a level, then reset it. Returns how many sentences were reset (null if cancelled). */
export async function confirmResetLevel(n: number, played: number, syncing: boolean, reset: (lv: number) => Promise<number>) {
  const where = syncing ? ' on all your synced devices' : '';
  const ok = confirm(
    `Reset Level ${n}?\n\nYour progress on its ${played.toLocaleString()} played sentences (including “known” marks) will be deleted${where}, so they come back as new. Points and streaks stay.`,
  );
  return ok ? reset(n) : null;
}

/** One level on Home: today's numbers, progress, Play / Review, and a menu (sentences, remove, reset). */
export function LevelCard({ info, stat, isCurrent, syncing }: { info: LevelInfo; stat: LevelStat; isCurrent: boolean; syncing: boolean }) {
  const { pinLevels, resetLevel } = useStore();
  const [menu, setMenu] = useState(false);
  const [msg, setMsg] = useState('');
  const wrap = useRef<HTMLDivElement>(null);
  const n = info.n;

  useEffect(() => {
    if (!menu) return;
    const outside = (e: PointerEvent) => !wrap.current?.contains(e.target as Node) && setMenu(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setMenu(false);
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', esc);
    };
  }, [menu]);

  const reset = async () => {
    setMenu(false);
    const k = await confirmResetLevel(n, stat.played, syncing, resetLevel);
    if (k !== null) setMsg(`Level ${n} was reset: ${k.toLocaleString()} sentences are new again.`);
  };

  const done = stat.played >= info.count;
  return (
    <section className="card level-card" data-testid={isCurrent ? 'current-level' : undefined} data-level={n}>
      <div className="level-card-head">
        <div className="stack" style={{ gap: 2 }}>
          <h2>
            Level {n}
            {isCurrent && <span className="badge review level-badge">your level</span>}
          </h2>
          <span className="tiny muted">{levelSummary(info)}</span>
        </div>
        <div className="menu-wrap" ref={wrap}>
          <button
            type="button"
            className="btn ghost icon-btn"
            aria-label={`Options for Level ${n}`}
            aria-haspopup="menu"
            aria-expanded={menu}
            onClick={() => setMenu((m) => !m)}
          >
            <IconMore />
          </button>
          {menu && (
            <div className="menu" role="menu">
              <a role="menuitem" href={`#/levels/${n}`}>
                <IconList size={18} /> Sentences
              </a>
              <button type="button" role="menuitem" onClick={() => (setMenu(false), pinLevels([n], false))}>
                <IconHide size={18} /> Remove from Home
              </button>
              <button type="button" role="menuitem" className="danger" onClick={reset} disabled={stat.played === 0}>
                <IconReset size={18} /> Reset Level {n}
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="mini-stats">
        <div>
          <strong>{stat.newToday}</strong>
          <span>new today</span>
        </div>
        <div>
          <strong>{stat.reviewedToday}</strong>
          <span>reviewed today</span>
        </div>
        <div>
          <strong>{stat.due}</strong>
          <span>due</span>
        </div>
      </div>

      <div className="stack" style={{ gap: 6 }}>
        <div className="spread small">
          <span>
            <strong>{stat.played.toLocaleString()}</strong> / {info.count.toLocaleString()} played
          </span>
          <span className="muted">{percent(stat.played, info.count)}</span>
        </div>
        <div className="meter thin" aria-label={`${stat.played} of ${info.count} played, ${stat.mastered} mastered`}>
          <span className="m-done" style={{ width: `${(stat.mastered / info.count) * 100}%` }} />
          <span style={{ width: `${((stat.played - stat.mastered) / info.count) * 100}%` }} />
        </div>
        <span className="tiny muted">
          {percent(stat.mastered, info.count)} mastered · {Math.round((info.audio / info.count) * 100)}% recorded by native speakers
        </span>
      </div>

      <div className="level-actions">
        <a className="btn primary" href={`#/play?kind=new&level=${n}`}>
          <IconPlay size={16} /> {done ? 'All played' : 'Play'}
        </a>
        <a
          className="btn"
          href={stat.due > 0 ? `#/play?kind=review&level=${n}` : undefined}
          aria-disabled={stat.due === 0}
          onClick={(e) => stat.due === 0 && e.preventDefault()}
        >
          Review ({stat.due.toLocaleString()})
        </a>
      </div>
      {msg && (
        <p className="small" role="status" style={{ margin: 0 }}>
          {msg}
        </p>
      )}
    </section>
  );
}
