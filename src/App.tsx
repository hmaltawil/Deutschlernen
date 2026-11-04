import { Credits } from './components/Credits';
import { ListPage, type ListKind } from './components/Lists';
import { Home } from './components/Home';
import { IconChart, IconGear, IconHome, IconLayers } from './components/Icons';
import { LevelDetail, Levels } from './components/Levels';
import { Play } from './components/Play';
import { SettingsPage } from './components/Settings';
import { Stats } from './components/Stats';
import { Wordmark } from './components/Wordmark';
import type { RoundKind } from './lib/session';
import { useRoute } from './router';
import { useStore } from './store';
import { useOnline } from './components/useOffline';
import { useEffect } from 'react';
import { mark } from './lib/startup';

const NAV = [
  { to: '/', label: 'Home', icon: IconHome, match: (p: string) => p === '/' || p.startsWith('/list/') },
  { to: '/levels', label: 'Levels', icon: IconLayers, match: (p: string) => p.startsWith('/levels') },
  { to: '/stats', label: 'Stats', icon: IconChart, match: (p: string) => p === '/stats' },
  { to: '/settings', label: 'Settings', icon: IconGear, match: (p: string) => p === '/settings' || p === '/credits' || p === '/sync' },
];

export function App() {
  const { ready, error } = useStore();
  useEffect(() => {
    if (ready) requestAnimationFrame(() => mark('screen'));
  }, [ready]);
  const { path, params } = useRoute();
  const playing = path === '/play';
  const online = useOnline();

  let page: JSX.Element;
  if (error) page = <div className="card">Could not start: {error}</div>;
  else if (!ready) page = <div className="spinner" aria-label="Loading" />;
  else if (playing) {
    const kind = (['mixed', 'review', 'new', 'fav', 'missed'].includes(params.get('kind') ?? '') ? params.get('kind') : 'mixed') as RoundKind;
    const level = params.get('level') ? Number(params.get('level')) : undefined;
    page = <Play key={`${kind}-${level}`} kind={kind} level={level} />;
  } else if (path === '/levels') page = <Levels />;
  else if (path.startsWith('/levels/')) page = <LevelDetail n={Number(path.split('/')[2])} />;
  else if (path === '/stats') page = <Stats />;
  else if (path === '/settings') page = <SettingsPage />;
  else if (path === '/sync') page = <SettingsPage key={params.get('code') ?? ''} joinCode={params.get('code') ?? undefined} />;
  else if (path === '/credits') page = <Credits />;
  else if (path === '/list/fav' || path === '/list/missed') page = <ListPage key={path} kind={path.slice(6) as ListKind} />;
  else page = <Home />;

  return (
    <div className={`app ${playing ? 'playing' : ''}`}>
      <header className="topbar">
        <div className="topbar-inner">
          <Wordmark />
          {!online && (
            <span className="badge" title="No internet connection — everything you need is saved on this device">
              Offline
            </span>
          )}
          <nav className="nav" aria-label="Main">
            {NAV.map(({ to, label, icon: Icon, match }) => (
              <a key={to} href={`#${to}`} aria-current={match(path) ? 'page' : undefined}>
                <Icon size={20} />
                <span>{label}</span>
              </a>
            ))}
          </nav>
        </div>
      </header>
      <main className="main">{page}</main>
    </div>
  );
}
