import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { openStore } from './store.mjs';
import { indiaPhone } from './phone-auth.mjs';

const file = process.argv[2];
if (!file) {
  console.error('Usage: npm run auth:import-firebase -- /absolute/path/to/firebase-users.json');
  process.exit(1);
}

const exportSchema = z.object({
  users: z.array(z.object({
    localId: z.string().min(1).max(128),
    phoneNumber: z.string().optional(),
    disabled: z.boolean().default(false),
  })),
});

try {
  const { users } = exportSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
  const accounts = users.filter(({ phoneNumber }) => indiaPhone.test(phoneNumber || ''))
    .map(({ localId, phoneNumber, disabled }) => ({ uid: localId, phone: phoneNumber, disabled }));
  const store = openStore(process.env.DATABASE_PATH || '.data/pankti.sqlite');
  try {
    console.log('Imported %d phone account mappings. %d export records were outside the supported +91 mobile format.',
      store.importPhoneAccounts(accounts), users.length - accounts.length);
  } finally {
    store.close();
  }
} catch (error) {
  console.error(error instanceof z.ZodError ? 'The file does not match the Firebase Auth JSON export format.' : error.message);
  process.exitCode = 1;
}
