import { useEffect, useRef, useState } from 'react';
import { exportBackup, importBackup, resetProgress, validateBackup } from '../lib/db';
import { levelIndex } from '../lib/deck';
import { piper, speakText } from '../lib/audio';
import { DEFAULT_SETTINGS, VOICES, type Theme } from '../lib/settings';
import { useStore } from '../store';
import { ModePicker } from './Home';
import { IconDownload, IconVolume } from './Icons';
import { useVoice } from './useVoice';
import { VoiceBanner } from './VoiceBanner';
import { useOffline } from './useOffline';
import { refreshCounts, removeSavedRecordings, saveAllRecordings, stopSavingRecordings } from '../lib/offline';
import { allChunkIds } from '../lib/sync/core';
import { markDirty, syncNow } from '../lib/sync/engine';
import { SyncSection, useSync } from './Sync';
import { StartupTime } from './StartupTime';

function OfflineSection() {
  const off = useOffline();
  const voice = useVoice();
  const { settings, updateSettings } = useStore();
  useEffect(() => {
    refreshCounts();
  }, [off.background]);
  const voiceReady = voice.state === 'ready' && voice.voiceId === settings.voice;
  const mb = (b: number) => Math.round(b / 1e6);
  const pct = off.job && off.job.todo ? Math.round((off.job.done / off.job.todo) * 100) : 0;
  const allSaved = off.totalLevels > 0 && off.savedLevels === off.totalLevels;
  return (
    <section className="card">
      <h2>Offline</h2>
      <div className="field">
        <label>App and all sentences</label>
        <span className="small" style={{ fontWeight: 600 }}>
          {off.app === 'ready' ? 'Saved on this device ✓' : off.app === 'saving' ? 'Saving…' : 'Not available here'}
        </span>
        <span className="hint">
          {off.app === 'unsupported'
            ? 'Offline mode works in the published app (not in development mode) in modern browsers.'
            : 'The app opens and works without internet. Progress is always saved on this device.'}
        </span>
      </div>
      <div className="field">
        <label>Neural voice</label>
        <span className="small" style={{ fontWeight: 600 }}>
          {voiceReady ? 'Downloaded ✓' : 'Not downloaded'}
        </span>
        <span className="hint">
          {voiceReady
            ? 'Speaks every sentence without internet.'
            : 'Download it in Audio above so sentences can be spoken without internet.'}
        </span>
      </div>
      <div className="field">
        <label>Native-speaker recordings</label>
        <span className="small" style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }} data-testid="levels-saved">
          {off.savedLevels} / {off.totalLevels} levels saved
        </span>
        <span className="hint">
          {allSaved
            ? `All recordings are on this device (${mb(off.savedBytes)} MB).`
            : `${mb(off.savedBytes)} of ${mb(off.totalBytes)} MB saved. Without internet, recordings of levels that aren’t saved are read by the neural voice.`}
          {off.background !== null && !off.job && ` Saving level ${off.background}…`}
        </span>
        {off.job && (
          <div style={{ gridColumn: '1 / -1', marginTop: 6 }} className="stack">
            <div className="meter thin" aria-label={`Saving recordings ${pct}%`}>
              <span style={{ width: `${pct}%` }} />
            </div>
            <span className="tiny muted">
              Saving… {mb(off.job.done)} / {mb(off.job.todo)} MB
            </span>
          </div>
        )}
        {off.error && (
          <span className="hint" style={{ color: 'var(--bad)' }}>
            {off.error}
          </span>
        )}
        {off.app !== 'unsupported' && (
          <div className="row" style={{ gridColumn: '1 / -1', marginTop: 6 }}>
            {off.job ? (
              <button className="btn" onClick={stopSavingRecordings}>
                Stop
              </button>
            ) : (
              !allSaved && (
                <button className="btn primary" onClick={() => saveAllRecordings()}>
                  <IconDownload size={18} /> Save all recordings ({mb(off.totalBytes - off.savedBytes)} MB)
                </button>
              )
            )}
            {!off.job && off.savedLevels > 0 && (
              <button
                className="btn ghost danger"
                onClick={() => confirm('Remove saved recordings from this device?') && removeSavedRecordings()}
              >
                Remove saved recordings
              </button>
            )}
          </div>
        )}
      </div>
      <div className="field">
        <label htmlFor="autosave">Save each level’s recordings when I start it</label>
        <Toggle id="autosave" checked={settings.autoSaveRecordings} onChange={(v) => updateSettings({ autoSaveRecordings: v })} />
        <span className="hint">About 0.5–12 MB per level, downloaded in the background while you play.</span>
      </div>
    </section>
  );
}

