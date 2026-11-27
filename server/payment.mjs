import { httpError } from './errors.mjs';

export const receivedOn = (bill) => bill.received ?? (bill.paid ? bill.total : 0);

export function paymentDraft(bill, intent) {
  const previous = receivedOn(bill);
  const targets = [];
  if (intent.due != null) targets.push(bill.total - intent.due);
  if (intent.received != null) targets.push(intent.received);
  if (intent.additional != null) targets.push(previous + intent.additional);
  const received = targets[0] ?? bill.total;
  if (
    !Number.isSafeInteger(received) ||
    received < 0 ||
    received > bill.total ||
    targets.some((n) => n !== received)
  )
    throw httpError(
      422,
      'The payment amounts do not match the bill. Check the amount received and the balance due.',
    );
  return { received, method: intent.method, revision: bill.paymentRevision ?? 0 };
}
