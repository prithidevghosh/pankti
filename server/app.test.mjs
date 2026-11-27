import test from 'node:test';
import assert from 'node:assert/strict';
import { testDatabase } from './test-database.mjs';
import { randomUUID } from 'node:crypto';
import QRCode from 'qrcode';
import sharp from 'sharp';
import { createApp } from './app.mjs';

async function start(t, options = {}) {
  const application = await createApp({
    verify: async (token) => (['owner', 'other'].includes(token) ? token : null),
    database: options.database ?? (await testDatabase(t)).name,
    ...options,
  });
  const server = application.app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => server.once('listening', resolve).once('error', reject));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await application.close();
  });
  return async function call(path, { token = 'owner', method = 'GET', body, status = 200 } = {}) {
    const headers = token ? { Authorization: 'Bearer ' + token } : {};
    if (body && !(body instanceof FormData)) headers['Content-Type'] = 'application/json';
    const response = await fetch('http://127.0.0.1:' + server.address().port + '/api' + path, {
      headers,
      method,
      body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
    });
    const result = await response.json();
    assert.equal(response.status, status, JSON.stringify(result));
    return result;
  };
}
const restaurant = { name: 'The Corner Counter', city: 'Kolkata' };
const samosa = { name: 'Samosa', category: 'Snacks', variant: '', price: 1900 };

test('voice order goes through billing, records payment once and appears in owner analytics', async (t) => {
  const { name: database, db } = await testDatabase(t);
  const call = await start(t, {
    database,
    speech: async (file, terms) => {
      assert.equal(file.mimetype, 'audio/mp4');
      return terms.length ? 'do samosa, nahi ek samosa' : 'restaurant details';
    },
    understand: async (task, transcript, context) => {
      if (task === 'onboarding') return { ...restaurant, question: null };
      if (task === 'menu') return { entries: [samosa], question: null };
      assert.equal(transcript, 'do samosa, nahi ek samosa');
      return { lines: [{ item: context.menu[0].id, quantity: 1 }], question: null, readyToBill: false };
    },
  });
  const record = (task) => {
    const data = new FormData();
    data.append('audio', new Blob(['local provider test input'], { type: 'audio/mp4' }), 'recording.m4a');
    return call('/voice/' + task, { method: 'POST', body: data });
  };
  await call('/workspace', { token: null, status: 401 });
  assert.equal((await call('/workspace')).restaurant, null);
  const { result: proposed } = await record('onboarding');
  const { restaurant: saved } = await call('/workspace', {
    method: 'POST',
    body: { name: proposed.name, city: proposed.city },
  });
  assert.equal(saved.name, restaurant.name);
  const { result: draftMenu } = await record('menu');
  const { menu } = await call('/menu', { method: 'POST', body: draftMenu.entries });
  assert.equal(menu[0].price, 1900);
  const { result: draft } = await record('order');
  assert.equal(await db.collection('voice_transcripts').countDocuments({ owner: 'owner' }), 3);
  assert.equal((await db.collection('voice_transcripts').findOne({ restaurant: saved.id, task: 'order' })).transcript, 'do samosa, nahi ek samosa');
  const body = { request: randomUUID(), basket: draft.lines };
  const { bill } = await call('/bills', { method: 'POST', status: 201, body });
  assert.equal(bill.lines[0].quantity, 1);
  assert.equal(bill.total, 1900);
  assert.equal((await call('/workspace')).pendingBill.id, bill.id);
  assert.equal((await call('/bills', { method: 'POST', status: 201, body })).bill.id, bill.id);
  assert.equal((await call('/analytics')).revenue, 0);
  const first = await call('/bills/' + bill.id + '/payment', { method: 'POST', body: { method: 'cash' } });
  const second = await call('/bills/' + bill.id + '/payment', { method: 'POST', body: { method: 'cash' } });
  assert.equal(first.bill.paid, second.bill.paid);
  await call('/bills/' + bill.id + '/payment', { method: 'POST', body: { method: 'upi' }, status: 409 });
  const stats = await call('/analytics');
  assert.equal(stats.revenue, 1900);
  assert.equal(stats.paidCount, 1);
  assert.equal(stats.orders, 1);
  assert.equal(stats.items[0].quantity, 1);
  const restarted = await start(t, { database });
  assert.equal((await restarted('/analytics')).revenue, 1900);
  await call('/workspace', { method: 'POST', body: { name: 'Other Counter', city: 'Pune' }, token: 'other' });
  const separate = await call('/analytics', { token: 'other' });
  assert.equal(separate.revenue, 0);
  await call('/bills/' + bill.id, { token: 'other', status: 404 });
});

