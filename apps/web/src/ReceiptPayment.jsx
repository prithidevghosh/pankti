import React, { useState } from 'react';
import { Banknote, Check, ScanLine } from 'lucide-react';
import { asRupees } from './api.js';

export function ReceiptPayment({ bill, proposal, saving, onPayment }) {
  const received = bill.received ?? (bill.paid ? bill.total : 0);
  const [editing, setEditing] = useState(Boolean(proposal));
  const [value, setValue] = useState(String((proposal?.received ?? received) / 100));
  const [method, setMethod] = useState(proposal?.method ?? '');
  const target = Math.round(Number(value) * 100);
  const valid = value !== '' && Number.isSafeInteger(target) && target >= 0 && target <= bill.total;
  return (
    <footer className="receipt-payment">
      {received > 0 && (
        <p className="receipt-paid">
          <Check size={18} />
          {bill.paid ? 'Paid in full' : 'Partially paid'} · {asRupees(received)} received
        </p>
      )}
      {!bill.paid && received > 0 && (
        <p>
          Balance due <strong>{asRupees(bill.total - received)}</strong>
        </p>
      )}
      {editing ? (
        <form
          className="payment-edit"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid && method)
              onPayment(method, {
                received: target,
                revision: proposal?.revision ?? bill.paymentRevision ?? 0,
              });
          }}
        >
          <label>
            Total received (₹)
            <input
              type="number"
              step=".01"
              min="0"
              max={bill.total / 100}
              required
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          </label>
          <label>
            Payment method
            <select required value={method} onChange={(e) => setMethod(e.target.value)}>
              <option value="">Choose method</option>
              <option value="cash">Cash</option>
              <option value="upi">UPI</option>
            </select>
          </label>
          <p>
            Balance due <strong>{valid ? asRupees(bill.total - target) : '—'}</strong>
          </p>
          <button disabled={!valid || !method || saving}>Save payment</button>
          <button type="button" disabled={saving} onClick={() => setEditing(false)}>
            Cancel
          </button>
        </form>
      ) : (
        <>
          {!bill.paid && (
            <>
              <p>{received ? 'Record the remaining balance' : 'Record payment once received'}</p>
              <div>
                {[
                  [Banknote, 'cash', 'Received cash'],
                  [ScanLine, 'upi', 'Received UPI'],
                ].map(([Icon, key, label]) => (
                  <button
                    key={key}
                    disabled={saving}
                    onClick={() =>
                      onPayment(key, { received: bill.total, revision: bill.paymentRevision ?? 0 })
                    }
                  >
                    <Icon size={18} />
                    {label}
                  </button>
                ))}
              </div>
            </>
          )}
          <button
            className="adjust-balance"
            disabled={saving}
            onClick={() => {
              setValue(String(received / 100));
              setMethod(bill.method || '');
              setEditing(true);
            }}
          >
            {received ? 'Edit payment' : 'Record partial payment'}
          </button>
        </>
      )}
    </footer>
  );
}
