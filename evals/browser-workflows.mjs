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
  readAloud: async () => Buffer.from("RIFF").toString("base64"),
  readInvoice: async () => ({ vendor:'Shyam Dairy', number:'834', lines:[{name:'Paneer',quantity:10,unit:'kg',ratePaise:32000}] }),
  speech: async (file) => {
    assert.ok(file.size);
    return 'browser test';
  },
  understand: async (task, t, ctx) => {
    if (task === 'overview') return {period:'today',days:1,start:null,end:null,language:'en-IN',
      metrics:[{key:'billedSales',label:'Billed sales'},{key:'partialCount',label:'Part-paid bills'}],empty:'None',clarification:null};
    if (task === 'deliveryClaim') return {claims:[{line:0,name:'Paneer',ordered:{quantity:10,unit:'kg'},received:{quantity:9,unit:'kg'}}]};
    if (task === 'menu') return { entries: [], question: null, availability: [{ item: ctx.menu[0].id, available: false }] };
    if (task === 'phrase')
      return { name: 'Office set', lines: [{ item: ctx.menu[0].id, quantity: 1 }], question: action === 'clarify' ? 'Should this include the half portion?' : null };
    if (action === 'revise') {
      assert.equal(ctx.basket[0].quantity, 1);
      assert.equal(ctx.orderNote, 'Extra onion on the side');
      return { lines: [{ ...ctx.basket[0], quantity: 3 }], orderNote: ctx.orderNote, question: null };
    }
    if (action === 'pay')
      return {
        lines: [],
        payment: { number: 1, method: null, due: 20000, received: null, additional: null },
      };
    assert.equal(ctx.phrases[0].name, 'Office set');
    return {
      orderNote: 'Extra onion on the side',
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
    await page.getByLabel('GST per order (%)').fill('5');
    await page.getByRole('button', { name:'Save changes' }).click();
    await page.getByText('Profile saved.').waitFor();
    await page.reload();
    await profile.getByText('Mira Sen').waitFor();
    await profile.getByText('Kolkata').waitFor();
    await profile.getByText('5%', { exact: true }).waitFor();
    await page.getByRole('link', {name:'Overview', exact:true}).click();
    await page.locator('.restaurant-name').getByText('Kolkata').waitFor();
    await page.getByRole('link', {name:'Menu',exact:true}).click();
    const stock = page.getByRole('switch', {name: /Chole.*available today/});
    await speak('Dictate dishes');
    await page.getByText('Chole · Sold out today').waitFor();
    assert.equal(await stock.getAttribute('aria-checked'), 'false');
    await page.reload();
    await stock.click();
    await page.getByText('Chole is available again.').waitFor();
    assert.equal(await stock.getAttribute('aria-checked'), 'true');
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
    action = 'revise';
    await speak('Revise by voice');
    await page.getByRole('button', { name: /Create bill.*945/ }).waitFor();
    await page.getByRole('button', {name: 'Edit ticket'}).click();
    await page.getByLabel('Quantity for Chole').fill('1');
    await page.getByRole('button', {name: 'Apply changes'}).click();
    await page.getByRole('button', { name: /Create bill.*315/ }).click();
    const dialog = page.locator('dialog');
    await dialog.getByText('Less onion; chilli on the side.').waitFor();
    await dialog.getByText(/Extra onion on the side/).waitFor();
    await dialog.getByText('GST (5%)', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Close bill' }).click();
    action = 'pay';
    await speak('Speak order');
    await dialog.getByLabel('Total received').waitFor();
    assert.equal(await dialog.getByLabel('Total received').inputValue(), '115');
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
    await page.keyboard.press('Escape');
    await page.getByRole('link',{name:'Vendors',exact:true}).click();
    const source = Buffer.from('89504e470d0a1a0a','hex');
    await page.getByLabel('Vendor invoice',{exact:true}).setInputFiles({name:'dairy.png',mimeType:'image/png',buffer:source});
    await speak('Speak delivery details');
    const desk = page.getByRole('region',{name:'Check a delivery'});
    await desk.getByText(/1 kg short of invoice/).waitFor();
    await desk.getByText(/320.00 at the printed unit rate/).waitFor();
    const original = await page.request.get(origin + await desk.getByRole('link',{name:'Original bill'}).getAttribute('href'));
    assert.deepEqual(await original.body(),source);
    assert.ok(await desk.evaluate(el=>el.scrollWidth<=el.clientWidth));
    await page.reload();
    await desk.getByText(/1 kg short of invoice/).waitFor();
    if (process.env.PANKTI_QA_SCREENSHOTS) {
      await desk.evaluate(el=>el.scrollIntoView({block:'center',behavior:'instant'}));
      await desk.screenshot({path:process.env.PANKTI_QA_SCREENSHOTS+'/delivery-'+width+'.png'});
    }
    await page.getByRole('link',{name:'Overview',exact:true}).click();
    const conversation=page.getByRole('region',{name:'Business conversation'});
    await conversation.getByRole('button',{name:'Start conversation'}).waitFor();
    assert.ok(await conversation.evaluate(el=>el.scrollWidth<=el.clientWidth));
    if(process.env.PANKTI_QA_SCREENSHOTS)
      await conversation.screenshot({path:process.env.PANKTI_QA_SCREENSHOTS+'/conversation-'+width+'.png'});
    await page.route('**/api/overview/live',route=>route.fulfill({
      status:503,json:{error:'Voice temporarily unavailable.'}
    }));
    await conversation.getByRole('button',{name:'Start conversation'}).click();
    await conversation.getByRole('alert').waitFor();
    await conversation.getByRole('button',{name:'Start conversation'}).waitFor();
    await page.close();
    console.log(width, 'voice controls, phrase, note, partial payment, persistence passed');
  }
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
  await close();
  for (const f of cleanup) await f();
}
