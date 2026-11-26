import assert from 'node:assert/strict';
import { interpret } from '../server/providers.mjs';

const entry = {id:23,vendor:'Mohan Foods',kind:'purchase',amount:80000,paid:30000,note:'Potatoes'};
const cases = [
  ['नौ सौ रुपये का था, पूरा पेमेंट हो गया।',{amount:90000,paid:90000}],
  ['Rename the supplier to Asha Market.',{vendor:'Asha Market'}],
  ['Payment galti se likha tha. Abhi tak kuch nahi diya.',{paid:0}],
  ['Actually paid two hundred fifty rupees.',{paid:25000}],
];
for(const [transcript,patch] of cases) {
  const result=await interpret('vendorEdit',transcript,{entry});
  for(const key of ['vendor','amount','paid','note']) assert.equal(result[key],({...entry,...patch})[key],transcript+' / '+key);
  assert.ok(!result.question);
}
const choice=await interpret('vendor','Correct the last Mohan Foods purchase to nine hundred rupees.',{recentEntries:[entry],vendors:[]});
assert.equal(choice.editId,entry.id);
assert.deepEqual(choice.entries,[]);
console.log('5/5 vendor correction cases passed.');
