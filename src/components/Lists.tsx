import { useEffect, useMemo, useState } from 'react';
import { getItems, type Item } from '../lib/deck';
import { favoriteRefs, oftenMissed } from '../lib/lists';
import { useStore } from '../store';
import { IconArrowLeft, IconPlay, IconStar, IconX } from './Icons';
import { SentenceRow } from './SentenceRow';

export type ListKind = 'fav' | 'missed';

const TITLE: Record<ListKind, string> = { fav: 'Favourites', missed: 'Often missed' };
const ABOUT: Record<ListKind, string> = {
  fav: 'Sentences you starred. Tap the star on a card, or on a sentence in a level, to add or remove one.',
  missed: 'Sentences you got wrong at least twice. They leave the list once you reach 75% on them.',
};

/** "Your lists" on Home: favourites and often missed, each with Play. */
export function ListsCard() {
  const { favoriteIds, missedCount } = useStore();
  const rows: [ListKind, number][] = [
    ['fav', favoriteIds.size],
    ['missed', missedCount],
  ];
  return (
    <section className="card" data-testid="your-lists" style={{ paddingTop: 12, paddingBottom: 12 }}>
      {rows.map(([kind, n]) => (
        <div key={kind} className="list-row" data-list={kind}>
          <span className={`list-icon ${kind}`} aria-hidden="true">
            {kind === 'fav' ? <IconStar size={18} filled /> : <IconX size={18} />}
          </span>
          <a href={`#/list/${kind}`} style={{ color: 'inherit', textDecoration: 'none' }}>
            <strong>{TITLE[kind]}</strong>
            <span className="small muted" style={{ display: 'block' }}>
              {n.toLocaleString()} sentence{n === 1 ? '' : 's'}
            </span>
          </a>
          <a
            className="btn"
            href={n ? `#/play?kind=${kind}` : undefined}
            aria-disabled={n === 0}
            onClick={(e) => n === 0 && e.preventDefault()}
            aria-label={`Play ${TITLE[kind]}`}
          >
            <IconPlay size={14} /> Play
          </a>
        </div>
      ))}
    </section>
  );
}

/** A practice list: all its sentences, with Play. */
export function ListPage({ kind }: { kind: ListKind }) {
  const { progress, favorites } = useStore();
  const refs = useMemo(
    () => (kind === 'fav' ? favoriteRefs(favorites, progress) : oftenMissed(progress.values())),
    [kind, favorites, progress],
  );
  const [items, setItems] = useState<Item[] | null>(null);
  const [limit, setLimit] = useState(60);
  useEffect(() => {
    let on = true;
    getItems(refs.slice(0, limit))
      .then((x) => on && setItems(x))
      .catch(() => on && setItems([]));
    return () => {
      on = false;
    };
  }, [refs, limit]);
  return (
    <div className="stack" style={{ gap: 16 }}>
      <a href="#/" className="btn ghost" style={{ alignSelf: 'flex-start', paddingLeft: 4 }}>
        <IconArrowLeft size={18} /> Home
      </a>
      <div className="spread">
        <div>
          <h1>{TITLE[kind]}</h1>
          <div className="small muted">{refs.length.toLocaleString()} sentences</div>
        </div>
        {refs.length > 0 && (
          <a className="btn primary" href={`#/play?kind=${kind}`}>
            <IconPlay size={16} /> Play
          </a>
        )}
      </div>
      <p className="small muted" style={{ margin: 0 }}>
        {ABOUT[kind]}
      </p>
      <section className="card" style={{ padding: '4px 16px' }}>
        {!items ? (
          <div className="spinner" />
        ) : items.length === 0 ? (
          <p className="muted">Nothing here yet.</p>
        ) : (
          items.map((it) => <SentenceRow key={it.id} item={it} />)
        )}
      </section>
      {refs.length > limit && (
        <button className="btn" onClick={() => setLimit((l) => l + 100)}>
          Show more ({refs.length - limit} left)
        </button>
      )}
    </div>
  );
}
