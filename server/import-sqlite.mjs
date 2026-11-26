// Offline cutover tool. The running API never opens a SQLite connection.
import { DatabaseSync } from 'node:sqlite';
import { isDeepStrictEqual } from 'node:util';
import { connect } from './db/mongo.mjs';
import { pathToFileURL } from 'node:url';

export async function importSqlite(path, database) {
  const sql = new DatabaseSync(path, { readOnly: true });
  let client;
  try {
    sql.exec('BEGIN');
    if (
      sql.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok' ||
      sql.prepare('PRAGMA foreign_key_check').get()
    )
      throw Error('Source database integrity check failed.');
    const tables = sql
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((row) => row.name);
    if (!tables.includes('restaurants')) throw Error('Unrecognized Pankti source database.');
    const rows = (table) =>
      tables.includes(table) ? sql.prepare('SELECT * FROM ' + table + ' ORDER BY rowid').all() : [];
    const keyed = (table, key, transform = (row) => row) =>
      rows(table).map((row) => {
        const { [key]: _id, ...values } = row;
        return { _id, ...transform(values) };
      });
    const documents = {};
    documents.restaurants = keyed('restaurants', 'id');
    documents.menu = keyed('menu', 'id');
    const byBill = Map.groupBy(rows('lines'), (row) => row.bill);
    documents.bills = keyed('bills', 'id').map((row) => ({
      ...row,
      lines: (byBill.get(row._id) || []).map(({ bill, ...line }) => line),
    }));
    documents.vendor_events = rows('vendor_events').map((row) => ({ ...row, _id: row.id }));
    documents.vendor_edits = rows('vendor_edits').map((row) => ({
      ...row,
      _id: row.id,
      details: JSON.parse(row.details),
    }));
    documents.phone_accounts = keyed('phone_accounts', 'phone', ({ uid, disabled = 0 }) => ({
      uid,
      disabled: !!disabled,
    }));
    documents.local_signup_profiles = keyed('local_signup_profiles', 'uid');
    documents.phone_auth_config = keyed('phone_auth_config', 'key');
    documents.phone_challenges = keyed('phone_challenges', 'id', (row) => ({
      ...row,
      checking: !!row.checking,
      expiresAt: new Date(row.created + 3600000),
    }));
    documents.phone_sessions = keyed('phone_sessions', 'token_hash', ({ uid, expires }) => ({
      uid,
      expiresAt: new Date(expires),
    }));
    const counters = new Map();
    function seed(key, value) {
      counters.set(key, Math.max(value, counters.get(key) || 0));
    }
    for (const row of documents.bills) seed('bill:' + row.restaurant, row.number);
    for (const row of [...documents.vendor_events, ...documents.vendor_edits])
      seed('vendor:' + row.restaurant, row.id);
    documents.counters = [...counters].map(([_id, value]) => ({ _id, value }));
    const known = new Set([...Object.keys(documents), 'lines', 'sqlite_sequence', 'schema_migrations']);
    if (tables.some((table) => !known.has(table)))
      throw Error('Unexpected source table. Review the import mapping before proceeding.');

    const connection = await connect(database);
    client = connection.client;
    const { db, transaction } = connection;
    const counts = {};
    await transaction(async (session) => {
      if (
        await db
          .collection('schema_versions')
          .findOne({ _id: 1, legacyImportedAt: { $exists: true } }, { session })
      )
        throw Error('This database has already been imported.');
      for (const [name, docs] of Object.entries(documents)) {
        const collection = db.collection(name);
        if (await collection.findOne({}, { session }))
          throw Error('Target contains existing records. Import cancelled.');
        if (docs.length) await collection.insertMany(docs, { session });
        const stored = await collection.find({}, { session }).toArray();
        const byId = new Map(stored.map((row) => [row._id, row]));
        if (stored.length !== docs.length || docs.some((doc) => !isDeepStrictEqual(doc, byId.get(doc._id))))
          throw Error('Import verification failed for ' + name);
        counts[name] = docs.length;
      }
      await db
        .collection('schema_versions')
        .updateOne({ _id: 1 }, { $set: { legacyImportedAt: new Date() } }, { session });
    });
    return counts;
  } finally {
    sql.close();
    await client?.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [path, database] = process.argv.slice(2);
  if (!path || !database) throw Error('Provide a source SQLite path and target MongoDB database name.');
  console.log('Verified imported document counts', await importSqlite(path, database));
}
