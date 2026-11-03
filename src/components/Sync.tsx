import { useEffect, useMemo, useState } from 'react';
import qrcode from 'qrcode-generator';
import { normalizeCode } from '../lib/sync/code';
import { startSync, stopSync, subscribeSync, syncNow, type SyncStatus } from '../lib/sync/engine';
import { go } from '../router';
import { useOnline } from './useOffline';

export function useSync(): SyncStatus {
  const [s, setS] = useState<SyncStatus | null>(null);
  useEffect(() => subscribeSync(setS), []);
  return s ?? { state: 'off' };
}

function joinLink(code: string) {
  return `${location.origin}${import.meta.env.BASE_URL}#/sync?code=${code}`;
}

function ago(ts?: number): string {
  if (!ts) return 'not yet';
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(ts).toLocaleDateString();
}

function Qr({ text }: { text: string }) {
  const svg = useMemo(() => {
    const q = qrcode(0, 'M');
    q.addData(text);
    q.make();
    return q.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  }, [text]);
  // generated locally from our own link; always dark-on-white so cameras can read it
  return <div className="qr" aria-label="QR code with the sync link" dangerouslySetInnerHTML={{ __html: svg }} />;
}

export function SyncSection({ joinCode }: { joinCode?: string }) {
  const s = useSync();
  const online = useOnline();
  const [input, setInput] = useState(joinCode ?? '');
  const [joining, setJoining] = useState(!!joinCode);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [show, setShow] = useState(false);
  const [copied, setCopied] = useState('');
  const [, tick] = useState(0);
  useEffect(() => {
    if (joinCode) document.getElementById('sync')?.scrollIntoView({ block: 'start' });
  }, [joinCode]);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  if (s.state === 'unavailable') return null;

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setErr('');
    try {
      await fn();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(''), 2000);
    } catch {
      setShow(true);
    }
  };

  const connect = () =>
    run(async () => {
      if (!normalizeCode(input)) throw new Error('That code is not valid. It has 24 letters and numbers (dashes optional).');
      await startSync(input);
      setJoining(false);
      setShow(false);
      if (joinCode) go('/settings');
    });

  const on = s.state !== 'off';
  const statusText =
    s.state === 'syncing'
      ? 'Syncing…'
      : s.state === 'offline' || !online
        ? 'Offline — will sync when you’re back online'
        : s.state === 'error'
          ? `Sync problem: ${s.error ?? 'unknown error'}`
          : `Synced ${ago(s.lastSync)}`;

  return (
    <section className="card" id="sync">
      <h2>Sync between devices</h2>
      {!on ? (
        <>
          <p className="small muted" style={{ margin: '6px 0 0' }}>
            Keep your progress, points and streak the same on your phone and computer. No account needed: one device
            gets a secret sync code, and you enter it on the others.
          </p>
          {!joining ? (
            <div className="row" style={{ marginTop: 14 }}>
              <button className="btn primary" disabled={busy || !online} onClick={() => run(() => startSync())}>
                {busy ? 'Turning on…' : 'Turn on sync'}
              </button>
              <button className="btn" disabled={busy} onClick={() => setJoining(true)}>
                I have a sync code
              </button>
            </div>
          ) : (
            <form
              className="stack"
              style={{ marginTop: 14, gap: 10 }}
              onSubmit={(e) => {
                e.preventDefault();
                connect();
              }}
            >
              <label htmlFor="sync-code" className="small">
                {joinCode ? 'Connect this device with this sync code?' : 'Enter the sync code shown on your other device'}
              </label>
              <input
                id="sync-code"
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', letterSpacing: '0.05em' }}
              />
              <span className="tiny muted">Progress on this device is combined with the synced progress — nothing is lost.</span>
              <div className="row">
                <button type="submit" className="btn primary" disabled={busy || !online || !input.trim()}>
                  {busy ? 'Connecting…' : 'Connect'}
                </button>
                <button type="button" className="btn ghost" onClick={() => (setJoining(false), joinCode && go('/settings'))}>
                  Cancel
                </button>
              </div>
            </form>
          )}
          {!online && <p className="small muted">Connect to the internet to turn on sync.</p>}
        </>
      ) : (
        <>
          <div className="field">
            <label>Status</label>
            <span className="small" style={{ fontWeight: 600 }} role="status">
              {s.state === 'idle' && '✓ '}
              {statusText}
            </span>
          </div>
          <div className="field">
            <label>Your sync code</label>
            <button className="btn ghost" style={{ minHeight: 0, padding: '4px 8px' }} onClick={() => setShow((v) => !v)}>
              {show ? 'Hide' : 'Show'}
            </button>
            <span className="hint">
              Enter it on your other devices (Settings → Sync → I have a sync code), or scan the QR code with a phone
              camera. Keep it private: anyone with the code can see and change your progress.
            </span>
            {show && s.code && (
              <div className="sync-code-box" style={{ gridColumn: '1 / -1' }}>
                <code className="sync-code" data-testid="sync-code" aria-label={`Sync code ${s.code}`}>
                  {s.code.split('-').map((g, i) => (
                    <span key={i}>
                      {i > 0 && '-'}
                      <span className="group">{g}</span>
                    </span>
                  ))}
                </code>
                <Qr text={joinLink(s.code)} />
                <div className="row">
                  <button className="btn" onClick={() => copy(s.code!, 'code')}>
                    {copied === 'code' ? 'Copied ✓' : 'Copy code'}
                  </button>
                  <button className="btn" onClick={() => copy(joinLink(s.code!), 'link')}>
                    {copied === 'link' ? 'Copied ✓' : 'Copy link'}
                  </button>
                </div>
                <span className="tiny muted">
                  On iPhone, if you use Lücke from the Home Screen, type the code there — a scanned link opens Safari,
                  which keeps separate data.
                </span>
              </div>
            )}
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn" disabled={s.state === 'syncing' || !online} onClick={() => syncNow()}>
              Sync now
            </button>
            <button
              className="btn ghost danger"
              onClick={() =>
                confirm('Stop syncing on this device? Progress stays on this device and on your other devices.') &&
                run(() => stopSync())
              }
            >
              Turn off sync on this device
            </button>
          </div>
        </>
      )}
      {err && (
        <p className="small" role="alert" style={{ color: 'var(--bad)', marginBottom: 0 }}>
          {err}
        </p>
      )}
    </section>
  );
}
