import React from 'react';
import { Banknote, Check, ScanLine, X } from 'lucide-react';
import { asRupees } from './api.js';
import './receipt.css';

const issued = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit',
});

export function BillReceipt({ openBill, restaurant, onPayment }) {
  const bill = openBill?.bill;
  return <>
    <header className="receipt-bar">
      <h2 id="bill-title">{bill ? 'Bill #' + String(bill.number).padStart(4, '0') : 'Bill details'}</h2>
      <form method="dialog"><button aria-label="Close bill"><X size={19}/></button></form>
    </header>
    {openBill?.error && <p role="alert" className="receipt-error">{openBill.error}</p>}
    {bill ? <>
      <div className="receipt-mast">
        <div><h3>{restaurant?.name || 'Sales receipt'}</h3>
          <p>{restaurant?.city && <span>{restaurant.city} · </span>}<time dateTime={bill.created}>{issued.format(new Date(bill.created))}</time></p>
        </div>
        <img src="/settlement-stamp.webp" alt=""/>
      </div>
      <div className="receipt-paper">
        <table aria-label="Bill items">
          <thead><tr><th scope="col">Item</th><th scope="col">Qty</th><th scope="col">Amount</th></tr></thead>
          <tbody>{bill.lines.map(line => <tr key={line.item}>
            <th scope="row">{line.name}<small>{line.variant && line.variant+' · '}{asRupees(line.price)} each</small></th>
            <td>{line.quantity}</td><td>{asRupees(Math.round(line.price * line.quantity))}</td>
          </tr>)}</tbody>
        </table>
        <div className="receipt-sum"><span>Total</span><strong>{asRupees(bill.total)}</strong></div>
        {!bill.paid && restaurant?.qr && <figure className="receipt-payee">
          <img src={restaurant.qr} alt="Store UPI payment QR code"/>
          <figcaption>Scan to pay by UPI{restaurant.payee && <small>{restaurant.payee}</small>}</figcaption>
        </figure>}
      </div>
      <footer className="receipt-payment">
        {bill.paid ? <p className="receipt-paid" role="status"><Check size={19}/> Paid by {bill.method === 'upi' ? 'UPI' : 'cash'}</p> :
          <><p>Record payment once received</p>
            <div>{[[Banknote,'cash','Received cash'],[ScanLine,'upi','Received UPI']].map(([Icon,method,label])=>
              <button key={method} disabled={openBill.saving} onClick={()=>onPayment(method)}><Icon size={18}/>{label}</button>
            )}</div></>}
      </footer>
    </> : openBill && !openBill.error && <p className="receipt-loading" role="status">Loading bill…</p>}
  </>;
}
