import test from 'node:test';
import assert from 'node:assert/strict';
import {scopeReply,speakFacts} from './services/overview-speech.mjs';
import {overviewMetrics,speechLanguages} from './services/overview-question.mjs';

const today='2026-11-28';
const fact=(key,value)=>({key,value,label:key,start:today,end:today});

test('every supported shop field has localized spoken wording',()=>{
  for(const language of speechLanguages){
    for(const key of overviewMetrics){
      const raw=key==='topDish'?[{name:'Roti',quantity:2}]:key==='soldOut'?['Chai']:2;
      const text=speakFacts([fact(key,'2')],{[key]:raw},language,today);
      assert.ok(text.length>2);
      assert.doesNotMatch(text,/undefined|\{\w+\}| — /);
    }
    assert.ok(scopeReply(language).length>10);
  }
});

test('tied dishes, quantities, and time periods survive spoken rendering',()=>{
  const topDish=[{name:'Chai',quantity:5},{name:'Roti',quantity:5}];
  const text=speakFacts([fact('topDish',''),fact('billCount','1')],{topDish,billCount:1},'en-IN',today);
  assert.equal(text,'Today Chai and Roti tied for the top spot, with 5 each. You issued one bill.');
});

test('one period introduction for sales plus a separate current supplier balance',()=>{
  const rows=[fact('billedSales','₹4,800'),fact('vendorDue','₹600')];
  const answer=speakFacts(rows,{billedSales:480000,vendorDue:60000},'hi-IN',today);
  assert.equal(answer,'आज आपकी कुल बिक्री ₹4,800 रही। सप्लायरों को अभी ₹600 देना बाकी है।');
});
