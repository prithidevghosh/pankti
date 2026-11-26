import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openPhoneStore } from './phone-store.mjs';

export function openStore(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS restaurants (
      id TEXT PRIMARY KEY, owner TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
      city TEXT NOT NULL, qr TEXT, payee TEXT
    );
    CREATE TABLE IF NOT EXISTS menu (
      id TEXT PRIMARY KEY, restaurant TEXT NOT NULL REFERENCES restaurants(id),
      name TEXT NOT NULL, variant TEXT NOT NULL, category TEXT NOT NULL,
      price INTEGER NOT NULL CHECK(price > 0), label_key TEXT NOT NULL,
      UNIQUE(restaurant, label_key)
    );
    CREATE TABLE IF NOT EXISTS bills (
      id TEXT PRIMARY KEY, restaurant TEXT NOT NULL REFERENCES restaurants(id),
      number INTEGER NOT NULL, request TEXT NOT NULL, created TEXT NOT NULL,
      total INTEGER NOT NULL, paid TEXT, method TEXT,
      UNIQUE(restaurant, number), UNIQUE(restaurant, request)
    );
    CREATE TABLE IF NOT EXISTS lines (
      bill TEXT NOT NULL REFERENCES bills(id), item TEXT NOT NULL REFERENCES menu(id),
      name TEXT NOT NULL, variant TEXT NOT NULL, price INTEGER NOT NULL,
      quantity INTEGER NOT NULL CHECK(quantity > 0), PRIMARY KEY(bill, item)
    );
    CREATE INDEX IF NOT EXISTS bill_paid ON bills(restaurant, paid);
  `);
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
    createBill(restaurant, request, basket) {
      return transaction(() => {
        const existing = db
          .prepare('SELECT id FROM bills WHERE restaurant = ? AND request = ?')
          .get(restaurant, request);
        if (existing) return billFor(restaurant, existing.id);
        const menu = new Map(menuFor(restaurant).map((item) => [item.id, item]));
        const details = basket.map(({ item, quantity }) => ({ ...menu.get(item), quantity, item }));
        if (details.some((line) => !line.id)) return null;
        const number = db
          .prepare('SELECT coalesce(max(number), 0) + 1 AS next FROM bills WHERE restaurant = ?')
          .get(restaurant).next;
        const id = randomUUID();
        const total = details.reduce((sum, line) => sum + line.price * line.quantity, 0);
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
        SELECT lines.name, lines.variant, SUM(lines.quantity) AS quantity, SUM(lines.price * lines.quantity) AS revenue
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
