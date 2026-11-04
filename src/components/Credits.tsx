import { useStore } from '../store';

export function Credits() {
  const { manifest } = useStore();
  return (
    <div className="stack" style={{ gap: 20 }}>
      <h1>Credits</h1>
      <section className="card stack" style={{ gap: 12 }}>
        <h2>Sentences</h2>
        <p style={{ margin: 0 }}>
          All {manifest?.total.toLocaleString()} sentences and their English translations come from{' '}
          <a href="https://tatoeba.org" target="_blank" rel="noreferrer">
            Tatoeba
          </a>
          , a collaborative collection of sentences, licensed{' '}
          <a href="https://creativecommons.org/licenses/by/2.0/fr/" target="_blank" rel="noreferrer">
            CC BY 2.0 FR
          </a>
          . Each card links to its original sentence.
        </p>
        <h2>Native-speaker recordings</h2>
        <p style={{ margin: 0 }}>
          {manifest?.audio.toLocaleString()} sentences have recordings by Tatoeba contributors, used under{' '}
          <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">
            CC BY 4.0
          </a>{' '}
          or{' '}
          <a href="https://creativecommons.org/licenses/by-nc/4.0/" target="_blank" rel="noreferrer">
            CC BY-NC 4.0
          </a>
          . The speaker and licence are shown after each answer. Copies of the recordings are stored with this app
          so they can be saved for offline use.
        </p>
        <h2>Word info</h2>
        <p style={{ margin: 0 }}>
          Base forms, genders, plurals, verb forms and meanings come from{' '}
          <a href="https://en.wiktionary.org" target="_blank" rel="noreferrer">
            Wiktionary
          </a>{' '}
          (via the{' '}
          <a href="https://kaikki.org" target="_blank" rel="noreferrer">
            Wiktextract
          </a>{' '}
          extract), licensed{' '}
          <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noreferrer">
            CC BY-SA 4.0
          </a>
          . The word files of this app are shared under the same licence.
        </p>
        <h2>Neural voice</h2>
        <p style={{ margin: 0 }}>
          Sentences without a recording are spoken on your device by{' '}
          <a href="https://github.com/rhasspy/piper" target="_blank" rel="noreferrer">
            Piper
          </a>{' '}
          (MIT) through ONNX Runtime Web (MIT) and piper-tts-web (MIT). German voice models (Thorsten, Kerstin, Ramona,
          Eva) are by their dataset authors; see each model card on{' '}
          <a href="https://huggingface.co/rhasspy/piper-voices/tree/main/de/de_DE" target="_blank" rel="noreferrer">
            Hugging Face
          </a>{' '}
          for its licence.
        </p>
        <h2>How the deck is built</h2>
        <p style={{ margin: 0 }}>
          Every German word form in Tatoeba is ranked by frequency, and each sentence teaches its rarest word. Each
          sentence also gets a difficulty score for the whole sentence: how rare the missing word and the other words
          are, how long it is, and its grammar (subordinate and relative clauses, Konjunktiv, passive, um … zu,
          genitive prepositions). Common words come in short, simple sentences; rarer words in longer, more complex
          ones. Sentences with native-speaker audio are preferred.
        </p>
      </section>
    </div>
  );
}
