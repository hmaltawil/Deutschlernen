import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { StoreProvider } from './store';
import { initOffline, watchForUpdates } from './lib/offline';
import { afterFirstScreen, mark } from './lib/startup';
import { unlockAudio } from './lib/audio';
import { db } from './lib/db';
import './styles.css';

mark('script');
// test builds only (VITE_TEST_HOOKS=1): let browser tests simulate Safari dropping the database connection
if (import.meta.env.VITE_TEST_HOOKS) {
  (window as unknown as { __dropDb: () => Promise<void> }).__dropDb = async () => (await db()).close();
}
// unlock audio on the first tap/key so later automatic playback is allowed on iPhone
for (const ev of ['pointerdown', 'touchend', 'keydown'] as const) window.addEventListener(ev, unlockAudio, { capture: true, passive: true });
// service worker + offline checks are not needed to show the first screen
watchForUpdates();
afterFirstScreen(() => initOffline(), 1200);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <StoreProvider>
      <App />
    </StoreProvider>
  </StrictMode>,
);
