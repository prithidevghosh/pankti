import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { migrate } from './db/migrate.mjs';

function legacy(t, quantity) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  db.exec('PRAGMA foreign_keys=ON');
  db.exec(readFileSync(new URL('./db/migrations/001_baseline.sql', import.meta.url), 'utf8'));
  db.exec(`
    INSERT INTO restaurants VALUES ('r','owner','Counter','Pune',NULL,NULL);
    INSERT INTO menu VALUES ('item','r','New name','','Kitchen',50000,'key');
    INSERT INTO bills VALUES ('bill','r',1,'request','2026-11-27',15000,NULL,NULL);
  `);
  db.prepare("INSERT INTO lines VALUES ('bill','item','Original name','',30000,?)").run(quantity);
  return db;
}

test('adopts legacy data, preserves receipt snapshots and only applies each migration once', t => {
  const db = legacy(t, 0.5);
  migrate(db);
  const history = db.prepare('SELECT * FROM schema_migrations ORDER BY version').all();
  assert.equal(history.length, 2);
  migrate(db);
  assert.deepEqual(db.prepare('SELECT * FROM schema_migrations ORDER BY version').all(), history);
  assert.deepEqual({...db.prepare('SELECT name,price,quantity FROM lines').get()},
    {name:'Original name',price:30000,quantity:0.5});
  assert.throws(() => db.exec('UPDATE lines SET quantity=0.3'), /CHECK/);
  db.exec("UPDATE schema_migrations SET checksum='different' WHERE version=1");
  assert.throws(() => migrate(db), /history differs/);
});

test('a failed legacy upgrade rolls back both schema and data', t => {
  const db = legacy(t, 0.3);
  assert.throws(() => migrate(db), /CHECK/);
  assert.equal(db.prepare('SELECT quantity FROM lines').get().quantity, 0.3);
  assert.equal(db.prepare("SELECT count(*) n FROM sqlite_schema WHERE name IN ('lines_v2','schema_migrations')").get().n, 0);
});
