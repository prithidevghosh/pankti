import React, { useEffect, useRef, useState } from 'react';
import { ImagePlus, Pencil } from 'lucide-react';
import { VendorEditor } from './VendorEditor.jsx';
import { SignupVoice } from './SignupVoice.jsx';
import { request, asRupees } from './api.js';

function Voice({ task, label, context, disabled, onResult, onBusy, onError }) {
  return (
    <SignupVoice
      label={label}
      processing="Reading your note…"
      disabled={disabled}
      onBusy={onBusy}
      onError={onError}
      onRecording={async (audio) => {
        const form = new FormData();
        form.append(
          'audio',
          audio,
          'note.' + (audio.type.includes('mp4') ? 'm4a' : audio.type.includes('ogg') ? 'ogg' : 'webm'),
        );
        form.append('context', JSON.stringify(context || {}));
        onResult(await request('/voice/' + task, { body: form }));
      }}
    />
  );
}
function Feedback({ message }) {
  return message ? (
    <p className="op-feedback" role="status">
      {message}
    </p>
  ) : null;
}
function useOperation() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const lock = useRef(false);
  async function run(operation) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setMessage('');
    try {
      await operation();
    } catch (error) {
      setMessage(error.message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return { busy, message, run, setMessage };
}

export function Orders({ menu, onBill }) {
  const [basket, setBasket] = useState([]);
  const [speechBusy, setSpeechBusy] = useState(false);
  const [heard, setHeard] = useState('');
  const [question, setQuestion] = useState('');
  const key = useRef(crypto.randomUUID());
  const op = useOperation();
  const rows = basket.map((line) => ({ ...menu.find((item) => item.id === line.item), ...line }));
  function update(lines) {
    key.current = crypto.randomUUID();
    setBasket(lines);
  }
  return (
    <section className="work-sheet order-desk">
      <div className="record-side">
        <img className="station-print" src="/order-rail.webp" alt="" loading="lazy" />
        <h2>Take an order</h2>
        <p className="subtle">
          {menu.length
            ? 'Speak the order. Review the items before issuing the bill.'
            : 'Add your dishes and prices in Menu to start billing.'}
        </p>
        <Voice
          task="order"
          label="Speak order"
          disabled={op.busy || !menu.length}
          context={{ basket, clarificationReply: question ? { previous: heard, question } : undefined }}
          onBusy={setSpeechBusy}
          onError={op.setMessage}
          onResult={({ transcript, result }) => {
            setHeard(transcript);
            setQuestion(result.question || '');
            update(result.lines);
          }}
        />
        {heard && <blockquote>{heard}</blockquote>}
        {question && <p role="status">{question}</p>}
        <Feedback message={op.message} />
      </div>
      <section className="order-ticket">
        <h3>Current ticket</h3>
        {!rows.length && <p className="ticket-empty">Items appear here as you speak.</p>}
        {rows.length > 0 && (
          <>
            <ul className="work-lines">
              {rows.map((line) => (
                <li key={line.item}>
                  <span>
                    {line.quantity} × {line.name} {line.variant}
                  </span>
                  <strong>{asRupees(Math.round(line.price * line.quantity))}</strong>
                  <button
                    type="button"
                    disabled={speechBusy || op.busy}
                    aria-label={'Remove ' + line.name}
                    onClick={() => update(basket.filter((x) => x.item !== line.item))}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
            <button
              className="action"
              disabled={op.busy || speechBusy || Boolean(question)}
              onClick={() =>
                op.run(async () => {
                  const prices = Object.fromEntries(rows.map((row) => [row.item, row.price]));
                  const { bill } = await request('/bills', {
                    body: { request: key.current, basket, prices },
                  });
                  update([]);
                  setHeard('');
                  setQuestion('');
                  onBill(bill);
                })
              }
            >
              Create bill · {asRupees(rows.reduce((sum, r) => sum + Math.round(r.quantity * r.price), 0))}
            </button>
          </>
        )}
        {(heard || basket.length > 0) && (
          <button
            className="plain"
            disabled={op.busy || speechBusy}
            onClick={() => {
              update([]);
              setQuestion('');
              setHeard('');
            }}
          >
            Clear draft
          </button>
        )}
      </section>
    </section>
  );
}

const kinds = {
  order: 'Order placed',
  purchase: 'Purchase on credit',
  payment: 'Payment made',
  balance: 'Outstanding balance',
};
export function Vendors({ revision }) {
  const [editing, setEditing] = useState(null);
  const journal = useRef(null);
  const entryList = useRef(null);
  const opener = useRef(null);
  const [closing, setClosing] = useState(false);
  const closeTimer = useRef(null);
  useEffect(() => () => clearTimeout(closeTimer.current), []);
  function closeEditor() {
    setClosing(true);
    const duration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 200;
    closeTimer.current = setTimeout(() => {
      setEditing(null);
      setClosing(false);
      requestAnimationFrame(() => opener.current?.focus({ preventScroll: true }));
    }, duration);
  }
  useEffect(() => {
    if (!editing || !journal.current) return;
    const list = entryList.current;
    const row = list.querySelector('[data-entry="' + editing + '"]');
    if (row) list.scrollTop += row.getBoundingClientRect().top - list.getBoundingClientRect().top;
    const bounds = journal.current.getBoundingClientRect();
    const stacked = window.matchMedia('(max-width: 1100px)').matches;
    if (bounds.top < 0 || bounds.top > (stacked ? 20 : window.innerHeight * 0.52)) {
      journal.current.scrollIntoView({
        block: 'start',
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
      });
    }
  }, [editing]);
  const [voiceEdit, setVoiceEdit] = useState(null);
  const [ledger, setLedger] = useState({ balances: [], events: [] });
  const [draft, setDraft] = useState([]);
  const [speechBusy, setSpeechBusy] = useState(false);
  const [heard, setHeard] = useState('');
  const [question, setQuestion] = useState('');
  const op = useOperation();
  const key = useRef(crypto.randomUUID());
  useEffect(() => {
    const controller = new AbortController();
    request('/vendors', { signal: controller.signal })
      .then(setLedger)
      .catch((e) => {
        if (!controller.signal.aborted) op.setMessage(e.message);
      });
    return () => controller.abort();
  }, [revision]);
  return (
    <>
      <section className="work-sheet vendor-write">
        <h2>Record a vendor entry</h2>
        <p className="subtle">Say who supplied the goods, what you bought and how much you paid.</p>
        <Voice
          task="vendor"
          context={{ clarificationReply: question ? { previous: heard, question } : undefined }}
          label="Speak vendor entry"
          disabled={op.busy || !!editing}
          onBusy={setSpeechBusy}
          onError={op.setMessage}
          onResult={({ result, transcript }) => {
            key.current = crypto.randomUUID();
            setHeard(transcript);
            if (result.edit) {
              setDraft([]);
              setQuestion('');
              if (result.edit.revision !== ledger.revision) {
                op.setMessage('Refresh the ledger before making this correction.');
                return;
              }
              opener.current = document.activeElement;
              setVoiceEdit(result.edit);
              setEditing(result.edit.id);
              op.setMessage('Review the selected entry correction.');
              return;
            }
            setQuestion(result.question || '');
            setDraft(result.question ? [] : result.entries);
            op.setMessage(result.question || (result.entries.length ? '' : 'No transaction to record.'));
          }}
        />
        {heard && <blockquote>{heard}</blockquote>}
        {draft.length > 0 && (
          <>
            <ul className="work-lines">
              {draft.map((e, i) => (
                <li key={i}>
                  <span>
                    {e.vendor} · {kinds[e.kind]}
                    <small>{e.note}</small>
                  </span>
                  <strong>{asRupees(e.amount)}</strong>
                </li>
              ))}
            </ul>
            <button
              className="action"
              disabled={op.busy || speechBusy}
              onClick={() =>
                op.run(async () => {
                  setLedger(await request('/vendors', { body: { request: key.current, entries: draft } }));
                  setDraft([]);
                  setHeard('');
                  op.setMessage('Recorded in the vendor ledger.');
                })
              }
            >
              Confirm entries
            </button>{' '}
            <button
              className="plain"
              disabled={op.busy || speechBusy}
              onClick={() => {
                setDraft([]);
                setHeard('');
              }}
            >
              Discard
            </button>
          </>
        )}
        <Feedback message={op.message} />
      </section>
      <section className="work-sheet vendor-book">
        <div className="balance-cover">
          <div>
            <h2>Vendor balances</h2>
            <p>Outstanding dues</p>
            <strong>{asRupees(ledger.balances.reduce((sum, v) => sum + Math.max(0, v.due), 0))}</strong>
          </div>
          <img src="/market-balance.webp" alt="" loading="lazy" />
        </div>
        {!ledger.balances.length && (
          <p className="subtle">Your first confirmed entry opens a vendor account.</p>
        )}
        <ul className="work-lines">
          {ledger.balances.map((v) => (
            <li key={v.vendor}>
              <span>{v.vendor}</span>
              <strong>
                {asRupees(Math.abs(v.due))} {v.due < 0 ? 'advance' : 'due'}
              </strong>
            </li>
          ))}
        </ul>
      </section>
      {ledger.events.length > 0 && (
        <section className="work-sheet vendor-journal" ref={journal}>
          <h2>Recent entries</h2>
          <div className="journal-layout" data-open={Boolean(editing && !closing)}>
            <ul ref={entryList} className="journal-list" aria-label="Recent vendor entries">
              {ledger.events.map((e) => (
                <li key={e.id} data-entry={e.id} data-selected={editing === e.id}>
                  <div className="journal-item">
                    <strong>{e.vendor}</strong>
                    <small>
                      {kinds[e.kind]} · {new Date(e.created).toLocaleDateString('en-IN')}
                    </small>
                    {e.note && <p>{e.note}</p>}
                  </div>
                  <div className="journal-value">
                    <strong>{e.kind === 'order' && !e.amount ? 'Price pending' : asRupees(e.amount)}</strong>
                    {['payment', 'purchase'].includes(e.kind) && (
                      <small>{e.paid === 0 ? 'Unpaid' : e.paid >= e.amount ? 'Paid' : 'Part paid'}</small>
                    )}
                  </div>
                  <button
                    className="journal-edit"
                    disabled={!!editing || op.busy || speechBusy}
                    aria-label={(e.linkedPurchase ? 'Edit linked purchase' : 'Edit') + ' · ' + e.vendor}
                    aria-controls="correction-sheet"
                    onClick={(ev) => {
                      opener.current = ev.currentTarget;
                      setVoiceEdit(null);
                      setEditing(e.linkedPurchase || e.id);
                    }}
                  >
                    <Pencil size={15} aria-hidden="true" />
                    <span>Edit</span>
                  </button>
                </li>
              ))}
            </ul>
            <div className="editor-slot" id="correction-sheet" inert={closing || !editing ? true : undefined}>
              {editing && ledger.events.some((e) => e.id === editing) && (
                <VendorEditor
                  key={editing}
                  suggested={voiceEdit?.id === editing ? voiceEdit.details : null}
                  event={ledger.events.find((e) => e.id === editing)}
                  ledger={ledger}
                  onCancel={closeEditor}
                  onSave={(next) => {
                    setLedger(next);
                    closeEditor();
                    op.setMessage('Correction saved.');
                  }}
                />
              )}
            </div>
          </div>
        </section>
      )}
    </>
  );
}

function MenuRow({ row, change, remove }) {
  return (
    <fieldset className="menu-row">
      {[
        ['name', 'Dish'],
        ['variant', 'Portion'],
        ['category', 'Category'],
        ['rupees', 'Price (₹)'],
      ].map(([key, label]) => (
        <label key={key}>
          {label}
          <input
            required={key !== 'variant'}
            value={row[key]}
            type={key === 'rupees' ? 'number' : 'text'}
            min={key === 'rupees' ? '0.01' : undefined}
            step={key === 'rupees' ? '.01' : undefined}
            onChange={(e) => change({ ...row, [key]: e.target.value })}
          />
        </label>
      ))}
      {remove && (
        <button type="button" onClick={remove}>
          Omit
        </button>
      )}
    </fieldset>
  );
}
const editable = (item) => ({
  ...item,
  key: crypto.randomUUID(),
  rupees: item.price == null ? '' : String(item.price / 100),
});
const entry = ({ name, variant, category, rupees }) => ({
  name,
  variant,
  category,
  price: Math.round(Number(rupees) * 100),
});
export function Menu({ menu, onMenu }) {
  const [draft, setDraft] = useState([]);
  const [edit, setEdit] = useState(null);
  const op = useOperation();
  return (
    <>
      <section className="work-sheet menu-scan">
        <img className="menu-cover" src="/folded-menu.webp" alt="" loading="lazy" />
        <h2>Read a printed menu</h2>
        <p className="subtle">
          Choose a photo for each page. Check the dishes, portions and prices before adding them.
        </p>
        <label className="file-field">
          <ImagePlus size={18} aria-hidden="true" /> Choose menu photos
          <input
            aria-label="Menu photos"
            type="file"
            accept="image/*"
            multiple
            disabled={op.busy || !!edit}
            onChange={(e) => {
              const files = [...e.target.files];
              e.target.value = '';
              if (!files.length) return;
              op.run(async () => {
                for (const [index, file] of files.entries()) {
                  op.setMessage('Reading page ' + (index + 1) + ' of ' + files.length + '…');
                  const form = new FormData();
                  form.append('photo', file);
                  const { entries } = await request('/menu/scan', { body: form });
                  if (!entries.length)
                    throw Error('No dishes found on ' + file.name + '. Try a closer photo.');
                  setDraft((previous) => [...previous, ...entries.map(editable)]);
                }
                op.setMessage('Review the extracted rows below.');
              });
            }}
          />
        </label>
        {draft.length > 0 && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              op.run(async () => {
                const entries = draft.map(entry);
                const prices = new Map();
                for (const item of entries) {
                  const key = JSON.stringify(
                    [item.name, item.variant].map((s) =>
                      s.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' '),
                    ),
                  );
                  if (prices.has(key) && prices.get(key) !== item.price)
                    throw Error(
                      item.name + ' has two different prices. Check its portion or omit the duplicate.',
                    );
                  prices.set(key, item.price);
                }
                const { menu: saved } = await request('/menu', { body: entries });
                onMenu(saved);
                setDraft([]);
                op.setMessage('Menu saved.');
              });
            }}
          >
            <fieldset disabled={op.busy}>
              {draft.map((row) => (
                <MenuRow
                  key={row.key}
                  row={row}
                  change={(next) => setDraft((list) => list.map((r) => (r.key === next.key ? next : r)))}
                  remove={() => setDraft((list) => list.filter((r) => r.key !== row.key))}
                />
              ))}
              <button className="action">Save {draft.length} menu items</button>
            </fieldset>
          </form>
        )}
        <Feedback message={op.message} />
      </section>
      <section className="work-sheet price-list">
        <div className="menu-title">
          <h2>Your menu</h2>
          <span>
            {menu.length} {menu.length === 1 ? 'item' : 'items'}
          </span>
        </div>
        {!menu.length && <p className="subtle">Upload a menu photo to add your first dishes.</p>}
        <ul className="work-lines">
          {menu.map((item) => (
            <li key={item.id}>
              {edit?.id === item.id ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    op.run(async () => {
                      const saved = await request('/menu/' + item.id, { method: 'PUT', body: entry(edit) });
                      onMenu(saved.menu);
                      setEdit(null);
                      op.setMessage('Changes saved.');
                    });
                  }}
                >
                  <fieldset disabled={op.busy}>
                    <MenuRow row={edit} change={setEdit} />
                    <button className="action">Save changes</button>{' '}
                    <button type="button" onClick={() => setEdit(null)}>
                      Cancel
                    </button>
                  </fieldset>
                </form>
              ) : (
                <>
                  <span>
                    {item.name} {item.variant}
                    <small>{item.category}</small>
                  </span>
                  <strong>{asRupees(item.price)}</strong>
                  <button disabled={op.busy || !!edit} onClick={() => setEdit(editable(item))}>
                    Edit
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

export function Bank({ restaurant, onSave }) {
  const [preview, setPreview] = useState(null);
  const op = useOperation();
  return (
    <section className="work-sheet bank-desk">
      <div>
        <img className="station-print" src="/settlement-stamp.webp" alt="" loading="lazy" />
        <h2>Store payment QR</h2>
        <p className="subtle">
          Upload the QR card from your counter. Check the recipient before adding it to bills.
        </p>
        <label className="file-field">
          <ImagePlus size={18} aria-hidden="true" /> Choose QR photo
          <input
            aria-label="QR photo"
            type="file"
            accept="image/*"
            disabled={op.busy}
            onChange={(e) => {
              const file = e.target.files[0];
              e.target.value = '';
              if (!file) return;
              setPreview(null);
              op.run(async () => {
                const form = new FormData();
                form.append('photo', file);
                setPreview(await request('/qr/preview', { body: form }));
              });
            }}
          />
        </label>
        <Feedback message={op.message} />
      </div>
      <div className="placard-mount">
        {preview || restaurant.qr ? (
          <figure className="qr-print">
            <div className="placard-name">{restaurant.name}</div>
            <img src={preview?.image || restaurant.qr} alt="Store UPI payment QR" />
            <figcaption>
              {preview?.payee || restaurant.payee || 'Store UPI QR'}
              <small>{preview?.address}</small>
            </figcaption>
          </figure>
        ) : (
          <p className="placard-empty">Your store’s payment code will appear here after upload.</p>
        )}
        {preview && (
          <button
            className="action"
            disabled={op.busy}
            onClick={() =>
              op.run(async () => {
                const data = await request('/qr', { method: 'PUT', body: { uri: preview.uri } });
                onSave(data.restaurant);
                setPreview(null);
                op.setMessage('Payment QR saved.');
              })
            }
          >
            Use this QR on bills
          </button>
        )}
      </div>
    </section>
  );
}
