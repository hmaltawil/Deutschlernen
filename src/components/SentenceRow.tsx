import type { Item } from '../lib/deck';
import { mastery, shownStage } from '../lib/srs';
import { useStore } from '../store';
import { IconStar } from './Icons';

const STAGE_COLOR = ['var(--m0)', 'var(--m1)', 'var(--m2)', 'var(--m3)', 'var(--m4)'];

/** One sentence in a list: mastery dot, sentence with the word in bold, translation, star. */
export function SentenceRow({ item }: { item: Item }) {
  const { progress, setKnown, favoriteIds, toggleFavorite } = useStore();
  const p = progress.get(item.id);
  const fav = favoriteIds.has(item.id);
  return (
    <div className="sent-row" data-id={item.id}>
      <span
        className="dot"
        style={{ background: p ? STAGE_COLOR[shownStage(p)] : 'transparent', border: p ? 0 : '1.5px solid var(--line)' }}
        title={p ? (p.known ? 'Known' : `${mastery(p.stage)}% mastered`) : 'Not played yet'}
      />
      <div>
        <div className="de" lang="de">
          {item.de.slice(0, item.c[0])}
          <b>{item.a}</b>
          {item.de.slice(item.c[1])}
        </div>
        <div className="small muted">
          {item.en}
          {item.au ? ' · native audio' : ''}
          {p && p.wrong > 0 ? ` · wrong ${p.wrong}×` : ''}
        </div>
        {p?.known && (
          <div className="row" style={{ gap: 8, marginTop: 4 }}>
            <span className="badge">known · not reviewed</span>
            <button className="btn ghost" style={{ minHeight: 0, padding: '2px 8px' }} onClick={() => setKnown(item.id, false)}>
              Review again
            </button>
          </div>
        )}
      </div>
      <button
        type="button"
        className={`star-toggle${fav ? ' on' : ''}`}
        aria-pressed={fav}
        aria-label={fav ? 'Remove from favourites' : 'Add to favourites'}
        onClick={() => toggleFavorite(item.id, item.lv)}
      >
        <IconStar size={20} filled={fav} />
      </button>
    </div>
  );
}
