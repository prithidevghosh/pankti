import test from 'node:test';
import assert from 'node:assert/strict';
import {scopeReply,speakFacts} from './services/overview-speech.mjs';
import {inputLanguages} from '../shared/overview-languages.mjs';
import {overviewMetrics} from './services/overview-question.mjs';

const today='2026-11-28';
const fact=(key,value)=>({key,value,label:key,start:today,end:today});

test('every supported shop field has localized spoken wording',()=>{
  for(const language of Object.keys(inputLanguages)){
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

test('a paid-bill confirmation keeps the conversation language and report date', async()=>{
  const {overviewAnswer}=await import('./services/overview-question.mjs');
  const context={previousLanguage:'hi-IN',previousFacts:[fact('billedSales','₹600'),fact('paidCount','0')]};
  const selected={start:'2026-11-22',end:today};
  const plan={language:'en-IN',period:'previous',days:1,start:null,end:null,
    metrics:[{key:'paidCount',label:'Paid bills'}],empty:'None',clarification:null};
  let count=0;
  const store={overviewFigures:async(id,start,end)=>{
    assert.equal(start,today);assert.equal(end,today);
    return {paidCount:count};
  }};
  const ask=(question,requestedReplyLanguage)=>overviewAnswer(store,async()=>({...plan,requestedReplyLanguage}),
    'shop',question,selected,today,context);
  assert.equal((await ask('So no paid bills?',null)).text,'आज एक भी बिल का पूरा भुगतान दर्ज नहीं है।');
  count=1;
  const corrected=await ask('तो मतलब एक भी paid bill नहीं है?',null);
  assert.equal(corrected.language,'hi-IN');
  assert.equal(corrected.facts[0].value,'1');
  assert.equal((await ask('Please answer in English. Are any bills paid?','en-IN')).language,'en-IN');
});

test('a mixed off-topic request cannot use an attached identity or ledger metric', async()=>{
  const {overviewAnswer}=await import('./services/overview-question.mjs');
  const answer=await overviewAnswer({},async()=>({
    scope:'outside',courtesy:'identity',period:'today',days:1,start:null,end:null,
    language:'en-IN',metrics:[{key:'billCount',label:'Bills'}],empty:'None',clarification:null,
  }),'shop','How many bills today and what is the capital of India?',{start:today,end:today},today);
  assert.deepEqual(answer.facts,[]);
  assert.equal(answer.text,scopeReply('en-IN'));
});
