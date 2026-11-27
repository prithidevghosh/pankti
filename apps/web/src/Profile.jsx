import React, { useState } from 'react';
import { LockKeyhole, Pencil } from 'lucide-react';
import { request } from './api.js';
import './profile.css';

const fields = [
  ['name', 'Name', 'name'],
  ['businessName', 'Business name', 'organization'],
  ['city', 'City', 'address-level2'],
];
export function Profile({ profile, restaurant, onSaved }) {
  const saved = { name: profile.name || '', businessName: restaurant?.name || '', city: restaurant?.city || '', gstRate: (restaurant?.gstBps ?? 0) / 100 };
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setMessage('');
    try {
      const { gstRate, ...details } = draft;
      onSaved(await request('/profile', { method: 'PUT', body: { ...details, gstBps: Math.round(Number(gstRate) * 100) } }));
      setDraft(null);
      setMessage('Profile saved.');
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="profile-sheet">
      <img className="profile-print" src="/open-counter.webp" alt="An abstract shop doorway in indigo and powder blue." />
      <form className="profile-paper" onSubmit={submit}>
        <header><h2>Account details</h2>
          {!draft && <button type="button" className="profile-edit" onClick={() => { setDraft(saved); setMessage(''); }}>
            <Pencil size={15} aria-hidden="true" /> Edit details
          </button>}
        </header>
        <dl className="account-details">
          {fields.map(([key, label, autocomplete]) => (
            <div key={key}><dt>{draft ? <label htmlFor={'profile-'+key}>{label}</label> : label}</dt>
              <dd>{draft ? <input id={'profile-'+key} autoComplete={autocomplete} autoFocus={key === 'name'}
                required={key !== 'city'} maxLength={96} value={draft[key]} disabled={busy}
                onChange={e => setDraft({ ...draft, [key]: e.target.value })} /> : saved[key] || 'Not provided'}</dd>
            </div>
          ))}
          <div><dt><label htmlFor="profile-gst">GST per order (%)</label></dt>
            <dd>{draft ? <input id="profile-gst" type="number" inputMode="decimal" min="0" max="100"
              step="0.01" required disabled={busy} value={draft.gstRate}
              onChange={e => setDraft({ ...draft, gstRate: e.target.value })} /> : saved.gstRate + '%'}</dd>
          </div>
          <div><dt>Mobile number <LockKeyhole size={13} aria-label="Read only" /></dt><dd>{profile.phone || 'Not provided'}</dd></div>
        </dl>
        {draft && <footer>
          <button className="profile-save" disabled={busy || !draft.name.trim() || !draft.businessName.trim()}>{busy ? 'Saving…' : 'Save changes'}</button>
          <button type="button" disabled={busy} onClick={() => { setDraft(null); setMessage(''); }}>Cancel</button>
        </footer>}
        {message && <p role="status">{message}</p>}
      </form>
    </section>
  );
}
