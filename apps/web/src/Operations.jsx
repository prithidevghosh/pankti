import { billTotals } from '../../../shared/bill-totals.mjs';
import { reviewMenuImport } from '../../../shared/menu-import.mjs';
import { MenuPages, editableDish, menuEntry, needsPrice } from './MenuPages.jsx';
import React, { useEffect, useRef, useState } from 'react';
import { ImagePlus, Pencil } from 'lucide-react';
import { VendorEditor } from './VendorEditor.jsx';
import { TicketEditor } from './TicketEditor.jsx';
import { Voice } from './Voice.jsx';
import { SpecialPhrases } from './SpecialPhrases.jsx';
import { request, asRupees } from './api.js';

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


export function Orders({ menu, gstBps, onBill }) {
  const [basket, setBasket] = useState([]);
  const [speechBusy, setSpeechBusy] = useState(false);
  const [heard, setHeard] = useState('');
  const [question, setQuestion] = useState('');
  const key = useRef(crypto.randomUUID());
  const op = useOperation();
  const [orderNote, setOrderNote] = useState(null);
  const [editingDraft, setEditingDraft] = useState(false);
  const rows = basket.map((line) => ({ ...menu.find((item) => item.id === line.item), ...line }));
  const totals = billTotals(rows, gstBps);
  function update(lines) {
    key.current = crypto.randomUUID();
    setBasket(lines);
    if (!lines.length) setOrderNote(null);
  }
  const voiceProps = {
    task: 'order', disabled: op.busy || speechBusy || editingDraft,
    context: { basket, orderNote, clarificationReply: question ? { previous: heard, question } : undefined },
    onBusy: setSpeechBusy, onError: op.setMessage,
    onResult: ({ transcript, result }) => {
      if (result.payment) {
        setQuestion('');
        onBill(result.payment.bill, result.payment);
        return;
      }
      setHeard(transcript);
      setQuestion(result.question || '');
      update(result.lines);
      if (result.lines.length) setOrderNote(result.orderNote ?? null);
    },
  };
  return (
    <section className="work-sheet order-desk">
      <div className="record-side">
        <div className="action-print">
          <img src="/order-taker.webp" alt="" />
          <div>
            <h2>Take an order</h2>
            <p className="subtle">
              {menu.length
                ? 'Speak the order. Review the items before issuing the bill.'
                : 'Add your dishes and prices in Menu to start billing.'}
            </p>
            <Voice {...voiceProps} label="Speak order" />
          </div>
        </div>
        {heard && <blockquote>{heard}</blockquote>}
        {question && <p role="status">{question}</p>}
        <Feedback message={op.message} />
      </div>
      <section className="order-ticket">
        <h3>Current ticket</h3>
        {!rows.length && <p className="ticket-empty">Items appear here as you speak.</p>}
        {rows.length > 0 && !editingDraft && <div className="ticket-revisions">
          <Voice {...voiceProps} label="Revise by voice" />
          <button type="button" className="plain" disabled={op.busy || speechBusy}
            onClick={() => setEditingDraft(true)}><Pencil size={15} /> Edit ticket</button>
        </div>}
        {editingDraft && <TicketEditor basket={basket} menu={menu} orderNote={orderNote}
          onCancel={() => setEditingDraft(false)} onSave={(lines, note) => {
            update(lines);
            setOrderNote(lines.length ? note || null : null);
            setQuestion('');
            setEditingDraft(false);
          }} />}
        {rows.length > 0 && !editingDraft && (
          <>
            <ul className="work-lines">
              {rows.map((line) => (
                <li key={line.item}>
                  <span>
                    {line.quantity} × {line.name} {line.variant}
                    {line.note && <small className="kitchen-note">{line.note}</small>}
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
            {orderNote && <p className="kitchen-note"><strong>Kitchen note</strong> · {orderNote}</p>}
            {gstBps > 0 && <p>GST ({gstBps / 100}%) · {asRupees(totals.gstAmount)}</p>}
            <button
              className="action"
              disabled={op.busy || speechBusy || Boolean(question)}
              onClick={() =>
                op.run(async () => {
                  const prices = Object.fromEntries(rows.map((row) => [row.item, row.price]));
                  const { bill } = await request('/bills', {
                    body: { request: key.current, basket, prices, gstBps, orderNote },
                  });
                  update([]);
                  setHeard('');
                  setQuestion('');
                  onBill(bill);
                })
              }
            >
              Create bill · {asRupees(totals.total)}
            </button>
          </>
        )}
        {!editingDraft && (heard || basket.length > 0) && (
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
        <div className="action-print">
          <img src="/crate-delivery.webp" alt="" />
          <div>
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
          </div>
        </div>
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

export function Menu({ menu, onMenu }) {
  const [dictating, setDictating] = useState(false);
  const [menuQuestion, setMenuQuestion] = useState(null);
  const [draft, setDraft] = useState([]);
  const [active, setActive] = useState(null);
  const op = useOperation();
  const reviews = reviewMenuImport(menu, draft.map(menuEntry));
  const reviewed = draft.map((row, i) => ({ ...row, ...reviews[i] }));
  const remaining = reviewed.filter((row) => !row.duplicate);
  const missing = remaining.filter(needsPrice);
  const conflicts = remaining.filter((row) => row.conflict);
  const skipped = draft.length - remaining.length;
  return (
    <>
      <section className="menu-import action-print">
        <img src="/menu-lettering.webp" alt="" />
        <div>
          <div className="menu-import-intro">
          <h2>Add dishes</h2>
          <p>Photograph a menu page or speak the dishes and prices.</p>
          </div>
          <div className="menu-import-actions">
          <label className="file-field">
            <ImagePlus size={18} aria-hidden="true" /> Choose menu photos
            <input
              aria-label="Menu photos"
              type="file"
              accept="image/*"
              multiple
              disabled={op.busy || dictating || !!active}
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
                    setDraft((previous) => [...previous, ...entries.map(editableDish)]);
                  }
                  op.setMessage('');
                });
              }}
            />
          </label>
          <Voice
            task="menu"
            label="Dictate dishes"
            disabled={op.busy || dictating || !!active}
            onBusy={setDictating}
            onError={op.setMessage}
            context={{ clarificationReply: menuQuestion || undefined }}
            onResult={({ result, transcript }) => {
              setMenuQuestion(result.question ? { question: result.question, previous: transcript } : null);
              if (!result.question) setDraft((prev) => [...prev, ...result.entries.map(editableDish)]);
              op.setMessage(result.question || '');
            }}
          />
          </div>
        </div>
      </section>
      <Feedback message={op.message} />
      {draft.length > 0 && (
        <section className="menu-folio">
          <header className="folio-heading">
            <div>
              <h2>Review your dishes</h2>
              <p>
                {draft.length} {draft.length === 1 ? 'dish' : 'dishes'} to review
                {missing.length ? ' · ' + missing.length + ' missing a price' : ''}
              </p>
              {skipped > 0 && (
                <p role="status">
                  {skipped} {skipped === 1 ? 'duplicate will' : 'duplicates will'} be skipped.
                </p>
              )}
              {conflicts.length > 0 && (
                <p>
                  This name and portion already have a different price or category. Edit or omit the flagged
                  dish.
                </p>
              )}
            </div>
            <button
              className="publish-menu"
              disabled={op.busy || dictating || !!active}
              onClick={() => {
                if (!remaining.length) {
                  setDraft([]);
                  return;
                }
                if (missing.length || conflicts.length) {
                  setActive((missing[0] || conflicts[0]).key);
                  return;
                }
                op.run(async () => {
                  const result = await request('/menu/import', { body: remaining.map(menuEntry) });
                  onMenu(result.menu);
                  setDraft(
                    remaining
                      .filter((_, i) => result.review[i].conflict)
                      .map(({ conflict, duplicate, ...row }) => row),
                  );
                  const totalSkipped = skipped + result.review.filter((row) => row.duplicate).length;
                  op.setMessage(
                    result.added +
                      ' ' +
                      (result.added === 1 ? 'dish' : 'dishes') +
                      ' added.' +
                      (totalSkipped
                        ? ' ' +
                          totalSkipped +
                          ' ' +
                          (totalSkipped === 1 ? 'duplicate' : 'duplicates') +
                          ' skipped.'
                        : ''),
                  );
                });
              }}
            >
              {!remaining.length
                ? 'Finish review'
                : missing.length
                  ? 'Review missing prices'
                  : conflicts.length
                    ? 'Review conflict'
                    : 'Save to menu'}
            </button>
          </header>
          <MenuPages
            rows={reviewed}
            draft
            active={active}
            setActive={setActive}
            busy={op.busy}
            onSave={(row) => {
              setDraft((list) =>
                list.map((item) =>
                  item.key === row.key
                    ? {
                        ...item,
                        name: row.name,
                        variant: row.variant,
                        category: row.category,
                        rupees: row.rupees,
                      }
                    : item,
                ),
              );
              return true;
            }}
            onRemove={(key) => setDraft((list) => list.filter((item) => item.key !== key))}
          />
        </section>
      )}
      <SpecialPhrases menu={menu} />
      {(menu.length > 0 || !draft.length) && (
        <section className="menu-folio">
          <header className="folio-heading">
            <div>
              <h2>Your menu</h2>
              <p>
                {menu.length
                  ? menu.length + ' saved ' + (menu.length === 1 ? 'dish' : 'dishes')
                  : 'Your saved dishes will appear here after you review a menu photo.'}
              </p>
            </div>
          </header>
          <MenuPages
            rows={menu}
            active={active}
            setActive={setActive}
            busy={op.busy}
            onSave={async (row) => {
              let saved = false;
              await op.run(async () => {
                const result = await request('/menu/' + row.id, { method: 'PUT', body: menuEntry(row) });
                onMenu(result.menu);
                saved = true;
                op.setMessage('Changes saved.');
              });
              return saved;
            }}
          />
        </section>
      )}
    </>
  );
}

export function Bank({ restaurant, onSave }) {
  const [preview, setPreview] = useState(null);
  const op = useOperation();
  return (
    <section className="work-sheet bank-desk">
      <div>
        <img className="station-print" src="/payment-stand.webp" alt="" loading="lazy" />
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
