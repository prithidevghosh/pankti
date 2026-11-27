import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { testDatabase } from './test-database.mjs';
import { openStore } from './store.mjs';
import { ensureSchema } from './db/schema.mjs';

test('version 1 bills can upgrade when Atlas denies validator changes', async (t) => {
  const { db } = await testDatabase(t);
  const [{ options }] = await db.listCollections({ name: 'bills' }).toArray();
  const { validator } = options;
  const properties = validator.$jsonSchema.properties;
  delete properties.received;
  delete properties.paymentRevision;
  delete properties.movements;
  delete properties.lines.items.properties.note;
  await db.collection('bills').drop();
  await db.createCollection('bills', { validator });
  await db.collection('phrases').drop();
  await db.collection('schema_versions').deleteOne({ _id: 2 });

  const bills = db.collection('bills');
  const receipt = {
    _id: 'legacy-bill', restaurant: 'counter', number: 1, request: randomUUID(),
    created: '2026-11-27T10:00:00.000Z', total: 1500, paid: null, method: null,
    lines: [{ item: 'tea', name: 'Tea', variant: '', price: 1500, quantity: 1 }],
  };
  await bills.insertOne(receipt);

  // Exercise the actual migration on hosted MongoDB. Simulate the Atlas
  // permission error locally so this path stays covered without credentials.
  const restrictedDb = {
    collection: db.collection.bind(db),
    createCollection: db.createCollection.bind(db),
    command: async (command) => {
      assert.equal(command.collMod, 'bills');
      throw Object.assign(new Error('user is not allowed to do action [collMod] on [database.bills]'), {
        code: 8000,
        codeName: 'AtlasError',
      });
    },
  };
  await ensureSchema(process.env.MONGODB_URI?.startsWith('mongodb+srv://') ? db : restrictedDb);

  assert.deepEqual(await bills.findOne({ _id: receipt._id }), receipt);
  assert.ok(await db.collection('schema_versions').findOne({ _id: 2 }));
  assert.ok(await bills.indexExists('restaurant_1_movements.at_1'));
  assert.ok(await db.collection('phrases').indexExists('restaurant_1_key_1'));
  await bills.updateOne({ _id: receipt._id }, { $set: { received: 1000, 'lines.0.note': 'Less sugar' } });
  await assert.rejects(bills.updateOne({ _id: receipt._id }, { $set: { 'lines.0.quantity': 0.1 } }), { code: 121 });
});

test('concurrent duplicate bills share one number and malformed documents are rejected', async (t) => {
  const { name, db } = await testDatabase(t);
  const store = await openStore(name);
  t.after(() => store.close());
  const restaurant = await store.createRestaurant('owner', 'Counter', 'Mumbai');
  const [item] = await store.saveMenu(restaurant.id, [
    { name: 'Tea', category: 'Drinks', variant: '', price: 1500 },
  ]);
  const request = randomUUID(),
    basket = [{ item: item.id, quantity: 0.5 }];
  const results = await Promise.all(
    Array.from({ length: 6 }, () => store.createBill(restaurant.id, request, basket)),
  );
  assert.equal(new Set(results.map((b) => b.id)).size, 1);
  assert.equal(results[0].total, 750);
  const second = await store.createBill(restaurant.id, randomUUID(), basket);
  assert.equal(second.number, 2);
  await assert.rejects(
    db.collection('bills').updateOne({ _id: second.id }, { $set: { 'lines.0.quantity': 0.1 } }),
    { code: 121 },
  );
});

test('photo imports skip matches across pages and concurrent uploads while protecting changed prices', async (t) => {
  const { name } = await testDatabase(t);
  const store = await openStore(name);
  t.after(() => store.close());
  const restaurant = await store.createRestaurant('owner', 'Kitchen', 'Pune');
  const dish = { name: 'Butter Naan', variant: 'Full', category: 'Breads', price: 3500 };
  const repeat = { ...dish, name: 'BUTTER-NAN', category: ' breads ' };
  const results = await Promise.all([1, 2].map(() => store.importMenu(restaurant.id, [dish, repeat])));
  assert.equal(
    results.reduce((n, r) => n + r.added, 0),
    1,
  );
  assert.ok(results.some((r) => r.review[1].duplicate === 'Repeated on upload'));
  assert.ok(results.some((r) => r.review[0].duplicate === 'Already on menu'));
  const next = await store.importMenu(restaurant.id, [
    { ...dish, price: 4000 },
    { ...dish, variant: 'Half', price: 2000 },
  ]);
  assert.equal(next.review[0].conflict, true);
  assert.equal(next.added, 1);
  assert.equal(next.menu.find((row) => row.variant === 'Full').price, 3500);
});

test('shop phrases, kitchen notes and partial payments stay scoped and retry safely', async (t) => {
  const { name } = await testDatabase(t);
  const store = await openStore(name);
  t.after(() => store.close());
  const r = await store.createRestaurant('a', 'A', 'Delhi'),
    other = await store.createRestaurant('b', 'B', 'Delhi');
  const [chole] = await store.saveMenu(r.id, [
    { name: 'Chole', variant: '', category: 'Mains', price: 30000 },
  ]);
  const lines = [{ item: chole.id, quantity: 1, note: 'Less onion. Extra chilli on the side.' }];
  const [phrase] = await store.savePhrase(r.id, null, 'Office set', lines);
  assert.equal((await store.phrasesFor(other.id)).length, 0);
  await assert.rejects(store.savePhrase(other.id, null, 'Office set', lines), { status: 422 });
  await store.savePhrase(r.id, phrase.id, 'Lunch set', lines);
  const bill = await store.createBill(r.id, randomUUID(), lines);
  assert.equal((await store.billFor(r.id, bill.id)).lines[0].note, lines[0].note);
  assert.equal(await store.billByNumber(other.id, bill.number), null);
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', dateStyle: 'short' }).format(
    new Date(),
  );
  const part = { received: 10000, revision: 0 };
  const settled = await Promise.all([1, 2].map(() => store.recordPayment(r.id, bill.id, 'cash', part)));
  assert.ok(settled.every((b) => !b.paid && b.received === 10000 && b.movements.length === 1));
  assert.equal((await store.analytics(r.id, day)).revenue, 10000);
  await assert.rejects(store.recordPayment(r.id, bill.id, 'cash', { received: 20000, revision: 0 }), {
    status: 409,
  });
  await assert.rejects(store.recordPayment(r.id, bill.id, 'cash', { received: 40000, revision: 1 }), {
    status: 422,
  });
  const paid = await store.recordPayment(r.id, bill.id, 'upi', { received: 30000, revision: 1 });
  assert.ok(paid.paid);
  assert.equal((await store.analytics(r.id, day)).revenue, 30000);
  await store.recordPayment(r.id, bill.id, 'upi', { received: 25000, revision: 2 });
  assert.equal((await store.analytics(r.id, day)).revenue, 25000);
  assert.deepEqual(await store.forgetPhrase(r.id, phrase.id), []);
});
