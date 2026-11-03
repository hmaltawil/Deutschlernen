import { piper } from '../lib/audio';
import { VOICES } from '../lib/settings';
import { useStore } from '../store';
import { IconDownload, IconMic } from './Icons';
import { useVoice } from './useVoice';

/** Invites the learner to download the on-device neural voice used for sentences without a recording. */
export function VoiceBanner({ compact = false }: { compact?: boolean }) {
  const { settings } = useStore();
  const v = useVoice();
  const voice = VOICES.find((x) => x.id === settings.voice) ?? VOICES[0];
  if (v.state === 'ready' || v.state === 'unknown') return null;

  const pct = Math.round(v.progress * 100);
  return (
    <div className="banner" role="status">
      <IconMic size={22} />
      <div className="grow stack" style={{ gap: 8 }}>
        {v.state === 'downloading' ? (
          <>
            <strong>Downloading natural voice… {pct}%</strong>
            <div className="meter thin" aria-hidden="true">
              <span style={{ width: `${pct}%` }} />
            </div>
            <span className="small muted">You can keep playing — recorded sentences work already.</span>
          </>
        ) : v.state === 'error' ? (
          <>
            <strong>The natural voice couldn't load</strong>
            <span className="small muted">
              {v.error ?? 'Unknown error.'} Sentences without a recording use your browser's voice for now.
            </span>
          </>
        ) : (
          <>
            <strong>Make every sentence sound natural</strong>
            {!compact && (
              <span className="small muted">
                About a third of sentences have a native-speaker recording. For the rest, download a neural German
                voice ({voice.label.split(' —')[0]}, {voice.mb} MB, once). It runs on your device and works offline.
              </span>
            )}
          </>
        )}
      </div>
      {(v.state === 'missing' || v.state === 'error') && (
        <button className="btn primary" onClick={() => piper.load(settings.voice).catch(() => {})}>
          <IconDownload size={18} /> {v.state === 'error' ? 'Retry' : 'Download'}
        </button>
      )}
    </div>
  );
}
