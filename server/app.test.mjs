import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import QRCode from 'qrcode';
import sharp from 'sharp';
import { createApp } from './app.mjs';

async function start(t, options) {
  const application = createApp({
    verify: async (token) => (['owner', 'other'].includes(token) ? token : null),
    database: ':memory:',
    ...options,
  });
  const server = application.app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => server.once('listening', resolve).once('error', reject));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    application.close();
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
  const directory = await mkdtemp(join(tmpdir(), 'pankti-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const database = join(directory, 'test.sqlite');
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
