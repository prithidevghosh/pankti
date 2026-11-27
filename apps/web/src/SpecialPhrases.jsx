import React, { useEffect, useState } from 'react';
import { Voice } from './Voice.jsx';
import { request } from './api.js';
export function SpecialPhrases({ menu }) {
  const [phrases, setPhrases] = useState([]),
    [draft, setDraft] = useState(null),
    [message, setMessage] = useState('');
  const [question, setQuestion] = useState(null),
    [busy, setBusy] = useState(false),
    [recording, setRecording] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    request('/phrases', { signal: controller.signal })
      .then((r) => setPhrases(r.phrases))
      .catch((e) => {
        if (!controller.signal.aborted) setMessage(e.message);
      });
    return () => controller.abort();
  }, []);
  const describe = (lines) =>
    lines
      .map((line) => {
        const item = menu.find((i) => i.id === line.item);
        return (
          line.quantity +
          ' × ' +
          (item ? [item.name, item.variant].filter(Boolean).join(' ') : 'Unavailable dish') +
          (line.note ? ' (' + line.note + ')' : '')
        );
      })
      .join(' + ');
  async function save(remove = false) {
    setBusy(true);
    setMessage('');
    try {
      const url = '/phrases' + (draft.id ? '/' + draft.id : '');
      const result = await request(url, {
        method: remove ? 'DELETE' : draft.id ? 'PUT' : 'POST',
        body: remove ? undefined : { name: draft.name, lines: draft.lines },
      });
      setPhrases(result.phrases);
      setDraft(null);
      setQuestion(null);
      setMessage(remove ? 'Phrase forgotten.' : 'Phrase saved.');
    } catch (e) {
      setMessage(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="menu-folio phrase-book">
      <header className="folio-heading">
        <div>
          <h2>Special phrases</h2>
          <p>
            {menu.length
              ? 'Teach the counter what your shorthand means.'
              : 'Add dishes to your menu to teach a phrase.'}
          </p>
        </div>
        <Voice
          task="phrase"
          label={draft ? 'Revise phrase' : 'Teach a phrase'}
          disabled={!menu.length || busy}
          onBusy={setRecording}
          onError={setMessage}
          context={{
            previous: draft ? { name: draft.name, lines: draft.lines } : undefined,
            clarificationReply: question,
          }}
          onResult={({ result, transcript }) => {
            setDraft({ ...result, id: draft?.id });
            setQuestion(result.question ? { question: result.question, previous: transcript } : null);
            setMessage('');
          }}
        />
      </header>
      {phrases.map((p) => (
        <button
          className="phrase-line"
          key={p.id}
          disabled={!!draft || busy || recording}
          onClick={() => {
            setDraft(p);
            setQuestion(null);
            setMessage('');
          }}
        >
          <strong>{p.name}</strong>
          <span>{describe(p.lines)}</span>
        </button>
      ))}
      {draft && (
        <div className="phrase-review">
          <label>
            Phrase name
            <input
              value={draft.name || ''}
              maxLength={96}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </label>
          <p>{describe(draft.lines)}</p>
          {question && <p role="status">{question.question}</p>}
          <button
            disabled={busy || recording || !draft.name?.trim() || !draft.lines.length || !!question}
            onClick={() => save()}
          >
            Save phrase
          </button>
          <button
            disabled={busy || recording}
            onClick={() => {
              setDraft(null);
              setQuestion(null);
            }}
          >
            Cancel
          </button>
          {draft.id && (
            <button disabled={busy || recording} onClick={() => save(true)}>
              Forget phrase
            </button>
          )}
        </div>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
