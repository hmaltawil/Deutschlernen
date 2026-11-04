import { useEffect, useState } from 'react';
import type { Item } from '../lib/deck';
import { loadWords, wiktionaryUrl, wordLines, type WordInfo } from '../lib/words';

/** After an answer: the missing word's base form, der/die/das + plural or verb forms, and meaning. */
export function WordBox({ item }: { item: Item }) {
  const [w, setW] = useState<WordInfo | null>(null);
  useEffect(() => {
    let on = true;
    loadWords(item.lv)
      .then((all) => on && setW(all[String(item.id)] ?? null))
      .catch(() => on && setW(null));
    return () => {
      on = false;
    };
  }, [item]);
  if (!w) return null;
  const x = wordLines(w, item.a);
  return (
    <div className="word-box" data-testid="word-info">
      <div className="word-top">
        <strong className="word-head" lang="de">
          {x.head}
        </strong>
        <span className="word-pos">{x.pos}</span>
      </div>
      {x.meaning && <div className="word-meaning">{x.meaning}</div>}
      {x.parts && (
        <div className="small" lang="de">
          {x.parts}
        </div>
      )}
      {x.form && (
        <div className="small muted" lang="de">
          {x.form}
        </div>
      )}
      <a className="tiny word-link" href={wiktionaryUrl(w)} target="_blank" rel="noreferrer">
        More on Wiktionary
      </a>
    </div>
  );
}
