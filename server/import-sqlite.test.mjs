import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { testDatabase } from './test-database.mjs';
import { importSqlite } from './import-sqlite.mjs';
import { openStore } from './store.mjs';

test('legacy import preserves fractional receipts and continues numbering; rerun cannot overwrite', async (t) => {
  const { name, db } = await testDatabase(t);
  const dir = await mkdtemp(join(tmpdir(), 'pankti-import-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'legacy.sqlite'),
    source = new DatabaseSync(path);
  source.exec(`
    CREATE TABLE restaurants(id,owner,name,city,qr,payee);
    INSERT INTO restaurants VALUES('shop','owner','Shop','Mumbai',NULL,NULL);
    CREATE TABLE menu(id,restaurant,name,variant,category,price,label_key);
    INSERT INTO menu VALUES('dish','shop','Tea','','Drinks',2000,'["tea",""]');
    CREATE TABLE bills(id,restaurant,number,request,created,total,paid,method);
    INSERT INTO bills VALUES('receipt','shop',12,'first','2026-11-27T07:00:00.000Z',750,'2026-11-27T07:01:00.000Z','cash');
    CREATE TABLE lines(bill,item,name,variant,price,quantity);
    INSERT INTO lines VALUES('receipt','dish','Tea','',1500,0.5);
  `);
  source.close();
  await importSqlite(path, name);
  const store = await openStore(name);
  t.after(() => store.close());
  const bill = await store.billFor('shop', 'receipt');
  assert.deepEqual(bill.lines, [{ item: 'dish', name: 'Tea', variant: '', price: 1500, quantity: 0.5 }]);
  const next = await store.createBill('shop', 'second', [{ item: 'dish', quantity: 1 }]);
  assert.equal(next.number, 13);
  assert.equal(next.total, 2000);
  await assert.rejects(importSqlite(path, name), /already been imported/);
  assert.equal(await db.collection('bills').countDocuments(), 2);
});
