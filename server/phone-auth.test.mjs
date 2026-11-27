import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { testDatabase } from './test-database.mjs';
import { createApp } from './app.mjs';
import { openStore } from './store.mjs';
import { twilioVerify } from './phone-auth.mjs';

test('Firebase import keeps existing owner data available through web and Android Twilio sessions', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'pankti-auth-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const { name: database, db } = await testDatabase(t);
  const phone = '+919876543210';
  const owner = 'firebase-existing-owner';
  const store = await openStore(database);
  const restaurant = await store.createRestaurant(owner, 'Original Counter', 'Kolkata');
  const [item] = await store.saveMenu(restaurant.id, [
    { name: 'Tea', variant: '', category: 'Drinks', price: 1500 },
  ]);
  const bill = await store.createBill(restaurant.id, randomUUID(), [{ item: item.id, quantity: 2 }]);
  await store.markPaid(restaurant.id, bill.id, 'cash');
  await store.close();

  const service = 'VA' + '1'.repeat(32);
  const key = 'SK' + '2'.repeat(32);
  const sid = 'VE' + '3'.repeat(32);
  let sends = 0;
  const otp = twilioVerify(
    {
      TWILIO_VERIFY_SERVICE_SID: service,
      TWILIO_API_KEY_SID: key,
      TWILIO_API_KEY_SECRET: 'test-secret',
    },
    async (url, request) => {
      assert.ok(url.startsWith('https://verify.twilio.com/v2/Services/' + service));
      assert.equal(
        request.headers.Authorization,
        'Basic ' + Buffer.from(key + ':test-secret').toString('base64'),
      );
      if (url.endsWith('/Verifications')) {
        assert.deepEqual(Object.fromEntries(request.body), { To: phone, Channel: 'sms' });
        sends++;
        return Response.json({ status: 'pending', sid, to: phone });
      }
      assert.ok(url.endsWith('/VerificationCheck'));
      assert.equal(request.body.get('To'), phone);
      return Response.json({
        status: request.body.get('Code') === '123456' ? 'approved' : 'pending',
        sid,
        to: phone,
      });
    },
  );
  const app = await createApp({ database, otp, requireLegacyImport: true });
  const server = app.app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => server.once('listening', resolve).once('error', reject));
  try {
    async function call(path, { body, cookie, token, status = 200 } = {}) {
      const headers = {};
      if (body) headers['Content-Type'] = 'application/json';
      if (cookie) headers.Cookie = cookie;
      if (token) headers.Authorization = 'Bearer ' + token;
      const res = await fetch('http://127.0.0.1:' + server.address().port + '/api' + path, {
        method: body ? 'POST' : 'GET',
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });
      const result = await res.json();
      assert.equal(res.status, status, JSON.stringify(result));
      return { result, cookie: res.headers.get('set-cookie') };
    }

    await call('/auth/send', { body: { phone }, status: 503 });
    assert.equal(sends, 0);
    const file = join(directory, 'users.json');
    const importAccounts = (users) =>
      writeFile(file, JSON.stringify({ users })).then(() =>
        promisify(execFile)(process.execPath, ['server/import-firebase-accounts.mjs', file], {
          env: { ...process.env, MONGODB_DATABASE: database },
        }),
      );
    await assert.rejects(importAccounts([]), /existing accounts are migrated/);
    await importAccounts([{ localId: owner, phoneNumber: phone }]);
    await assert.rejects(importAccounts([{ localId: 'different-owner', phoneNumber: phone }]), /conflicts/);

    const {
      result: { challenge },
    } = await call('/auth/send', { body: { phone } });
    await call('/auth/send', { body: { phone }, status: 429 });
    await call('/auth/verify', { body: { challenge, code: '000000', client: 'web' }, status: 400 });
    const web = await call('/auth/verify', { body: { challenge, code: '123456', client: 'web' } });
    assert.deepEqual(web.result, { authenticated: true });
    assert.match(web.cookie, /HttpOnly/);
    assert.match(web.cookie, /SameSite=Strict/);
    const cookie = web.cookie.split(';')[0];
    await call('/auth/verify', { body: { challenge, code: '123456', client: 'android' }, status: 409 });
    const workspace = await call('/workspace', { cookie });
    assert.equal(workspace.result.restaurant.id, restaurant.id);
    assert.equal(workspace.result.menu[0].id, item.id);
    assert.equal((await call('/bills/' + bill.id, { cookie })).result.bill.method, 'cash');

    await db.collection('phone_challenges').updateMany({}, { $inc: { created: -31000 } });
    const android = await call('/auth/send', { body: { phone } });
    const {
      result: { token },
    } = await call('/auth/verify', {
      body: { challenge: android.result.challenge, code: '123456', client: 'android' },
    });
    assert.equal((await call('/workspace', { token })).result.restaurant.id, restaurant.id);
    await call('/auth/logout', { body: {}, cookie });
    await call('/workspace', { cookie, status: 401 });
    assert.equal((await call('/workspace', { token })).result.restaurant.id, restaurant.id);
    await call('/auth/logout', { body: {}, token });
    await call('/workspace', { token, status: 401 });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await app.close();
  }
});

