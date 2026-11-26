import { migrate } from './db/migrate.mjs';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { vendorLedger } from './vendor-edits.mjs';
import { openPhoneStore } from './phone-store.mjs';

export function openStore(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  try {
    db.exec('PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;');
    migrate(db);
  } catch (error) {
    db.close();
    throw error;
  }
  const transaction = (operation) => {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = operation();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  };
  const restaurantFor = (uid) =>
    db.prepare('SELECT id, name, city, qr, payee FROM restaurants WHERE owner = ?').get(uid);
  const menuFor = (id) =>
    db
      .prepare(
        'SELECT id, name, variant, category, price FROM menu WHERE restaurant = ? ORDER BY category, name, variant',
      )
      .all(id);
  const billFor = (restaurant, id) => {
    const bill = db
      .prepare('SELECT id, number, created, total, paid, method FROM bills WHERE restaurant = ? AND id = ?')
      .get(restaurant, id);
    if (!bill) return null;
    return {
      ...bill,
      lines: db
        .prepare('SELECT item, name, variant, price, quantity FROM lines WHERE bill = ? ORDER BY rowid')
        .all(id),
    };
  };
  return {
    ...openPhoneStore(db, transaction),
    close: () => db.close(),
    restaurantFor,
    menuFor,
    billFor,
    pendingBill(restaurant) {
      const pending = db
        .prepare('SELECT id FROM bills WHERE restaurant = ? AND paid IS NULL ORDER BY number DESC LIMIT 1')
        .get(restaurant);
      return pending ? billFor(restaurant, pending.id) : null;
    },
    createRestaurant(uid, name, city) {
      db.prepare(
        'INSERT INTO restaurants(id, owner, name, city) VALUES (?, ?, ?, ?) ON CONFLICT(owner) DO NOTHING',
      ).run(randomUUID(), uid, name, city);
      return restaurantFor(uid);
    },
    saveQr(id, qr, payee) {
      db.prepare('UPDATE restaurants SET qr = ?, payee = ? WHERE id = ?').run(qr, payee, id);
    },
    saveMenu(restaurant, entries) {
      transaction(() => {
        const update = db.prepare(`
          INSERT INTO menu(id, restaurant, name, variant, category, price, label_key)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(restaurant, label_key) DO UPDATE SET
            name = excluded.name, variant = excluded.variant,
            category = excluded.category, price = excluded.price
        `);
        for (const { name, variant, category, price } of entries) {
          const key = JSON.stringify(
            [name, variant].map((value) => value.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ')),
          );
          update.run(randomUUID(), restaurant, name, variant, category, price, key);
        }
      });
      return menuFor(restaurant);
    },
    editMenu(restaurant, id, entry) {
      const { name, variant, category, price } = entry;
      const key = JSON.stringify([name, variant].map(value => value.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ')));
      try {
        return db.prepare('UPDATE menu SET name=?, variant=?, category=?, price=?, label_key=? WHERE restaurant=? AND id=?')
          .run(name, variant, category, price, key, restaurant, id).changes;
      } catch (error) {
        if (error.errcode === 2067) throw Object.assign(new Error('A menu item already has this name and portion.'), { status: 409 });
        throw error;
      }
    },
    vendors(restaurant) {
      return vendorLedger(db,restaurant);
    },
    correctVendor(restaurant,correction,commit) {
      return transaction(() => {
        const preview = vendorLedger(db,restaurant,correction);
        if (!commit) return preview;
        db.prepare('INSERT INTO vendor_edits(restaurant,event,details,created) VALUES(?,?,?,?)')
          .run(restaurant,correction.id,JSON.stringify(correction.details),new Date().toISOString());
        return vendorLedger(db,restaurant);
      });
    },
    postVendor(restaurant, request, entries) {
      transaction(() => {
        if (db.prepare('SELECT 1 FROM vendor_events WHERE restaurant=? AND request=?').get(restaurant, request)) return;
        const add = db.prepare('INSERT INTO vendor_events(restaurant,request,sequence,created,vendor,vendor_key,kind,note,amount,delta) VALUES(?,?,?,?,?,?,?,?,?,?)');
        const now = new Date().toISOString();
        entries.forEach(({ vendor, kind, note, amount }, index) => {
          const key = vendor.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ');
          const due = db.prepare('SELECT coalesce(sum(delta),0) due FROM vendor_events WHERE restaurant=? AND vendor_key=?').get(restaurant,key).due;
          const delta = { order: 0, purchase: amount, payment: -amount, balance: amount - due }[kind];
          add.run(restaurant,request,index,now,vendor,key,kind,note,amount,delta);
        });
      });
    },
    createBill(restaurant, request, basket, prices) {
      return transaction(() => {
        const existing = db
          .prepare('SELECT id FROM bills WHERE restaurant = ? AND request = ?')
          .get(restaurant, request);
        if (existing) return billFor(restaurant, existing.id);
        const menu = new Map(menuFor(restaurant).map((item) => [item.id, item]));
        const details = basket.map(({ item, quantity }) => ({ ...menu.get(item), quantity, item }));
        if (details.some((line) => !line.id)) return null;
        if (prices && details.some(line => prices[line.item] !== line.price))
          throw Object.assign(new Error('A menu price changed. Refresh the ledger and review the bill total.'), { status: 409 });
        const number = db
          .prepare('SELECT coalesce(max(number), 0) + 1 AS next FROM bills WHERE restaurant = ?')
          .get(restaurant).next;
        const id = randomUUID();
        const total = details.reduce((sum, line) => sum + Math.round(line.price * line.quantity), 0);
        db.prepare(
          'INSERT INTO bills(id, restaurant, number, request, created, total) VALUES (?, ?, ?, ?, ?, ?)',
        ).run(id, restaurant, number, request, new Date().toISOString(), total);
        const insert = db.prepare(
          'INSERT INTO lines(bill, item, name, variant, price, quantity) VALUES (?, ?, ?, ?, ?, ?)',
        );
        for (const line of details)
          insert.run(id, line.item, line.name, line.variant, line.price, line.quantity);
        return billFor(restaurant, id);
      });
    },
    markPaid(restaurant, id, method) {
      db.prepare(
        'UPDATE bills SET paid = ?, method = ? WHERE id = ? AND restaurant = ? AND paid IS NULL',
      ).run(new Date().toISOString(), method, id, restaurant);
      return billFor(restaurant, id);
    },
    analytics(restaurant, date) {
      const from = Date.parse(date + 'T00:00:00+05:30');
      const start = new Date(from).toISOString();
      const end = new Date(from + 86_400_000).toISOString();
      const paid = db
        .prepare('SELECT total, paid FROM bills WHERE restaurant = ? AND paid >= ? AND paid < ?')
        .all(restaurant, start, end);
      const bills = db
        .prepare(
          'SELECT id, number, total, created, paid, method FROM bills WHERE restaurant = ? AND created >= ? AND created < ? ORDER BY number DESC LIMIT 100',
        )
        .all(restaurant, start, end);
      const { count } = db
        .prepare('SELECT count(*) AS count FROM bills WHERE restaurant = ? AND created >= ? AND created < ?')
        .get(restaurant, start, end);
      const items = db
        .prepare(
          `
        SELECT lines.name, lines.variant, SUM(lines.quantity) AS quantity, SUM(round(lines.price * lines.quantity)) AS revenue
        FROM lines JOIN bills ON bills.id = lines.bill
        WHERE bills.restaurant = ? AND paid >= ? AND paid < ?
        GROUP BY lines.item, lines.name, lines.variant ORDER BY quantity DESC, revenue DESC, lines.name LIMIT 8
      `,
        )
        .all(restaurant, start, end);
      const hourly = Array(24).fill(0);
      for (const entry of paid) {
        const hour = Math.floor((Date.parse(entry.paid) - from) / 3_600_000);
        hourly[hour] += entry.total;
      }
      const revenue = paid.reduce((sum, entry) => sum + entry.total, 0);
      return {
        date,
        orders: count,
        paidCount: paid.length,
        revenue,
        average: paid.length ? Math.round(revenue / paid.length) : 0,
        hourly,
        items,
        bills,
      };
    },
  };
}