function Toggle({ id, checked, onChange }: { id: string; checked: boolean; onChange(v: boolean): void }) {
  return <input id={id} type="checkbox" role="switch" className="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />;
}

export function SettingsPage({ joinCode }: { joinCode?: string }) {
  const { settings, updateSettings, reload, manifest } = useStore();
  const sync = useSync();
  const syncing = sync.state !== 'off' && sync.state !== 'unavailable';
  const resyncAll = () => {
    if (!syncing || !manifest) return;
    markDirty(allChunkIds(manifest.levels.map((l) => l.n), manifest.version));
    syncNow();
  };
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
      validateBackup(data);
      if (!confirm('Replace all progress on this device with this backup?')) return;
      setMsg('Restoring…');
      if (syncing) await syncNow(); // hear about a reset made on another device first
      const { restored, dropped } = await importBackup(data, await levelIndex(), manifest?.version);
      await reload();
      resyncAll();
      const left = dropped ? ` (${dropped.toLocaleString()} no longer in the deck were left out)` : '';
      setMsg(
        `Backup restored: ${restored.toLocaleString()} sentences${left}` +
          (syncing ? ', combined with your synced progress.' : '.'),
      );
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  const doReset = async () => {
    const where = syncing ? 'on ALL your synced devices' : 'on this device';
    if (!confirm(`Delete all progress, points and streaks ${where}? This cannot be undone.`)) return;
    await resetProgress();
    await reload();
    resyncAll();
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

      <section className="card" data-testid="game-options">
        <h2>While you answer</h2>
        <div className="field">
          <label htmlFor="hint">Show English translation</label>
          <Toggle id="hint" checked={settings.showHint} onChange={(v) => updateSettings({ showHint: v })} />
          <span className="hint">Shown under the sentence while you answer. After answering it is always shown.</span>
        </div>
        <div className="field">
          <label htmlFor="audio-before">Speaker button before answering</label>
          <Toggle id="audio-before" checked={settings.audioBeforeAnswer} onChange={(v) => updateSettings({ audioBeforeAnswer: v })} />
          <span className="hint">
            In Choose and Type, lets you hear the sentence before you answer — which gives the missing word away. Listen
            always plays it.
          </span>
        </div>
        <div className="field">
          <label htmlFor="typing-color">Colour hint while typing</label>
          <Toggle id="typing-color" checked={settings.typingColor} onChange={(v) => updateSettings({ typingColor: v })} />
          <span className="hint">The box turns green while what you type matches the answer so far, red as soon as it doesn’t.</span>
        </div>
        <div className="field">
          <label htmlFor="fit-box">Box fits the missing word</label>
          <Toggle id="fit-box" checked={settings.fitBox} onChange={(v) => updateSettings({ fitBox: v })} />
          <span className="hint">
            The typing box is as wide as the missing word. Turn off to get the same size box for every word, so its length
            doesn’t give it away.
          </span>
        </div>
        <div className="field">
          <label htmlFor="umlaut-buttons">ä ö ü ß buttons</label>
          <Toggle id="umlaut-buttons" checked={settings.umlautButtons} onChange={(v) => updateSettings({ umlautButtons: v })} />
          <span className="hint">
            Buttons under the sentence for typing ä, ö, ü and ß. Turn on if your keyboard doesn’t have them (on a computer,
            for example). Set separately on each device.
          </span>
        </div>
        <div className="field">
          <label htmlFor="strict-umlauts">Require ä, ö, ü and ß</label>
          <Toggle id="strict-umlauts" checked={settings.strictUmlauts} onChange={(v) => updateSettings({ strictUmlauts: v })} />
          <span className="hint">When off, ae, oe, ue and ss also count (“fuer” for “für”).</span>
        </div>
        <div className="field">
          <label htmlFor="second-try">Second try for small typos</label>
          <Toggle id="second-try" checked={settings.secondTry} onChange={(v) => updateSettings({ secondTry: v })} />
          <span className="hint">
            If your answer is one letter off or misses umlaut dots, you can fix it once. A fixed answer counts as right,
            for half the points.
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
        <div className="field stacked">
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
            downloaded once, stored on this device, and works offline.{' '}
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

      <SyncSection joinCode={joinCode} />

      <OfflineSection />

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
          {syncing
            ? 'Progress is stored in this browser and synced with your other devices. A backup file is an extra safety copy.'
            : 'Progress is stored only in this browser. Turn on sync above, or export a backup to move it to another device.'}
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

      <StartupTime />

      <p className="small muted center">
        <a href="#/credits">Credits &amp; licences</a>
      </p>
    </div>
  );
}
