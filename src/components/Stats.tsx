import { useMemo } from 'react';
import { addDays, dayKey, streaks } from '../lib/scoring';
import { shownStage } from '../lib/srs';
import { count, noun } from '../lib/text';
import { useStore } from '../store';
import { ColumnChart, SegmentedBar, type Datum } from './charts';

const monthDay = (key: string) => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};
const weekday = (key: string) => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short' });
};

export function Stats() {
  const { manifest, progress, days, settings, today, now, dueCount, playedPerLevel, masteredPerLevel } = useStore();

  const streak = useMemo(() => streaks(days.values(), settings.dailyGoal, today, settings.goalHistory), [days, settings.dailyGoal, today, settings.goalHistory]);

  const totals = useMemo(() => {
    let correct = 0;
    let wrong = 0;
    let points = 0;
    for (const d of days.values()) {
      correct += d.correct;
      wrong += d.wrong;
      points += d.points;
    }
    const stages = [0, 0, 0, 0, 0];
    for (const p of progress.values()) stages[shownStage(p)]++;
    return { correct, wrong, points, stages, accuracy: correct + wrong ? Math.round((correct / (correct + wrong)) * 100) : null };
  }, [days, progress]);

  const last30: Datum[] = useMemo(() => {
    const out: Datum[] = [];
    for (let i = 29; i >= 0; i--) {
      const key = addDays(today, -i);
      const d = days.get(key);
      out.push({
        key,
        tick: i % 7 === 0 ? (i === 0 ? 'Today' : monthDay(key)) : '',
        label: i === 0 ? `Today (${monthDay(key)})` : monthDay(key),
        value: d?.points ?? 0,
        detail: d ? `${d.correct} right · ${d.wrong} wrong · ${d.learned} new` : undefined,
      });
    }
    return out;
  }, [days, today]);

  const forecast: Datum[] = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of progress.values()) {
      if (p.known) continue;
      const key = p.due <= now ? today : dayKey(p.due);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return Array.from({ length: 7 }, (_, i) => {
      const key = addDays(today, i);
      return {
        key,
        tick: i === 0 ? 'Today' : weekday(key),
        label: i === 0 ? 'Today (incl. overdue)' : `${weekday(key)}, ${monthDay(key)}`,
        value: counts.get(key) ?? 0,
      };
    });
  }, [progress, now, today]);

  const week = last30.slice(-7).reduce((s, d) => s + d.value, 0);
  if (!manifest) return null;
  const stageParts = [
    { name: 'Learning (0%)', value: totals.stages[0], color: 'var(--m0)', ink: 'var(--m0-ink)' },
    { name: '25%', value: totals.stages[1], color: 'var(--m1)', ink: 'var(--m1-ink)' },
    { name: '50%', value: totals.stages[2], color: 'var(--m2)', ink: 'var(--m2-ink)' },
    { name: '75%', value: totals.stages[3], color: 'var(--m3)', ink: 'var(--m3-ink)' },
    { name: '100% mastered', value: totals.stages[4], color: 'var(--m4)', ink: 'var(--m4-ink)' },
  ];

  return (
    <div className="stack" style={{ gap: 20 }}>
      <h1>Stats</h1>
      <section className="tiles">
        <div className="tile">
          <div className="label">Current streak</div>
          <div className="value">{streak.current}</div>
          <div className="sub">{streak.todayMet ? 'goal met today' : `${noun(streak.current, 'day')} · play to extend`}</div>
        </div>
        <div className="tile">
          <div className="label">Best streak</div>
          <div className="value">{streak.best}</div>
          <div className="sub">{noun(streak.best, 'day')}</div>
        </div>
        <div className="tile">
          <div className="label">Points this week</div>
          <div className="value">{week.toLocaleString()}</div>
          <div className="sub">{totals.points.toLocaleString()} all time</div>
        </div>
        <div className="tile">
          <div className="label">Accuracy</div>
          <div className="value">{totals.accuracy === null ? '—' : `${totals.accuracy}%`}</div>
          <div className="sub">
            {totals.correct.toLocaleString()} of {count(totals.correct + totals.wrong, 'answer')}
          </div>
        </div>
        <div className="tile">
          <div className="label">Sentences played</div>
          <div className="value">{progress.size.toLocaleString()}</div>
          <div className="sub">of {manifest.total.toLocaleString()}</div>
        </div>
        <div className="tile">
          <div className="label">Due now</div>
          <div className="value">{dueCount.toLocaleString()}</div>
          <div className="sub">{noun(dueCount, 'review')}</div>
        </div>
      </section>

      <section className="card stack" style={{ gap: 10 }}>
        <div>
          <h2>Points per day</h2>
          <div className="small muted">
            Last 30 days · goal line at {settings.dailyGoal}
            {last30[last30.length - 1].value > 0 && ` · today ${count(last30[last30.length - 1].value, 'point')}`}
          </div>
        </div>
        <ColumnChart data={last30} goal={settings.dailyGoal} unit="points" />
      </section>

      <section className="card stack" style={{ gap: 10 }}>
        <div>
          <h2>Mastery</h2>
          <div className="small muted">All sentences you have played, by mastery level</div>
        </div>
        <SegmentedBar parts={stageParts} label="Mastery breakdown" />
      </section>

      <section className="card stack" style={{ gap: 10 }}>
        <div>
          <h2>Upcoming reviews</h2>
          <div className="small muted">Sentences due in the next 7 days</div>
        </div>
        <ColumnChart data={forecast} unit="reviews" height={150} />
      </section>

      <section className="card stack" style={{ gap: 6 }}>
        <h2>Progress by level</h2>
        <table className="data">
          <thead>
            <tr>
              <th>Level</th>
              <th>Played</th>
              <th>Mastered</th>
              <th style={{ width: '40%' }}>
                <span className="sr-only">Progress</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {manifest.levels.map((l) => {
              const played = playedPerLevel.get(l.n) ?? 0;
              const done = masteredPerLevel.get(l.n) ?? 0;
              return (
                <tr key={l.n}>
                  <td>
                    <a href={`#/levels/${l.n}`}>Level {l.n}</a>
                  </td>
                  <td>
                    {played}/{l.count}
                  </td>
                  <td>{done}</td>
                  <td>
                    <div className="meter thin" aria-hidden="true">
                      <span className="m-done" style={{ width: `${(done / l.count) * 100}%` }} />
                      <span style={{ width: `${((played - done) / l.count) * 100}%` }} />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </div>
  );
}
