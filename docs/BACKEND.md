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

The Vercel project builds the web workspace and serves the Express API under `/api` on the same domain. Production deploys from the GitHub repository's `main` branch. Keep `MONGODB_URI` and the provider credentials in the Vercel environment. See the [credential guide](CREDENTIALS.md) for Twilio Verify, Sarvam, and OpenAI setup. Verify the deployment by opening the homepage and checking that `GET /api/health` returns `{"status":"ok"}`. Keep multipart requests below [Vercel's default 4.5 MB request limit](https://vercel.com/docs/functions/limitations).

For a temporary phone-only deployment, set `APP_AUTH_MODE=phone-only` in the Vercel environment and redeploy. This uses the database selected by `MONGODB_LOCAL_DATABASE`. To restore verified sign-in, remove `APP_AUTH_MODE`, configure Twilio Verify, and redeploy.

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

The workspace returns the authenticated owner's profile alongside the restaurant. MongoDB schema v3 adds `voice_transcripts` with the owner ID, restaurant ID when available, task, transcript, and capture timestamp. The API writes text after transcription and before interpretation, including clarification replies. Audio is processed in memory. Signup transcripts expire after 24 hours unless the registering client claims them in the signup transaction.

Restaurant settings use `gstBps` (basis points, default 0). When issuing a bill the server sums the rounded line amounts, rounds GST once to the nearest paise, and saves `subtotal`, `gstBps`, `gstAmount`, and the tax-inclusive `total` together. Older bills without tax fields retain their original totals.

Menu items may have a `soldOutDay` (YYYY-MM-DD in Asia/Kolkata). Only a match with the current business date disables ordering. Restocking clears the field. Manual and voice changes use the same restaurant-scoped transaction, and bill creation rechecks availability.

Supplier invoices are stored in `vendor_invoices`, scoped by restaurant, with the source attachment, extracted rows, and latest spoken delivery check. Re-uploading the same bytes reopens the invoice. Each check records its transcript and compares ordered, received and billed measurements; a revision check protects simultaneous reviews. Checking a delivery does not post a purchase or change vendor balances.

Overview conversation startup checks server credentials via `POST /api/overview/live`. A microphone worklet detects speech and sends each turn as WAV to the authenticated `/overview/live/report` endpoint. Sarvam Saaras v4 transcribes the original language, using automatic detection or the owner's language selection. All 23 input locales have written replies. The 11 Bulbul locales also have spoken playback. Text-only turns retain the saved report ID for follow-ups. A structured planner selects shop fields and a date window. The server renders recorded values with fixed localized labels and returns a scoped redirect for unsupported questions. The speech endpoint takes only a saved answer ID and verifies shop ownership before calling Sarvam. The browser plays the reply, listens for interruptions and releases the microphone when the call ends. Explicit spoken dates override the selected India reporting window. Sales and dish quantities use issued bills; paid, partial, unpaid and outstanding describe the current payment state of those bills. Collections use payment movement dates. Supplier balances and menu availability are current snapshots. The restaurant-scoped `overview_questions` collection stores the transcribed report question and factual answer. The earlier single-question endpoint stores its transcript and answer there as well.