test('detects a reusable UPI code on a photographed card and saves only the QR', async (t) => {
  const call = await start(t);
  await call('/workspace', { method: 'POST', body: restaurant });
  const payload = 'upi://pay?pa=counter%40upi&pn=The%20Counter';
  const qr = await QRCode.toBuffer(payload, { width: 250 });
  const card = await sharp({ create: { width: 480, height: 610, channels: 3, background: '#d4b985' } })
    .composite([{ input: qr, left: 100, top: 155 }])
    .jpeg()
    .toBuffer();
  const form = new FormData();
  form.append('photo', new Blob([card], { type: 'image/jpeg' }), 'card.jpg');
  const preview = await call('/qr/preview', { method: 'POST', body: form });
  assert.equal(preview.uri, payload);
  assert.equal(preview.payee, 'The Counter');
  assert.match(preview.image, /^data:image\/png;base64,/);
  await call('/qr', { method: 'PUT', body: { uri: preview.uri } });
  assert.equal((await call('/workspace')).restaurant.qr, preview.image);
});

test('editing an imported menu keeps its ID and fractional bills retain their original price', async (t) => {
  const call = await start(t, { scan: async () => [{ ...samosa, price: null }] });
  await call('/workspace', { method: 'POST', body: restaurant });
  const photo = new FormData();
  photo.append('photo', new Blob(['image']), 'menu.jpg');
  const scan = await call('/menu/scan', { method: 'POST', body: photo });
  assert.equal(scan.entries[0].price, null);
  const { menu } = await call('/menu', { method: 'POST', body: [{ ...scan.entries[0], price: 30001 }] });
  const item = menu[0].id;
  const { bill } = await call('/bills', {
    method: 'POST',
    status: 201,
    body: { request: randomUUID(), basket: [{ item, quantity: 0.5 }] },
  });
  assert.equal(bill.total, 15001);
  const updated = await call('/menu/' + item, {
    method: 'PUT',
    body: { ...samosa, name: 'Renamed samosa', price: 28000 },
  });
  await call('/bills', {
    method: 'POST',
    status: 409,
    body: { request: randomUUID(), basket: [{ item, quantity: 1 }], prices: { [item]: 30001 } },
  });
  assert.equal(updated.menu.length, 1);
  assert.equal(updated.menu[0].id, item);
  assert.equal((await call('/bills/' + bill.id)).bill.lines[0].price, 30001);
});

test('supplier orders, purchases, partial payments and balances post once and stay private', async (t) => {
  const call = await start(t);
  for (const token of ['owner', 'other'])
    await call('/workspace', { method: 'POST', token, body: restaurant });
  const entries = [
    ['order', 100000],
    ['purchase', 80000],
    ['payment', 30000],
  ].map(([kind, amount]) => ({ kind, amount, vendor: 'Mohan', note: 'Potatoes' }));
  const body = { request: randomUUID(), entries };
  await call('/vendors', { method: 'POST', body });
  const ledger = await call('/vendors', { method: 'POST', body });
  assert.equal(ledger.events.length, 3);
  assert.equal(ledger.balances[0].due, 50000);
  const adjustment = await call('/vendors', {
    method: 'POST',
    body: { request: randomUUID(), entries: [{ ...entries[0], kind: 'balance', amount: 25000 }] },
  });
  assert.equal(adjustment.balances[0].due, 25000);
  assert.deepEqual((await call('/vendors', { token: 'other' })).events, []);
});

test('vendor corrections preview and replay balances without double charging or overwriting concurrent edits', async (t) => {
  const call = await start(t);
  for (const token of ['owner', 'other'])
    await call('/workspace', { method: 'POST', token, body: restaurant });
  const { revision, events } = await call('/vendors', {
    method: 'POST',
    body: {
      request: randomUUID(),
      entries: [
        { vendor: 'Mohan', kind: 'purchase', amount: 80000, note: 'Potatoes' },
        { vendor: 'Mohan', kind: 'payment', amount: 30000, note: 'Cash' },
      ],
    },
  });
  const purchase = events.find((e) => e.kind === 'purchase');
  assert.equal(purchase.paid, 30000);
  const details = { vendor: 'Mohan Foods', note: 'Potatoes', amount: 90000, paid: 90000 };
  const path = '/vendors/' + purchase.id;
  const preview = await call(path + '/preview', { method: 'POST', body: { revision, details } });
  assert.deepEqual(preview.balances, [{ vendor: 'Mohan Foods', due: 0 }]);
  assert.equal((await call('/vendors')).balances[0].due, 50000);
  await call(path, { method: 'PUT', token: 'other', body: { revision, details }, status: 404 });
  const saved = await call(path, { method: 'PUT', body: { revision, details } });
  assert.equal(saved.events.find((e) => e.kind === 'payment').paid, 90000);
  await call(path, { method: 'PUT', body: { revision, details }, status: 409 });
  const reset = await call('/vendors', {
    method: 'POST',
    body: {
      request: randomUUID(),
      entries: [{ vendor: 'Mohan Foods', kind: 'balance', amount: 5000, note: 'Reconciled' }],
    },
  });
  const replay = await call(path, {
    method: 'PUT',
    body: { revision: reset.revision, details: { ...details, paid: 0 } },
  });
  assert.equal(replay.balances[0].due, 5000);
});
