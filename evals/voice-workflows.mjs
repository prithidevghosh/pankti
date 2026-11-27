// Live provider checks. Pass a directory of matching WAVs to include recognition.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { interpret, transcribe } from '../server/providers.mjs';
const menu = ['Butter Roti', 'Naan', 'Chole'].map((name, i) => ({
  name,
  variant: '',
  id: '00000000-0000-4000-8000-80000000000' + i,
}));
const context = {
  menu,
  basket: [],
  phrases: [
    {
      name: 'Office set',
      lines: [
        { item: menu[0].id, quantity: 2 },
        { item: menu[2].id, quantity: 1 },
      ],
    },
  ],
};
const paneer = { id: '00000000-0000-4000-8000-000000000003', name: 'Paneer Butter Masala', variant: '' };
const onion = { id: '00000000-0000-4000-8000-000000000004', name: 'Extra Onion', variant: '' };
const counterOrder = 'एक पनीर बटर मसाला दो बटर रोटी और एक्स्ट्रा प्याज़';
const cases = [
  ['sold-out', 'menu', 'आलू चना खत्म हो गई है, आलू पराठा खत्म हो गया है।', {
    menu: menu.map((item, i) => ({ ...item, name: ['Aloo Chana', 'Aloo Paratha', 'Dal Palak'][i] })),
  }, r => {
    assert.equal(r.question, null);
    assert.equal(r.entries.length, 0);
    assert.deepEqual(r.availability.map(c => [c.item, c.available]).sort(), [[menu[0].id, false], [menu[1].id, false]]);
  }],
  ['restock', 'menu', 'दाल पालक फिर से उपलब्ध है', {
    previous: [], menu: [{ ...menu[0], name: 'Dal Palak', soldOut: true }],
  }, r => {
    assert.equal(r.question, null);
    assert.equal(r.entries.length, 0);
    assert.deepEqual(r.availability, [{item: menu[0].id, available: true}]);
  }],
  ['order-side', 'order', counterOrder, { ...context, menu: [...menu, paneer] }, r => {
    assert.equal(r.question, null);
    assert.equal(r.lines.length, 2);
    assert.equal(r.lines.find(l => l.item === paneer.id)?.quantity, 1);
    assert.equal(r.lines.find(l => l.item === menu[0].id)?.quantity, 2);
    assert.match(r.orderNote, /onion|प्या[ज़ज]|pya+a?z/i);
  }],
  ['revise-count', 'order', 'नहीं तीन बटर रोटी', {
    ...context, menu: [...menu, paneer], orderNote: 'Extra onion on the side',
    basket: [{ item: paneer.id, quantity: 1 }, { item: menu[0].id, quantity: 2 }],
  }, r => {
    assert.equal(r.question, null);
    assert.equal(r.lines.length, 2);
    assert.equal(r.lines.find(l => l.item === menu[0].id)?.quantity, 3);
    assert.equal(r.lines.find(l => l.item === paneer.id)?.quantity, 1);
    assert.match(r.orderNote, /onion|प्या[ज़ज]|pya+a?z/i);
  }],
  ['priced-side', 'order', counterOrder, { ...context, menu: [...menu, paneer, onion] }, r => {
    assert.equal(r.question, null);
    assert.equal(r.lines.length, 3);
    assert.equal(r.lines.find(l => l.item === onion.id)?.quantity, 1);
  }],
  [
    'kitchen',
    'order',
    'तीन बटर रोटी, दो नान और एक छोले। छोले में प्याज़ कम डालना और साथ में एक हरी मिर्च एक्स्ट्रा देना।',
    context,
    (r) => {
      assert.deepEqual(
        menu.map((m) => r.lines.find((l) => l.item === m.id)?.quantity),
        [3, 2, 1],
      );
      assert.ok(r.lines.find((l) => l.item === menu[2].id).note);
      assert.equal(r.lines.length, 3);
    },
  ],
  [
    'partial',
    'order',
    'बिल नंबर तीन में दो सौ रुपए उधार हैं, बाकी पैसे कैश मिले।',
    context,
    (r) => {
      assert.equal(r.payment.number, 3);
      assert.equal(r.payment.due, 20000);
      assert.equal(r.payment.method, 'cash');
    },
  ],
  [
    'phrase',
    'phrase',
    'আমাদের এখানে অফিস সেট মানে দুটো বাটার রুটি আর এক প্লেট ছোলে।',
    context,
    (r) => {
      assert.ok(r.name);
      assert.equal(r.lines.find((l) => l.item === menu[0].id).quantity, 2);
      assert.equal(r.lines.find((l) => l.item === menu[2].id).quantity, 1);
    },
  ],
  [
    'expand',
    'order',
    'Two office sets, but one less butter roti.',
    context,
    (r) => {
      assert.equal(r.lines.find((l) => l.item === menu[0].id).quantity, 3);
      assert.equal(r.lines.find((l) => l.item === menu[2].id).quantity, 2);
    },
  ],
  [
    'signup',
    'signup',
    'என் பெயர் ரவி. என் கடையின் பெயர் குமார் கஃபே.',
    {},
    (r) => {
      assert.match(r.name, /ravi/i);
      assert.match(r.businessName, /kumar/i);
    },
  ],
  [
    'menu',
    'menu',
    'ಒಂದು ಪ್ಲೇಟ್ ಇಡ್ಲಿ ಬೆಲೆ ಐವತ್ತು ರೂಪಾಯಿ.',
    {},
    (r) => assert.ok(r.entries.some((e) => e.price === 5000)),
  ],
  [
    'vendor',
    'vendor',
    'రాముకి వంద రూపాయలు ఇచ్చాను.',
    {},
    (r) => assert.ok(r.entries.some((e) => e.kind === 'payment' && e.amount === 10000)),
  ],
];
await Promise.all(
  cases.map(async ([name, task, text, ctx, check]) => {
    try {
      const transcript = process.argv[2]
        ? await transcribe({
            buffer: await readFile(join(process.argv[2], name + '.wav')),
            originalname: name + '.wav',
            mimetype: 'audio/wav',
          })
        : text;
      const result = await interpret(task, transcript, ctx);
      check(result);
      console.log('PASS', name);
    } catch (e) {
      console.error('FAIL', name, e.message);
      process.exitCode = 1;
    }
  }),
);
