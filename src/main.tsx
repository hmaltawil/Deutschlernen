import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { StoreProvider } from './store';
import { initOffline } from './lib/offline';
import { afterFirstScreen, mark } from './lib/startup';
import './styles.css';

mark('script');
// service worker + offline checks are not needed to show the first screen
afterFirstScreen(() => initOffline(), 1200);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <StoreProvider>
      <App />
    </StoreProvider>
  </StrictMode>,
);
