import { randomUUID } from 'node:crypto';
import { connect } from './db/mongo.mjs';

export async function testDatabase(t) {
  const name = 'pankti_test_' + randomUUID().replaceAll('-', '');
  const { client, db } = await connect(name);
  t.after(async () => {
    try {
      await db.dropDatabase();
    } finally {
      await client.close();
    }
  });
  return { name, db };
}
