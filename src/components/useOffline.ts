import { useEffect, useState } from 'react';
import { subscribeOffline, type OfflineStatus } from '../lib/offline';

export function useOffline(): OfflineStatus {
  const [s, setS] = useState<OfflineStatus | null>(null);
  useEffect(() => subscribeOffline(setS), []);
  return s ?? { app: 'saving', saved: 0, total: 0, bytes: 0, job: null };
}

export function useOnline(): boolean {
  const [on, setOn] = useState(() => navigator.onLine);
  useEffect(() => {
    const up = () => setOn(true);
    const down = () => setOn(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);
  return on;
}
