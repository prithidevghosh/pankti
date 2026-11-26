# Backend and database

Android and web share the Express API. Only the server connects to MongoDB. Browser clients use an HTTP-only cookie and Android sends a bearer token. The server resolves the restaurant from the authenticated owner before accessing its records.

## Run MongoDB locally

The local API expects MongoDB on port 27117. With MongoDB Community Server and mongosh installed, run this from the project root in a dedicated terminal. Reuse the same data directory after a restart.

```sh
mkdir -p .data/mongo
mongod --dbpath .data/mongo --bind_ip 127.0.0.1 --port 27117 --replSet pankti
```

For a **new** local data directory, initialize the replica set once from a second terminal. Wait until the shell reports a writable primary before starting the app.

```sh
mongosh --port 27117 --eval 'rs.initiate({_id:"pankti",members:[{_id:0,host:"localhost:27117"}]})'
mongosh --port 27117 --eval 'db.hello().isWritablePrimary'
npm run api
```

The default connection is local and unauthenticated. For hosted use, set the server-side `MONGODB_URI` to an authenticated replica set connection string and configure backups. `MONGODB_DATABASE` selects the verified-phone database. `MONGODB_LOCAL_DATABASE` selects the separate phone-only development database. Keep these names distinct. Transactions require a replica set or sharded cluster. Run `npm test` with the local replica set available. The tests create and clean up randomly named databases.

## API and service boundaries

| Workflow | Endpoints under /api | Implementation |
| --- | --- | --- |
| Identity | auth/signup, auth/login, auth/send, auth/verify, auth/session, auth/logout | phone-auth.mjs handles sessions and verification. phone-store.mjs persists identity and rate limits. |
| Voice drafts | POST signup/voice, POST voice/:task | services/voice.mjs builds restaurant-specific context and resolves order and vendor intent. providers.mjs connects to speech and interpretation services. |
| Restaurant, menu and QR | GET/POST workspace, POST menu, POST menu/scan, PUT menu/:id, POST qr/preview, PUT qr | app.mjs validates requests. The store scopes persisted changes to the owner's restaurant. |
| Billing and analytics | POST bills, GET bills/:id, POST bills/:id/payment, GET analytics | routes/bills.mjs serves the receipt and reporting contracts. |
| Vendor ledger | GET/POST vendors, POST vendors/:id/preview, PUT vendors/:id | routes/vendors.mjs validates changes. vendor-edits.mjs computes balances and previews from immutable events and corrections. |

## Schema and consistency

The database validators, required fields, indexes and schema version are in `server/db/schema.mjs`. Schema initialization finishes before the API listens. For the next schema change, add a new numbered migration step, handle upgrades from the preceding version, and record completion only after applying and testing the change on populated data. Older releases refuse databases with a newer version.

Bills embed an ordered snapshot of menu names, portions and prices. Prices and totals are integer paise. Quantities allow quarter portions. Unique indexes protect bill numbers and request IDs per restaurant. Multi-document transactions cover bill issuance, menu imports, vendor corrections and signup. Payment recording uses a conditional update. Analytics uses the Asia/Kolkata business date.

Vendor events and corrections retain their original IDs. Each restaurant has separate numbering for bills and vendor activity. Phone sessions store token hashes and expiry dates. Expiry is enforced during lookup, independently of MongoDB's asynchronous TTL cleanup.

## Import an existing installation

Stop the old API to pause writes. Keep a backup containing the SQLite file and any matching WAL files. Run the importer for each source into its own empty MongoDB database.

```sh
npm run db:import-sqlite -- .data/pankti-local-signup.sqlite pankti_local_signup
npm run db:import-sqlite -- .data/pankti.sqlite pankti
```

The offline importer opens the source read-only, preserves account and session identities, embeds historical receipt lines, and initializes counters from the imported history. It compares the transferred documents field by field before committing. It rejects existing target records and previously completed imports. The import uses one transaction and is intended for prototype-sized datasets. Start the MongoDB-backed API and check an existing account's workspace, vendor ledger and analytics before archiving the old files.
