import { useEffect, useState } from 'react';
import { piper } from '../lib/audio';
import type { VoiceStatus } from '../lib/audio/piper';

export function useVoice(): VoiceStatus {
  const [s, setS] = useState<VoiceStatus>(piper.status);
  useEffect(() => piper.subscribe(setS), []);
  return s;
}
