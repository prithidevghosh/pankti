import assert from 'node:assert/strict';
import { interpret } from '../server/providers.mjs';

// Use fixed UUIDs so the grader verifies database identities as well as quantities.
const menu = ['Noodles', 'Diet Coke', 'Chicken Tandoori', 'Veg Biryani', 'Veg Biryani'].map((name, index) => ({
  id: '00000000-0000-4000-8000-' + String(index + 1).padStart(12, '0'),
  name, variant: ['', '', 'Full plate', 'Half', 'Full'][index],
}));
const lines = pairs => pairs.map(([index, quantity]) => ({ item: menu[index].id, quantity }));
const orders = [
  ['Ek noodle, 4 diet coke, oye Sonu 4 no ka table clear kar', [], [[0,1],[1,4]]],
  ['आधा चिकन तंदूरी देना', [], [[2,0.5]]],
  ['Two half veg biryanis please', [], [[3,2]]],
  ['Two noodles, sorry just one. Remove the coke.', [[1,2]], [[0,1]]],
  ['Sonu fridge mein kitni Diet Coke bachi hai dekhna', [[0,1]], [[0,1]]],
  ['একটা নুডলস আর দুটো ডায়েট কোক দিন', [], [[0,1],[1,2]]],
  ['Make the bill please', [[0,2]], [[0,2]], false, true],
  ['Add fish curry', [[0,1]], [[0,1]], true],
  ['Veg biryani please', [], [], true],
  ['Quarter plate chicken tandoori', [], [[2,.25]]],
];
const vendors = [
  ['Mohan se 800 ke aloo liye, 300 de diye, ab 500 baaki', [['purchase',80000],['payment',30000]]],
  ['Order ten kilos onions from Mohan for tomorrow', [['order',0]]],
  ['Mohan ko kal 500 denge', []],
  ['Mohan ka total 700 rupaye baki hai', [['balance',70000]]],
  ['Mohan ko do sau rupaye diye', [['payment',20000]]],
];
let passed = 0;
for (const [sentence, prior, expected, clarify = false, bill = false] of orders) {
  try {
    const actual = await interpret('order', sentence, { menu, basket: lines(prior) });
    assert.deepEqual(actual.lines.sort((a,b) => a.item.localeCompare(b.item)), lines(expected));
    assert.equal(Boolean(actual.question), clarify);
    assert.equal(actual.readyToBill, bill);
    passed++;
  } catch (error) { console.error('FAIL', sentence, error.message); }
}
for (const [sentence, expected] of vendors) {
  try {
    const result = await interpret('vendor', sentence, { vendors: [{ vendor: 'Mohan', due: 100000 }] });
    assert.deepEqual(result.entries.map(e => [e.kind, e.amount]), expected);
    assert.ok(result.entries.every(e => e.vendor === 'Mohan'));
    if (expected.length) assert.ok(!result.question);
    passed++;
  } catch (error) { console.error('FAIL', sentence, error.message); }
}
const total = orders.length + vendors.length;
console.log(passed + '/' + total + ' transcript cases passed.');
if (passed !== total) process.exitCode = 1;
