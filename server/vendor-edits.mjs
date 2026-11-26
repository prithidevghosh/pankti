import { createHash } from 'node:crypto';
import { httpError } from './providers.mjs';

const keyFor = (name) => name.trim().normalize('NFKC').toLowerCase().replace(/\s+/g, ' ');

// Keep the original event immutable. A correction supersedes its working values.
// Pair a purchase and partial payment only when the original voice note identifies
// exactly one of each for that supplier. Standalone payments remain on account.
export function vendorLedger(db, restaurant, correction) {
  const original = db.prepare('SELECT * FROM vendor_events WHERE restaurant=? ORDER BY id').all(restaurant);
  const edits = db
    .prepare('SELECT id,event,details FROM vendor_edits WHERE restaurant=? ORDER BY id')
    .all(restaurant);
  const revision = createHash('sha256')
    .update(JSON.stringify([original.at(-1)?.id, edits.at(-1)?.id]))
    .digest('hex');
  const latest = new Map(edits.map((e) => [e.event, JSON.parse(e.details)]));
  if (correction) {
    if (revision !== correction.revision)
      throw httpError(409, 'The vendor ledger changed. Refresh and reopen the entry.');
    if (!original.some((e) => e.id === correction.id)) throw httpError(404, 'Vendor entry not found.');
    latest.set(correction.id, correction.details);
  }
  const groups = new Map();
  for (const row of original) {
    const group = JSON.stringify([row.request, row.vendor_key]);
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(row);
  }
  const linked = new Map();
  for (const group of groups.values()) {
    const buys = group.filter((e) => e.kind === 'purchase');
    const pays = group.filter((e) => e.kind === 'payment');
    if (
      buys.length === 1 &&
      pays.length === 1 &&
      pays[0].amount <= buys[0].amount &&
      pays[0].id === buys[0].id + 1
    ) {
      linked.set(buys[0].id, pays[0]);
      linked.set(pays[0].id, buys[0]);
    }
  }
  const balances = new Map();
  const events = [];
  for (const row of original) {
    const pair = linked.get(row.id);
    if (row.kind === 'payment' && pair) {
      const purchase = latest.get(pair.id);
      events.push({
        id: row.id,
        linkedPurchase: pair.id,
        created: row.created,
        kind: 'payment',
        vendor: purchase?.vendor ?? row.vendor,
        amount: purchase?.paid ?? row.amount,
        paid: purchase?.paid ?? row.amount,
        note: row.note,
      });
      continue;
    }
    const details = latest.get(row.id) || {
      vendor: row.vendor,
      note: row.note,
      amount: row.amount,
      paid: row.kind === 'purchase' ? pair?.amount || 0 : row.kind === 'payment' ? row.amount : 0,
    };
    const { vendor, amount, paid } = details;
    const key = keyFor(vendor);
    const prior = balances.get(key)?.due || 0;
    const due = { order: prior - paid, purchase: prior + amount - paid, payment: prior - paid, balance: amount - paid }[
      row.kind
    ];
    balances.set(key, { vendor, due });
    events.push({ id: row.id, kind: row.kind, created: row.created, ...details });
  }
  return {
    revision,
    balances: [...balances.values()].sort((a, b) => a.vendor.localeCompare(b.vendor)),
    events: events.reverse(),
  };
}
