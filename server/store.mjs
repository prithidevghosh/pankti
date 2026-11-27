import { receivedOn } from './payment.mjs';
import { reviewMenuImport } from '../shared/menu-import.mjs';
import { randomUUID } from 'node:crypto';
import { connect, increment } from './db/mongo.mjs';
import { vendorLedger } from './vendor-edits.mjs';
import { openPhoneStore } from './phone-store.mjs';
import { httpError } from './errors.mjs';

const labelKey = ({ name, variant }) => JSON.stringify([name, variant].map(normalize));
const normalize = (value) => value.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ');
const view = (doc) => {
  if (!doc) return null;
  const { _id: id, restaurant, owner, request, label_key, ...fields } = doc;
  return { id, ...fields };
};

export async function openStore(database) {
  const { db, client, transaction } = await connect(database);
  const restaurants = db.collection('restaurants');
  const menu = db.collection('menu');
  const bills = db.collection('bills');
  const events = db.collection('vendor_events');
  const edits = db.collection('vendor_edits');
  const restaurantFor = async (owner) => view(await restaurants.findOne({ owner }));
  const menuFor = async (restaurant) =>
    (await menu.find({ restaurant }).sort({ category: 1, name: 1, variant: 1 }).toArray()).map(view);
  const ledger = async (restaurant, session, correction) =>
    vendorLedger(
      await events.find({ restaurant }, { session }).sort({ id: 1 }).toArray(),
      await edits.find({ restaurant }, { session }).sort({ id: 1 }).toArray(),
      correction,
    );
  return {
    ...openPhoneStore(db, transaction),
    close: () => client.close(),
    async recordTranscript(owner, restaurant, task, transcript) {
      const _id = randomUUID();
      await db.collection('voice_transcripts').insertOne({
        _id, owner, restaurant, task, transcript, createdAt: new Date(),
        ...(!owner && { expiresAt: new Date(Date.now() + 86400000) }),
      });
      return _id;
    },
    restaurantFor,
    menuFor,
    async createRestaurant(owner, name, city) {
      return view(
        await restaurants.findOneAndUpdate(
          { owner },
          { $setOnInsert: { _id: randomUUID(), name, city, qr: null, payee: null } },
          { upsert: true, returnDocument: 'after' },
        ),
      );
    },
    saveQr: (id, qr, payee) => restaurants.updateOne({ _id: id }, { $set: { qr, payee } }),
    async saveMenu(restaurant, entries) {
      await transaction(async (session) => {
        for (const entry of entries)
          await menu.updateOne(
            { restaurant, label_key: labelKey(entry) },
            { $set: entry, $setOnInsert: { _id: randomUUID() } },
            { upsert: true, session },
          );
      });
      return menuFor(restaurant);
    },
    async importMenu(restaurant, entries) {
      const result = await transaction(async (session) => {
        await increment(db, session, 'menu-import:' + restaurant);
        const current = await menu.find({ restaurant }, { session }).toArray();
        const review = reviewMenuImport(current, entries);
        const added = entries.flatMap((entry, i) =>
          review[i].duplicate || review[i].conflict
            ? []
            : [{ ...entry, restaurant, _id: randomUUID(), label_key: labelKey(entry) }],
        );
        if (added.length) await menu.insertMany(added, { session });
        return { added: added.length, review };
      });
      return { ...result, menu: await menuFor(restaurant) };
    },
    async editMenu(restaurant, id, entry) {
      try {
        return (
          await menu.updateOne({ restaurant, _id: id }, { $set: { ...entry, label_key: labelKey(entry) } })
        ).matchedCount;
      } catch (error) {
        if (error.code === 11000) throw httpError(409, 'A menu item already has this name and portion.');
        throw error;
      }
    },
    vendors: (restaurant) => transaction((session) => ledger(restaurant, session)),
    correctVendor(restaurant, correction, commit) {
      return transaction(async (session) => {
        // All postings and corrections to a restaurant share this sequence.
        const id = commit ? await increment(db, session, 'vendor:' + restaurant) : null;
        const preview = await ledger(restaurant, session, correction);
        if (!commit) return preview;
        await edits.insertOne(
          {
            restaurant,
            id,
            event: correction.id,
            details: correction.details,
            created: new Date().toISOString(),
          },
          { session },
        );
        return ledger(restaurant, session);
      });
    },
    postVendor(restaurant, request, entries) {
      return transaction(async (session) => {
        const end = await increment(db, session, 'vendor:' + restaurant, entries.length);
        if (await events.findOne({ restaurant, request }, { session })) return;
        await events.insertMany(
          entries.map((entry, sequence) => ({
            ...entry,
            restaurant,
            request,
            sequence,
            vendor_key: normalize(entry.vendor),
            created: new Date().toISOString(),
            id: end - entries.length + 1 + sequence,
          })),
          { session },
        );
      });
    },
    async billFor(restaurant, id) {
      return view(await bills.findOne({ restaurant, _id: id }));
    },
    async pendingBill(restaurant) {
      return view(await bills.findOne({ restaurant, paid: null }, { sort: { number: -1 } }));
    },
    createBill(restaurant, request, basket, prices) {
      return transaction(async (session) => {
        const existing = await bills.findOne({ restaurant, request }, { session });
        if (existing) return view(existing);
        const items = await menu
          .find({ restaurant, _id: { $in: basket.map((line) => line.item) } }, { session })
          .toArray();
        const byId = new Map(items.map((item) => [item._id, item]));
        if (basket.some((line) => !byId.has(line.item))) return null;
        const lines = basket.map(({ item, quantity, note }) => {
          const { name, variant, price } = byId.get(item);
          if (prices && prices[item] !== price)
            throw httpError(409, 'A menu price changed. Refresh the ledger and review the bill total.');
          return { item, quantity, name, variant, price, ...(note ? { note } : {}) };
        });
        const number = await increment(db, session, 'bill:' + restaurant);
        const doc = {
          _id: randomUUID(),
          restaurant,
          request,
          number,
          created: new Date().toISOString(),
          paid: null,
          method: null,
          total: lines.reduce((sum, line) => sum + Math.round(line.price * line.quantity), 0),
          lines,
        };
        await bills.insertOne(doc, { session });
        return view(doc);
      });
    },
    async billByNumber(restaurant, number) {
      return view(await bills.findOne({ restaurant, number }));
    },
    recordPayment(restaurant, id, method, change) {
      return transaction(async (session) => {
        const bill = await bills.findOne({ restaurant, _id: id }, { session });
        if (!bill) return null;
        const previous = receivedOn(bill);
        const received = change?.received ?? bill.total;
        if (received > bill.total) throw httpError(422, 'Payment exceeds the bill total.');
        if (previous === received && (!received || method === bill.method)) return view(bill);
        if (change ? change.revision !== (bill.paymentRevision ?? 0) : !!bill.paid)
          throw httpError(409, 'This bill already has a different payment. Reopen it to review.');
        const now = new Date().toISOString();
        const movements =
          bill.movements ?? (bill.paid ? [{ at: bill.paid, amount: bill.total, method: bill.method }] : []);
        const next = {
          received,
          method: received ? method : null,
          paid: received === bill.total ? bill.paid || now : null,
          paymentRevision: (bill.paymentRevision ?? 0) + 1,
          movements: [...movements, { at: now, amount: received - previous, method }],
        };
        await bills.updateOne({ _id: id, restaurant }, { $set: next }, { session });
        return view({ ...bill, ...next });
      });
    },
    markPaid(restaurant, id, method) {
      return this.recordPayment(restaurant, id, method);
    },
    phrasesFor: (restaurant) =>
      db.collection('phrases').find({ restaurant }).sort({ name: 1 }).map(view).toArray(),
    async savePhrase(restaurant, id, name, lines) {
      const ids = lines.map((row) => row.item);
      if ((await menu.countDocuments({ restaurant, _id: { $in: ids } })) !== ids.length)
        throw httpError(422, 'Choose dishes from your saved menu.');
      const values = { name, key: normalize(name.trim()), lines };
      try {
        if (id) {
          if (
            !(await db.collection('phrases').updateOne({ restaurant, _id: id }, { $set: values }))
              .matchedCount
          )
            throw httpError(404, 'Phrase no longer exists.');
        } else await db.collection('phrases').insertOne({ _id: randomUUID(), restaurant, ...values });
      } catch (e) {
        if (e.code === 11000) throw httpError(409, 'This phrase already exists. Edit it instead.');
        throw e;
      }
      return this.phrasesFor(restaurant);
    },
    async forgetPhrase(restaurant, id) {
      await db.collection('phrases').deleteOne({ restaurant, _id: id });
      return this.phrasesFor(restaurant);
    },
    async analytics(restaurant, date, days = 1) {
      const end = Date.parse(date + 'T00:00:00+05:30') + 86400000;
      const from = end - days * 86400000;
      const range = { $gte: new Date(from).toISOString(), $lt: new Date(end).toISOString() };
      return transaction(async (session) => {
        const createdInPeriod = { restaurant, created: range };
        const orders = await bills.countDocuments(createdInPeriod, { session });
        const recent = await bills
          .find(createdInPeriod, { session, projection: { lines: 0 } })
          .sort({ number: -1 })
          .limit(100)
          .toArray();
        const hourly = Array(24).fill(0);
        let settledTotal = 0,
          revenue = 0,
          paidCount = 0;
        const totals = new Map();
        for await (const bill of bills.find(
          { restaurant, $or: [{ paid: range }, { 'movements.at': range }] },
          { session },
        )) {
          for (const movement of bill.movements ?? [{ at: bill.paid, amount: bill.total }]) {
            if (movement.at >= range.$gte && movement.at < range.$lt) {
              hourly[Math.floor((Date.parse(movement.at) - from) / 3600000) % 24] += movement.amount;
              revenue += movement.amount;
            }
          }
          if (!bill.paid || bill.paid < range.$gte || bill.paid >= range.$lt) continue;
          settledTotal += bill.total;

          paidCount++;
          for (const line of bill.lines) {
            const key = JSON.stringify([line.item, line.name, line.variant]);
            const row = totals.get(key) || {
              name: line.name,
              variant: line.variant,
              quantity: 0,
              revenue: 0,
            };
            row.quantity += line.quantity;
            row.revenue += Math.round(line.price * line.quantity);
            totals.set(key, row);
          }
        }
        const items = [...totals.values()]
          .sort((a, b) => b.quantity - a.quantity || b.revenue - a.revenue || a.name.localeCompare(b.name))
          .slice(0, 8);
        return {
          date,
          orders,
          paidCount,
          revenue,
          average: paidCount ? Math.round(settledTotal / paidCount) : 0,
          hourly,
          items,
          bills: recent.map(view),
        };
      });
    },
  };
}