test('local phone signup shares a workspace across clients without exposing verified accounts', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'pankti-local-auth-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const { name: database, db } = await testDatabase(t);
  const phone = '+919000000001';
  const verifiedPhone = '+919000000002';
  const store = await openStore(database);
  await store.importPhoneAccounts([{ phone: verifiedPhone, uid: 'verified-owner', disabled: false }]);
  await store.createRestaurant('verified-owner', 'Existing Counter', 'Mumbai');
  await store.close();

  const application = await createApp({
    database,
    localPhoneOnly: true,
    speech: async (recording) => {
      assert.equal(recording.mimetype, 'audio/webm');
      return 'Spoken signup';
    },
    understand: async (task, transcript) => {
      assert.equal(task, 'signup');
      assert.equal(transcript, 'Spoken signup');
      return { phone, name: 'Dev Kumar', businessName: 'Riverside Cafe' };
    },
  });
  const server = application.app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => server.once('listening', resolve).once('error', reject));
  try {
    const origin = 'http://127.0.0.1:' + server.address().port + '/api';
    const post = (path, body) =>
      fetch(origin + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    assert.equal((await post('/auth/login', { phone, client: 'android' })).status, 404);
    assert.equal((await post('/auth/login', { phone: verifiedPhone, client: 'web' })).status, 404);
    assert.equal((await post('/auth/send', { phone })).status, 404);

    const audio = new FormData();
    audio.append('audio', new Blob(['audio fixture'], { type: 'audio/webm' }), 'signup.webm');
    const draftResponse = await fetch(origin + '/signup/voice', { method: 'POST', body: audio });
    assert.equal(draftResponse.status, 200);
    const draft = await draftResponse.json();
    assert.ok(draft.noteId);
    assert.deepEqual(draft, { noteId: draft.noteId, phone, name: 'Dev Kumar', businessName: 'Riverside Cafe' });

    const created = await post('/auth/signup', { ...draft, signupNotes: [draft.noteId], client: 'web' });
    assert.equal(created.status, 200);
    const cookie = created.headers.get('set-cookie').split(';')[0];
    const web = await fetch(origin + '/workspace', { headers: { Cookie: cookie } }).then((res) => res.json());
    assert.equal(web.restaurant.name, 'Riverside Cafe');
    assert.deepEqual(web.profile, { name: 'Dev Kumar', phone });
    const storedNote = await db.collection('voice_transcripts').findOne({ _id: draft.noteId });
    assert.equal(storedNote.owner, (await db.collection('phone_accounts').findOne({ _id: phone })).uid);
    assert.equal(storedNote.transcript, 'Spoken signup');

    const attemptPhoneEdit = await fetch(origin + '/profile', {
      method: 'PUT', headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: verifiedPhone, name: 'Dev', businessName: 'Cafe', city: '' }),
    });
    assert.equal(attemptPhoneEdit.status, 400);
    const login = await post('/auth/login', { phone, client: 'android' });
    assert.equal(login.status, 200);
    const { token } = await login.json();
    const mobile = await fetch(origin + '/workspace', { headers: { Authorization: 'Bearer ' + token } }).then(
      (res) => res.json(),
    );
    assert.equal(mobile.restaurant.id, web.restaurant.id);
    const verifiedStore = await openStore(database);
    try {
      assert.equal(await verifiedStore.phoneSessionOwner(token, true), null);
      const challenge = await verifiedStore.reservePhoneChallenge(phone, 'cutover-test', false);
      await verifiedStore.savePhoneChallenge(challenge, 'test-verification');
      await verifiedStore.claimPhoneChallenge(challenge);
      const verifiedToken = await verifiedStore.completePhoneChallenge(challenge, phone);
      const uid = await verifiedStore.phoneSessionOwner(verifiedToken, true);
      assert.equal((await verifiedStore.restaurantFor(uid)).id, web.restaurant.id);
    } finally {
      await verifiedStore.close();
    }
    assert.equal(
      (await post('/auth/signup', { ...draft, businessName: 'Renamed', client: 'android' })).status,
      409,
    );
    assert.equal(
      (await db.collection('local_signup_profiles').findOne({ name: draft.name })).name,
      draft.name,
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await application.close();
  }
});
