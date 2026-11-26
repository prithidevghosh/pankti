import { MongoClient } from 'mongodb';
import { ensureSchema } from './schema.mjs';

export const localUri = 'mongodb://127.0.0.1:27117/?replicaSet=pankti&directConnection=true';
export function databaseName(local = process.env.APP_AUTH_MODE === 'phone-only') {
  return local
    ? process.env.MONGODB_LOCAL_DATABASE || 'pankti_local_signup'
    : process.env.MONGODB_DATABASE || 'pankti';
}

export async function connect(database = databaseName()) {
  const client = new MongoClient(process.env.MONGODB_URI || localUri, { serverSelectionTimeoutMS: 5000 });
  try {
    const db = client.db(database);
    const hello = await db.command({ hello: 1 });
    if (!hello.setName && hello.msg !== 'isdbgrid')
      throw Error('Pankti requires a MongoDB replica set for transactions.');
    await ensureSchema(db);
    return {
      client,
      db,
      transaction: (fn) =>
        client.withSession((session) =>
          session.withTransaction(() => fn(session), {
            readConcern: { level: 'snapshot' },
            writeConcern: { w: 'majority' },
          }),
        ),
    };
  } catch (error) {
    await client.close();
    throw error;
  }
}

// Take the write lock before any dependent reads. Retries then see the committed
// state, including a previous request receipt or a newer vendor ledger revision.
export async function increment(db, session, key, amount = 1) {
  const row = await db
    .collection('counters')
    .findOneAndUpdate(
      { _id: key },
      { $inc: { value: amount } },
      { session, upsert: true, returnDocument: 'after' },
    );
  return row.value;
}
