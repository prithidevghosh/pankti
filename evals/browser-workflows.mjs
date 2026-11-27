import { chromium } from 'playwright-core';
import { createApp } from '../server/app.mjs';
import { testDatabase } from '../server/test-database.mjs';
import express from 'express';
import assert from 'node:assert/strict';
const cleanup = [];
const { name } = await testDatabase({ after: (f) => cleanup.push(f) });
let action;
const { app, close } = await createApp({
  database: name,
  localPhoneOnly: true,
  speech: async (file) => {
    assert.ok(file.size);
    return 'browser test';
  },
  understand: async (task, t, ctx) => {
    if (task === 'phrase')
      return { name: 'Office set', lines: [{ item: ctx.menu[0].id, quantity: 1 }], question: action === 'clarify' ? 'Should this include the half portion?' : null };
    if (action === 'pay')
      return {
        lines: [],
        payment: { number: 1, method: null, due: 20000, received: null, additional: null },
      };
    assert.equal(ctx.phrases[0].name, 'Office set');
    return {
      lines: [{ ...ctx.phrases[0].lines[0], note: 'Less onion; chilli on the side.' }],
      question: null,
    };
  },
});
app.use(express.static('apps/web/dist'));
const server = app.listen(0, '127.0.0.1');
await new Promise((r) => server.once('listening', r));
const origin = 'http://localhost:' + server.address().port;
const browser = await chromium.launch({
  channel: process.env.PANKTI_BROWSER_CHANNEL || undefined,
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
});
try {
  for (const width of [1280, 390]) {
    action = 'order';
    const page = await browser.newPage({ viewport: { width, height: 844 }, permissions: ['microphone'] });
    await page.request.post(origin + '/api/auth/signup', {
      data: {
        phone: '+91900000' + String(width).padStart(4, '0'),
        name: 'QA',
        businessName: 'QA Counter',
        client: 'web',
      },
    });
    await page.request.post(origin + '/api/menu', {
      data: [{ name: 'Chole', category: 'Mains', variant: '', price: 30000 }],
    });
    async function speak(label) {
      await page.getByRole('button', { name: label, exact: true }).click();
      const finish = page.getByRole('button', { name: 'Finish recording', exact: true });
      await finish.waitFor();
      await page.waitForTimeout(350);
      await finish.click();
    }
    await page.goto(origin + '/#profile');
    const profile = page.locator('.account-details');
    await profile.getByText('QA Counter', {exact:true}).waitFor();
    assert.ok(await profile.getByText('+91900000' + String(width).padStart(4, '0')).isVisible());
    await page.getByRole('button', { name: 'Edit details' }).click();
    await page.getByLabel('Name', {exact:true}).fill('Mira Sen');
    await page.getByLabel('Business name').fill('Corner Kitchen');
    await page.getByLabel('City').fill('Kolkata');
    assert.equal(await profile.locator('input').count(), 3);
    await page.getByRole('button', { name:'Save changes' }).click();
    await page.getByText('Profile saved.').waitFor();
    await page.reload();
    await profile.getByText('Mira Sen').waitFor();
    await profile.getByText('Kolkata').waitFor();
    await page.getByRole('link', {name:'Overview', exact:true}).click();
    await page.locator('.restaurant-name').getByText('Kolkata').waitFor();
    await page.getByRole('link', {name:'Menu',exact:true}).click();
    action = 'clarify';
    await speak('Teach a phrase');
    const review = page.locator('.phrase-review');
    await review.getByText('Should this include the half portion?').waitFor();
    assert.equal(await review.getByRole('button', { name: 'Save phrase' }).isEnabled(), false);
    assert.ok(await review.evaluate(el => el.scrollWidth <= el.clientWidth));
    action = 'order';
    await speak('Answer by voice');
    await page.getByRole('button', { name: 'Save phrase' }).click();
    await page.getByText('Phrase saved.').waitFor();
    await page.getByRole('link', { name: 'Orders' }).click();
    await speak('Speak order');
    await page.getByText('Less onion; chilli on the side.').waitFor();
    await page.getByRole('button', { name: /Create bill/ }).click();
    const dialog = page.locator('dialog');
    await dialog.getByText('Less onion; chilli on the side.').waitFor();
    await page.getByRole('button', { name: 'Close bill' }).click();
    action = 'pay';
    await speak('Speak order');
    await dialog.getByLabel('Total received').waitFor();
    assert.equal(await dialog.getByLabel('Total received').inputValue(), '100');
    assert.equal(await dialog.getByRole('button', { name: 'Save payment' }).isEnabled(), false);
    await dialog.getByLabel('Payment method').selectOption('cash');
    await dialog.getByRole('button', { name: 'Save payment' }).click();
    await dialog.getByText(/Partially paid/).waitFor();
    await dialog.getByRole('button', { name: 'Edit payment' }).click();
    await dialog.getByLabel('Total received').fill('150');
    await dialog.getByRole('button', { name: 'Save payment' }).click();
    await dialog.getByText(/Partially paid.*150/).waitFor();
    assert.ok(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth));
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: '#0001', exact: true }).click();
    await dialog.getByText(/Partially paid.*150/).waitFor();
    await page.close();
    console.log(width, 'voice controls, phrase, note, partial payment, persistence passed');
  }
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
  await close();
  for (const f of cleanup) await f();
}
