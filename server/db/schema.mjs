// Install collection validators and indexes before serving requests.
const string = { bsonType: 'string' };
const optionalText = { bsonType: ['string', 'null'] };
const integer = { bsonType: ['int', 'long', 'double'], multipleOf: 1 };
const amount = { ...integer, minimum: 0 };
const object = (properties) => ({ bsonType: 'object', required: Object.keys(properties), properties });
const line = object({
  item: string,
  name: string,
  variant: string,
  price: { ...integer, minimum: 1 },
  quantity: { bsonType: ['int', 'double', 'long'], multipleOf: 0.25, minimum: 0.25, maximum: 99 },
});
const collections = {
  restaurants: object({
    _id: string,
    owner: string,
    name: string,
    city: string,
    qr: optionalText,
    payee: optionalText,
  }),
  menu: object({
    _id: string,
    restaurant: string,
    name: string,
    category: string,
    variant: string,
    label_key: string,
    price: { ...integer, minimum: 1 },
  }),
  bills: object({
    _id: string,
    restaurant: string,
    number: integer,
    request: string,
    created: string,
    total: amount,
    paid: optionalText,
    method: { enum: [null, 'cash', 'upi'] },
    lines: { bsonType: 'array', minItems: 1, items: line },
  }),
  vendor_events: object({
    restaurant: string,
    id: integer,
    request: string,
    sequence: integer,
    vendor: string,
    vendor_key: string,
    kind: { enum: ['order', 'purchase', 'payment', 'balance'] },
    amount,
    created: string,
    note: string,
  }),
  vendor_edits: object({
    restaurant: string,
    id: integer,
    event: integer,
    details: object({ vendor: string, note: string, amount, paid: amount }),
    created: string,
  }),
  phone_accounts: object({ _id: string, uid: string, disabled: { bsonType: 'bool' } }),
  local_signup_profiles: object({ _id: string, name: string }),
  phone_auth_config: object({ _id: string }),
  phone_challenges: object({
    _id: string,
    phone: string,
    ip: string,
    created: integer,
    attempts: amount,
    checking: { bsonType: 'bool' },
    sid: optionalText,
    expiresAt: { bsonType: 'date' },
  }),
  phone_sessions: object({ _id: string, uid: string, expiresAt: { bsonType: 'date' } }),
  counters: object({ _id: string, value: integer }),
};
line.properties.note = { ...string, maxLength: 400 };
Object.assign(collections.bills.properties, {
  received: amount,
  paymentRevision: amount,
  movements: {
    bsonType: 'array',
    items: object({ at: string, amount: integer, method: { enum: ['cash', 'upi'] } }),
  },
});
collections.phrases = object({
  _id: string,
  restaurant: string,
  key: string,
  name: string,
  lines: {
    bsonType: 'array',
    minItems: 1,
    items: object({ item: string, quantity: line.properties.quantity }),
  },
});
const unique = { unique: true };
const indexes = {
  phrases: [[{ restaurant: 1, key: 1 }, unique]],
  restaurants: [[{ owner: 1 }, unique]],
  menu: [[{ restaurant: 1, label_key: 1 }, unique]],
  bills: [
    [{ restaurant: 1, number: 1 }, unique],
    [{ restaurant: 1, request: 1 }, unique],
    [{ restaurant: 1, paid: 1 }],
    [{ restaurant: 1, 'movements.at': 1 }],
    [{ restaurant: 1, created: 1 }],
  ],
  vendor_events: [
    [{ restaurant: 1, id: 1 }, unique],
    [{ restaurant: 1, request: 1, sequence: 1 }, unique],
  ],
  vendor_edits: [[{ restaurant: 1, id: 1 }, unique]],
  phone_accounts: [[{ uid: 1 }, unique]],
  phone_challenges: [
    [{ phone: 1, created: 1 }],
    [{ ip: 1, created: 1 }],
    [{ expiresAt: 1 }, { expireAfterSeconds: 0 }],
  ],
  phone_sessions: [[{ expiresAt: 1 }, { expireAfterSeconds: 0 }]],
};

async function installCoreCollections(db) {
  for (const [name, schema] of Object.entries(collections)) {
    try {
      await db.createCollection(name, { validator: { $jsonSchema: schema } });
    } catch (error) {
      if (error.code !== 48) throw error;
      try {
        await db.command({ collMod: name, validator: { $jsonSchema: schema } });
      } catch (error) {
        // The v1 bills validator already permits the optional v2 fields.
        // Keep it when Atlas denies changes to the collection validator.
        if (
          name !== 'bills' ||
          error.code !== 8000 ||
          error.codeName !== 'AtlasError' ||
          !error.message.includes('not allowed to do action [collMod]')
        ) throw error;
      }
    }
    for (const [keys, options] of indexes[name] || []) await db.collection(name).createIndex(keys, options);
  }
}

export async function ensureSchema(db) {
  const history = db.collection('schema_versions');
  const latest = await history.find().sort({ _id: -1 }).limit(1).next();
  if (latest?._id > 3) throw Error('This database requires a newer Pankti server.');
  if (latest?._id === 3) return;
  if (!latest || latest._id < 2) await installCoreCollections(db);
  await history.updateOne({ _id: 1 }, { $setOnInsert: { appliedAt: new Date() } }, { upsert: true });
  await history.updateOne({ _id: 2 }, { $setOnInsert: { appliedAt: new Date() } }, { upsert: true });
  const transcript = object({
    _id: string, owner: optionalText, restaurant: optionalText,
    task: { enum: ['signup', 'onboarding', 'menu', 'order', 'phrase', 'vendor', 'vendorEdit'] },
    transcript: string, createdAt: { bsonType: 'date' },
  });
  try {
    await db.createCollection('voice_transcripts', { validator: { $jsonSchema: transcript } });
  } catch (error) {
    if (error.code !== 48) throw error;
  }
  const archive = db.collection('voice_transcripts');
  await archive.createIndex({ owner: 1, createdAt: -1 });
  await archive.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  await history.updateOne({ _id: 3 }, { $setOnInsert: { appliedAt: new Date() } }, { upsert: true });
}
