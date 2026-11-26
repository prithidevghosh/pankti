CREATE TABLE IF NOT EXISTS restaurants (
  id TEXT PRIMARY KEY, owner TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
  city TEXT NOT NULL, qr TEXT, payee TEXT
);
CREATE TABLE IF NOT EXISTS menu (
  id TEXT PRIMARY KEY, restaurant TEXT NOT NULL REFERENCES restaurants(id),
  name TEXT NOT NULL, variant TEXT NOT NULL, category TEXT NOT NULL,
  price INTEGER NOT NULL CHECK(price > 0), label_key TEXT NOT NULL,
  UNIQUE(restaurant, label_key)
);
CREATE TABLE IF NOT EXISTS bills (
  id TEXT PRIMARY KEY, restaurant TEXT NOT NULL REFERENCES restaurants(id),
  number INTEGER NOT NULL, request TEXT NOT NULL, created TEXT NOT NULL,
  total INTEGER NOT NULL, paid TEXT, method TEXT,
  UNIQUE(restaurant, number), UNIQUE(restaurant, request)
);
CREATE TABLE IF NOT EXISTS lines (
  bill TEXT NOT NULL REFERENCES bills(id), item TEXT NOT NULL REFERENCES menu(id),
  name TEXT NOT NULL, variant TEXT NOT NULL, price INTEGER NOT NULL,
  quantity INTEGER NOT NULL CHECK(quantity > 0), PRIMARY KEY(bill, item)
);
CREATE TABLE IF NOT EXISTS vendor_events (
  id INTEGER PRIMARY KEY, restaurant TEXT NOT NULL REFERENCES restaurants(id),
  request TEXT NOT NULL, sequence INTEGER NOT NULL, created TEXT NOT NULL,
  vendor TEXT NOT NULL, vendor_key TEXT NOT NULL, kind TEXT NOT NULL,
  note TEXT NOT NULL, amount INTEGER NOT NULL, delta INTEGER NOT NULL,
  UNIQUE(restaurant, request, sequence)
);
CREATE TABLE IF NOT EXISTS vendor_edits (
  id INTEGER PRIMARY KEY, restaurant TEXT NOT NULL REFERENCES restaurants(id),
  event INTEGER NOT NULL REFERENCES vendor_events(id), details TEXT NOT NULL, created TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS bill_paid ON bills(restaurant, paid);
CREATE TABLE IF NOT EXISTS phone_accounts (
  phone TEXT PRIMARY KEY, uid TEXT NOT NULL UNIQUE, disabled INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS local_signup_profiles (
  uid TEXT PRIMARY KEY REFERENCES phone_accounts(uid), name TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS phone_auth_config (
  key TEXT PRIMARY KEY
);
CREATE TABLE IF NOT EXISTS phone_challenges (
  id TEXT PRIMARY KEY, phone TEXT NOT NULL, ip TEXT NOT NULL, created INTEGER NOT NULL,
  sid TEXT, attempts INTEGER NOT NULL DEFAULT 0, checking INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS phone_challenges_phone ON phone_challenges(phone, created);
CREATE INDEX IF NOT EXISTS phone_challenges_ip ON phone_challenges(ip, created);
CREATE TABLE IF NOT EXISTS phone_sessions (
  token_hash TEXT PRIMARY KEY, uid TEXT NOT NULL REFERENCES phone_accounts(uid),
  expires INTEGER NOT NULL
);
