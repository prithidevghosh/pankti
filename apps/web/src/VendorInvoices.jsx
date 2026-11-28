import React, { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, FilePlus2, ReceiptText } from 'lucide-react';
import { request, asRupees } from './api.js';
import { SignupVoice } from './SignupVoice.jsx';
import './vendor-invoices.css';

const qty = (value, unit) => value == null ? '—' : [value, unit].filter(Boolean).join(' ');
const measure = value => qty(value?.quantity, value?.unit);
const title = bill => [bill.vendor || 'Supplier invoice',bill.number].filter(Boolean).join(' · ');

function Finding({ row }) {
  if (row.status === 'match') return <span>Quantities match</span>;
  const messages = [];
  if (row.shortage) messages.push(qty(Math.abs(row.shortage),row.unit) + (row.shortage > 0 ? ' short of invoice' : ' more than billed'));
  if (row.orderDifference) messages.push('Billed ' + qty(Math.abs(row.orderDifference),row.unit) + (row.orderDifference > 0 ? ' above order' : ' below order'));
  if (row.shortage == null || row.orderDifference == null) messages.push('Check missing quantities or units');
  return <span>{messages.join(' · ')}{row.differencePaise ? <small>{asRupees(Math.abs(row.differencePaise))} at the printed unit rate</small> : null}</span>;
}
export function VendorInvoices({revision}) {
  const [invoices,setInvoices] = useState([]);
  const [id,setId] = useState('');
  const [busy,setBusy] = useState(false);
  const [message,setMessage] = useState('');
  const input = useRef(null);
  const bill = invoices.find(i=>i._id === id);
  useEffect(() => {
    const controller = new AbortController();
    request('/vendor-invoices',{signal:controller.signal}).then(({invoices})=>{
      if (!controller.signal.aborted) {
        setInvoices(current=>{
          const incoming=new Map(invoices.map(b=>[b._id,b]));
          return [...current.map(b=>{const newer=incoming.get(b._id);return newer && newer.revision>=b.revision?newer:b;}),
            ...invoices.filter(b=>!current.some(c=>c._id===b._id))];
        });
        setId(current=>current || invoices[0]?._id || '');
      }
    }).catch(error=>{if (!controller.signal.aborted) setMessage(error.message);});
    return ()=>controller.abort();
  },[revision]);
  function show(saved) {
    setInvoices(previous=>[saved,...previous.filter(b=>b._id!==saved._id)]);
    setId(saved._id);
    setMessage('');
  }
  async function upload(file) {
    if (!file) return;
    if (file.size > 8*1024*1024) {setMessage('Choose a file under 8 MB.');return;}
    setBusy(true);setMessage('Reading the invoice…');
    const body=new FormData();body.append('bill',file);
    try {show(await request('/vendor-invoices',{body}));}
    catch(error){setMessage(error.message);}
    finally{setBusy(false);}
  }
  return <section className="invoice-desk" aria-labelledby="delivery-title">
    <header className="invoice-heading">
      <div><h2 id="delivery-title">Check a delivery</h2>
        <p>Upload the supplier’s bill, then say what you ordered and what arrived.</p></div>
      <input ref={input} type="file" aria-label="Vendor invoice" hidden accept="application/pdf,image/jpeg,image/png,image/webp"
        onChange={e=>{const file=e.target.files[0];e.target.value='';void upload(file);}} />
      <button type="button" className="invoice-upload" disabled={busy} onClick={()=>input.current.click()}>
        <FilePlus2 size={17}/> Add vendor bill
      </button>
    </header>
    {message && <p className="invoice-message" role="status">{message}</p>}
    {bill && <div className="delivery-paper">
      <div className="delivery-meta">
        <div><ReceiptText size={17} aria-hidden="true"/><strong>{title(bill)}</strong></div>
        <a href={'/api/vendor-invoices/'+bill._id+'/source'} target="_blank" rel="noreferrer">Original bill <ArrowUpRight size={14}/></a>
      </div>
      {invoices.length>1 && <label className="invoice-select">Saved bills
        <select value={id} disabled={busy} onChange={e=>{setId(e.target.value);setMessage('');}}>
          {invoices.map(b=><option key={b._id} value={b._id}>{title(b)} · {new Date(b.created).toLocaleDateString('en-IN')}</option>)}
        </select></label>}
      <div className="delivery-voice">
        <SignupVoice label={bill.check?'Recheck delivery':'Speak delivery details'} processing="Comparing quantities…"
          disabled={busy} onBusy={setBusy} onError={setMessage} onRecording={async audio=>{
            const body=new FormData();body.append('audio',audio,'delivery');body.append('revision',String(bill.revision));
            show(await request('/vendor-invoices/'+bill._id+'/check',{body}));
          }}/>
        {bill.check && <details><summary>What staff said</summary><p>{bill.check.transcript}</p></details>}
      </div>
      <ul className="delivery-lines">{(bill.check?.rows || bill.lines).map((row,i)=><li key={i} data-state={row.status}>
        <h3>{row.name}</h3>
        <dl>
          <div><dt>Billed</dt><dd>{qty(row.quantity,row.unit)}</dd></div>
          {bill.check && <><div><dt>Ordered</dt><dd>{measure(row.ordered)}</dd></div><div><dt>Received</dt><dd>{measure(row.received)}</dd></div></>}
          {row.ratePaise != null && <div><dt>Unit rate</dt><dd>{asRupees(row.ratePaise)}</dd></div>}
        </dl>
        {bill.check && <p className="delivery-finding"><Finding row={row}/></p>}
      </li>)}</ul>
      {!!bill.check?.unmatched.length && <div className="invoice-message"><strong>Couldn’t match to a bill line</strong>
        {bill.check.unmatched.map((c,i)=><p key={i}>{c.name} · Ordered {measure(c.ordered)} · Received {measure(c.received)}</p>)}</div>}
    </div>}
  </section>;
}
