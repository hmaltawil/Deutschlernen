import { useEffect, useState } from 'react';
import { lastStartup, type StartupReport } from '../lib/startup';

const sec = (ms?: number) => (ms === undefined ? '—' : `${(ms / 1000).toFixed(1)} s`);

/** Shows how long the last app start took, step by step (for diagnosing slow devices). */
export function StartupTime() {
  const [r, setR] = useState<StartupReport | null>(lastStartup);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    const t = setInterval(() => setR(lastStartup()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!r) return null;
  const m = r.marks;
  const rows: [string, string][] = [
    [`Page loaded ${r.page.fromOfflineCache ? '(from offline copy)' : '(from the internet)'}`, sec(r.page.received)],
    ['App code started', sec(m.script)],
    ['Sentence list ready', sec(m.sentences)],
    ['Your progress loaded', sec(m.progress)],
    ['Home screen shown', sec(m.screen)],
    ['Voice checked', sec(m.voice)],
    ['Offline check done', sec(m.offline)],
    ['First sync done', sec(m.sync)],
  ];
  const text = `Lücke startup (${new Date(r.at).toLocaleString()}, ${navigator.userAgent})\n` + rows.map(([a, b]) => `${a}: ${b}`).join('\n');
  return (
    <section className="card">
      <div className="spread">
        <h2>Startup time</h2>
        <span className="small" style={{ fontWeight: 600 }}>
          Home screen after {sec(m.screen)}
        </span>
      </div>
      <p className="tiny muted" style={{ margin: '4px 0 8px' }}>
        How long this app start took, step by step, counted from when the page began loading. Time your phone spends
        launching the app before that isn’t included.
      </p>
      <table className="data" aria-label="Startup steps">
        <tbody>
          {rows.map(([a, b]) => (
            <tr key={a}>
              <td>{a}</td>
              <td>{b}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <button
        className="btn"
        style={{ marginTop: 10 }}
        onClick={() =>
          navigator.clipboard?.writeText(text).then(
            () => (setCopied(true), setTimeout(() => setCopied(false), 2000)),
            () => {},
          )
        }
      >
        {copied ? 'Copied ✓' : 'Copy these numbers'}
      </button>
    </section>
  );
}
