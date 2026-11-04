import { useMemo } from 'react';
import { streaks } from '../lib/scoring';
import type { Mode } from '../lib/session';
import { isMastered } from '../lib/srs';
import { statOf } from '../lib/levels';
import { useStore } from '../store';
import { IconClock, IconFlame, IconHeadphones, IconKeyboard, IconList, IconPlay } from './Icons';
import { Ring } from './Ring';
import { VoiceBanner } from './VoiceBanner';
import { LevelCard } from './LevelCard';
import { useSync } from './Sync';

export const MODES: { id: Mode; label: string; desc: string; icon: JSX.Element }[] = [
  { id: 'mc', label: 'Choose', desc: 'Pick the missing word from four options · 4 pts', icon: <IconList size={16} /> },
  { id: 'text', label: 'Type', desc: 'Type the missing word yourself · 8 pts', icon: <IconKeyboard size={16} /> },
  { id: 'listen', label: 'Listen', desc: 'Hear the sentence, then type the missing word · 10 pts', icon: <IconHeadphones size={16} /> },
];

export function ModePicker() {
  const { settings, updateSettings } = useStore();
  const mode = MODES.find((m) => m.id === settings.mode) ?? MODES[0];
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="seg" role="group" aria-label="Answer mode">
        {MODES.map((m) => (
          <button key={m.id} aria-pressed={settings.mode === m.id} onClick={() => updateSettings({ mode: m.id })}>
            {m.icon}
            {m.label}
          </button>
        ))}
      </div>
      <div className="mode-desc">{mode.desc}</div>
    </div>
  );
}

export function Home() {
  const { manifest, settings, days, today, dueCount, progress, levelStats, homeLevels, currentLevel } = useStore();
  const sync = useSync();
  const syncing = sync.state !== 'off' && sync.state !== 'unavailable';
  const pts = days.get(today)?.points ?? 0;
  const streak = useMemo(() => streaks(days.values(), settings.dailyGoal, today, settings.goalHistory), [days, settings.dailyGoal, today, settings.goalHistory]);
  const mastered = useMemo(() => [...progress.values()].filter(isMastered).length, [progress]);
  if (!manifest) return null;
  const goalLeft = Math.max(settings.dailyGoal - pts, 0);

  return (
    <div className="stack" style={{ gap: 20 }}>
      <section className="card hero">
        <Ring value={pts} max={settings.dailyGoal}>
          <strong>{pts}</strong>
          <span className="tiny muted">/ {settings.dailyGoal} pts</span>
        </Ring>
        <div className="stack" style={{ gap: 6 }}>
          <h1>{progress.size === 0 ? 'Willkommen!' : pts >= settings.dailyGoal ? 'Tagesziel erreicht!' : 'Weiter geht’s'}</h1>
          <div className="muted small">
            {progress.size === 0
              ? 'Learn German words in real sentences, most common words first.'
              : goalLeft > 0
                ? `${goalLeft} points to today’s goal.`
                : 'Daily goal reached. Anything more is a bonus.'}
          </div>
          <div className="row" style={{ gap: 16, marginTop: 4 }}>
            <span className={`streak-chip ${streak.current > 0 ? 'on' : ''}`} title="Days in a row with your goal reached">
              <IconFlame size={18} /> {streak.current} day{streak.current === 1 ? '' : 's'}
            </span>
            <span className="streak-chip" title="Sentences due for review">
              <IconClock size={18} /> {dueCount} due
            </span>
          </div>
        </div>
      </section>

      <VoiceBanner />

      <section className="card stack">
        <div className="spread">
          <h2>Play</h2>
          <span className="small muted">{settings.roundSize} sentences per round</span>
        </div>
        <ModePicker />
        <a className="btn primary big block" href="#/play?kind=mixed">
          <IconPlay size={18} /> {dueCount > 0 ? 'Play — reviews first' : 'Play'}
        </a>
        <div className="row" style={{ gap: 10 }}>
          <a
            className="btn"
            style={{ flex: 1 }}
            href={dueCount > 0 ? '#/play?kind=review' : undefined}
            aria-disabled={dueCount === 0}
            onClick={(e) => dueCount === 0 && e.preventDefault()}
          >
            Review ({dueCount})
          </a>
          <a className="btn" style={{ flex: 1 }} href="#/play?kind=new">
            Learn new
          </a>
        </div>
      </section>

      <section className="stack" style={{ gap: 12 }} data-testid="your-levels">
        <div className="spread">
          <h2>Your levels</h2>
          <a className="btn ghost" style={{ minHeight: 36, padding: '6px 10px' }} href="#/levels">
            All levels
          </a>
        </div>
        {homeLevels.length ? (
          homeLevels.map((n) => (
            <LevelCard key={n} info={manifest.levels[n - 1]} stat={statOf(levelStats, n)} isCurrent={n === currentLevel} syncing={syncing} />
          ))
        ) : (
          <div className="card small muted">
            No levels here. Open <a href="#/levels">Levels</a> and play one — levels you play show up here.
          </div>
        )}
      </section>

      <section className="tiles">
        <div className="tile">
          <div className="label">Sentences played</div>
          <div className="value">{progress.size.toLocaleString()}</div>
          <div className="sub">of {manifest.total.toLocaleString()}</div>
        </div>
        <div className="tile">
          <div className="label">Mastered</div>
          <div className="value">{mastered.toLocaleString()}</div>
          <div className="sub">at 100%</div>
        </div>
        <div className="tile">
          <div className="label">Best streak</div>
          <div className="value">{streak.best}</div>
          <div className="sub">days</div>
        </div>
      </section>
    </div>
  );
}
