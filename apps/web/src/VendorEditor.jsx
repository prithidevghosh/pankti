import React, { useState, useRef, useEffect } from 'react';
import { request, asRupees } from './api.js';
import { SignupVoice } from './SignupVoice.jsx';

export function VendorEditor({ event, ledger, onSave, onCancel, suggested }) {
  const initial = suggested || event;
  const editor = useRef(null);
  useEffect(() => {
    editor.current?.scrollIntoView({ block: 'center' });
  }, []);
  const [version] = useState(ledger.revision);
  const [vendor, setVendor] = useState(initial.vendor);
  const [note, setNote] = useState(initial.note);
  const [amount, setAmount] = useState(String(initial.amount / 100));
  const hasPayment = Number(amount || 0) > 0;
  const [paid, setPaid] = useState(String(initial.paid / 100));
  const [status, setStatus] = useState(paymentState(initial.amount, initial.paid));
  const [preview, setPreview] = useState(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  function paymentState(total, settled) {
    return settled === 0 ? 'Unpaid' : settled === total ? 'Paid' : 'Part paid';
  }
  const total = Math.round(Number(amount) * 100);
  const details = {
    vendor,
    note,
    amount: total,
    paid: hasPayment
      ? status === 'Paid'
        ? total
        : status === 'Unpaid'
          ? 0
          : Math.round(Number(paid) * 100)
      : 0,
  };
  const path = '/vendors/' + event.id;
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      const body = { revision: version, details };
      if (hasPayment && status === 'Part paid' && !(details.paid > 0 && details.paid < total))
        throw Error('Enter a partial payment between zero and the entry amount.');
      if (preview) onSave(await request(path, { method: 'PUT', body }));
      else setPreview(await request(path + '/preview', { body }));
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }
  async function correct(audio) {
    const form = new FormData();
    form.append('audio', audio, audio.type.includes('mp4') ? 'edit.m4a' : 'edit.webm');
    form.append('context', JSON.stringify({ id: event.id, draft: details }));
    const { result } = await request('/voice/vendorEdit', { body: form });
    if (result.question) {
      setMessage(result.question);
      return;
    }
    setVendor(result.vendor);
    setNote(result.note);
    setAmount(String(result.amount / 100));
    setPaid(String(result.paid / 100));
    setStatus(paymentState(result.amount, result.paid));
    setPreview(null);
    setMessage('Review the correction before saving.');
  }
  const changedBalances =
    preview?.balances.filter((v) => ledger.balances.find((old) => old.vendor === v.vendor)?.due !== v.due) ||
    [];
  const removed = preview
    ? ledger.balances.filter((v) => !preview.balances.some((next) => next.vendor === v.vendor))
    : [];
  return (
    <form ref={editor} className="vendor-editor" onSubmit={submit}>
      <h3>Edit vendor entry</h3>
      <SignupVoice
        label="Speak correction"
        processing="Reading correction…"
        disabled={busy}
        onBusy={setRecording}
        onRecording={correct}
        onError={setMessage}
      />
      <fieldset disabled={recording || busy} onChange={() => setPreview(null)}>
        <label>
          Vendor name
          <input required maxLength={96} value={vendor} onChange={(e) => setVendor(e.target.value)} />
        </label>
        <label>
          Amount (₹)
          <input
            required
            type="number"
            min={['order', 'balance'].includes(event.kind) ? 0 : 0.01}
            step=".01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>
        {hasPayment && (
          <label>
            Payment status
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              {['Unpaid', 'Part paid', 'Paid'].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
        )}
        {hasPayment && status === 'Part paid' && (
          <label>
            Paid amount (₹)
            <input
              required
              type="number"
              min=".01"
              step=".01"
              value={paid}
              onChange={(e) => setPaid(e.target.value)}
            />
          </label>
        )}
        <label>
          Entry note
          <input maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
      </fieldset>
      {preview && (
        <div role="status">
          <strong>Balance after correction</strong>
          {changedBalances.map((v) => (
            <p key={v.vendor}>
              {v.vendor} · {asRupees(Math.abs(v.due))} {v.due < 0 ? 'advance' : 'due'}
            </p>
          ))}
          {removed.map((v) => (
            <p key={v.vendor}>
              {v.vendor} · {asRupees(0)} due
            </p>
          ))}
          {!removed.length && !changedBalances.length && <p>The outstanding balance stays the same.</p>}
        </div>
      )}
      {message && <p role="status">{message}</p>}
      <button className="action" disabled={recording || busy}>
        {preview ? 'Save correction' : 'Preview correction'}
      </button>
      <button type="button" disabled={recording || busy} onClick={onCancel}>
        Cancel
      </button>
    </form>
  );
}
