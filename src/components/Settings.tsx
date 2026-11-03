import { useRef, useState } from 'react';
import { exportBackup, importBackup, resetProgress } from '../lib/db';
import { piper, speakText } from '../lib/audio';
import { DEFAULT_SETTINGS, VOICES, type Theme } from '../lib/settings';
import { useStore } from '../store';
import { ModePicker } from './Home';
import { IconDownload, IconVolume } from './Icons';
import { useVoice } from './useVoice';
import { VoiceBanner } from './VoiceBanner';

function Toggle({ id, checked, onChange }: { id: string; checked: boolean; onChange(v: boolean): void }) {
  return <input id={id} type="checkbox" role="switch" className="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />;
}

export function SettingsPage() {
  const { settings, updateSettings, reload } = useStore();
  const voice = useVoice();
  const fileRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState('');

  const setVoice = (id: string) => {
    updateSettings({ voice: id });
    piper.check(id);
  };

  const doExport = async () => {
    const b = await exportBackup();
    const blob = new Blob([JSON.stringify(b)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `luecke-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    setMsg(`Exported ${b.progress.length.toLocaleString()} sentences.`);
  };

  const doImport = async (f: File) => {
    try {
      const data = JSON.parse(await f.text());
      if (!confirm('Replace all progress on this device with this backup?')) return;
      await importBackup(data);
      await reload();
      setMsg('Backup restored.');
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  const doReset = async () => {
    if (!confirm('Delete all progress, points and streaks on this device? This cannot be undone.')) return;
    await resetProgress();
    await reload();
    setMsg('Progress reset.');
  };

  const sameVoice = voice.voiceId === settings.voice;
  return (
    <div className="stack" style={{ gap: 20 }}>
      <h1>Settings</h1>

      <section className="card">
        <h2>Practice</h2>
        <div className="field">
          <label>Default answer mode</label>
          <span />
          <div style={{ gridColumn: '1 / -1' }}>
            <ModePicker />
          </div>
        </div>
        <div className="field">
          <label htmlFor="round">Sentences per round</label>
          <select id="round" value={settings.roundSize} onChange={(e) => updateSettings({ roundSize: Number(e.target.value) })}>
            {[5, 10, 15, 20, 30].map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="goal">Daily goal (points)</label>
          <select id="goal" value={settings.dailyGoal} onChange={(e) => updateSettings({ dailyGoal: Number(e.target.value) })}>
            {[50, 100, 200, 300, 500, 1000].map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
          <span className="hint">A streak day is a day you reach this goal.</span>
        </div>
        <div className="field">
          <label htmlFor="hint">Show English translation while answering</label>
          <Toggle id="hint" checked={settings.showHint} onChange={(v) => updateSettings({ showHint: v })} />
        </div>
        <div className="field">
          <label>Review intervals (days)</label>
          <div className="intervals">
            {settings.intervals.map((d, i) => (
              <input
                key={i}
                type="number"
                min={1}
                max={3650}
                value={d}
                aria-label={`Interval after reaching ${(i + 1) * 25}%`}
                onChange={(e) => {
                  const v = Math.max(1, Math.min(3650, Number(e.target.value) || 1));
                  const next = [...settings.intervals];
                  next[i] = v;
                  updateSettings({ intervals: next });
                }}
              />
            ))}
          </div>
          <span className="hint">
            Wait after reaching 25% / 50% / 75% / 100% mastery. A wrong answer resets to 0%.{' '}
            <button className="btn ghost" style={{ minHeight: 0, padding: '0 4px' }} onClick={() => updateSettings({ intervals: [...DEFAULT_SETTINGS.intervals] })}>
              Reset
            </button>
          </span>
        </div>
      </section>

      <section className="card">
        <h2>Audio</h2>
        <div className="field">
          <label htmlFor="autoplay">Play audio after each answer</label>
          <Toggle id="autoplay" checked={settings.autoplay} onChange={(v) => updateSettings({ autoplay: v })} />
        </div>
        <div className="field">
          <label htmlFor="rate">Speed</label>
          <select id="rate" value={settings.rate} onChange={(e) => updateSettings({ rate: Number(e.target.value) })}>
            <option value={0.75}>Slow (0.75×)</option>
            <option value={0.9}>Relaxed (0.9×)</option>
            <option value={1}>Normal</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="voice">Neural voice for unrecorded sentences</label>
          <select id="voice" value={settings.voice} onChange={(e) => setVoice(e.target.value)}>
            {VOICES.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label} · {v.mb} MB
              </option>
            ))}
          </select>
          <span className="hint">
            Sentences with a native-speaker recording always use it. The neural voice runs on your device (Piper); it is
            downloaded once and then works offline.{' '}
            {sameVoice && voice.state === 'ready' && <strong>Downloaded ✓</strong>}
          </span>
          <div className="row" style={{ gridColumn: '1 / -1', marginTop: 6 }}>
            {sameVoice && voice.state === 'missing' && (
              <button className="btn primary" onClick={() => piper.load(settings.voice).catch(() => {})}>
                <IconDownload size={18} /> Download voice
              </button>
            )}
            <button className="btn" onClick={() => speakText('Guten Morgen! Wie geht es dir heute?', settings.rate, settings.voice)}>
              <IconVolume size={18} /> Test voice
            </button>
            {sameVoice && voice.state === 'ready' && (
              <button className="btn ghost danger" onClick={() => piper.remove(settings.voice)}>
                Remove from device
              </button>
            )}
          </div>
        </div>
        {sameVoice && (voice.state === 'downloading' || voice.state === 'error') && <VoiceBanner compact />}
      </section>

      <section className="card">
        <h2>Appearance</h2>
        <div className="field">
          <label>Theme</label>
          <div className="seg" role="group" aria-label="Theme">
            {(['system', 'light', 'dark'] as Theme[]).map((t) => (
              <button key={t} aria-pressed={settings.theme === t} onClick={() => updateSettings({ theme: t })}>
                {t[0].toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="card">
        <h2>Your data</h2>
        <p className="small muted" style={{ margin: '6px 0 4px' }}>
          Progress is stored only in this browser. Export a backup to move it to another device.
        </p>
        <div className="row" style={{ marginTop: 10 }}>
          <button className="btn" onClick={doExport}>
            Export backup
          </button>
          <button className="btn" onClick={() => fileRef.current?.click()}>
            Import backup
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            data-testid="import-file"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) doImport(f);
              e.target.value = '';
            }}
          />
          <button className="btn ghost danger" onClick={doReset}>
            Reset progress
          </button>
        </div>
        {msg && (
          <p className="small" role="status" style={{ marginBottom: 0 }}>
            {msg}
          </p>
        )}
      </section>

      <p className="small muted center">
        <a href="#/credits">Credits &amp; licences</a>
      </p>
    </div>
  );
}
