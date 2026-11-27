import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { testDatabase } from './test-database.mjs';
import { openStore } from './store.mjs';

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

test('photo imports skip matches across pages and concurrent uploads while protecting changed prices', async t => {
  const { name } = await testDatabase(t);
  const store = await openStore(name);
  t.after(() => store.close());
  const restaurant = await store.createRestaurant('owner', 'Kitchen', 'Pune');
  const dish = { name:'Butter Naan', variant:'Full', category:'Breads', price:3500 };
  const repeat = { ...dish, name:'BUTTER-NAN', category:' breads ' };
  const results = await Promise.all([1,2].map(() => store.importMenu(restaurant.id,[dish,repeat])));
  assert.equal(results.reduce((n,r)=>n+r.added,0),1);
  assert.ok(results.some(r=>r.review[1].duplicate === 'Repeated on upload'));
  assert.ok(results.some(r=>r.review[0].duplicate === 'Already on menu'));
  const next = await store.importMenu(restaurant.id,[{...dish,price:4000},{...dish,variant:'Half',price:2000}]);
  assert.equal(next.review[0].conflict,true);
  assert.equal(next.added,1);
  assert.equal(next.menu.find(row=>row.variant==='Full').price,3500);
});
