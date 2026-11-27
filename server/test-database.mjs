import { randomBytes } from 'node:crypto';
import { connect } from './db/mongo.mjs';

export async function testDatabase(t) {
  // Atlas Free limits database names to 38 bytes.
  const name = 'pankti_test_' + randomBytes(12).toString('hex');
  const { client, db } = await connect(name);
  t.after(async () => {
    try {
      await db.dropDatabase();
    } catch (error) {
      // Atlas may allow dropping collections without allowing dropDatabase.
      if (
        error.code !== 8000 ||
        error.codeName !== 'AtlasError' ||
        !error.message.includes('not allowed to do action [dropDatabase]')
      ) throw error;
      for (const { name } of await db.listCollections({}, { nameOnly: true }).toArray()) {
        await db.collection(name).drop();
      }
    } finally {
      await client.close();
    }
  });
  return { name, db };
}
