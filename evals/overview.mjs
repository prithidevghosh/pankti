// Live transcript-to-report routing, with fixed test dates and ledger figures.
import assert from 'node:assert/strict';
import {overviewAnswer} from '../server/services/overview-question.mjs';
import {interpret} from '../server/providers.mjs';
const store={overviewFigures:async()=>({topDish:[{name:'Roti',quantity:8}],paidCount:3,paidValue:60000,unpaidCount:2,partialCount:1,billedSales:90000})};
for(const [question,start,keys] of [
  ['आज सबसे ज्यादा क्या बिका?', '2026-11-28',['topDish']],
  ['आज का total paid bill कितना है?', '2026-11-28',['paidCount','paidValue']],
  ['पिछले चौदह दिनों का total sales कितना है? कितने bills paid हैं, कितने unpaid हैं?', '2026-11-15',['billedSales','paidCount','unpaidCount','partialCount']],
]){
  const result=await overviewAnswer(store,interpret,'test',question,{start:'2026-11-22',end:'2026-11-28'},'2026-11-28');
  for(const key of keys) assert.ok(result.facts.some(f=>f.key===key&&f.start===start&&f.end==='2026-11-28'),JSON.stringify(result));
  console.log(result.text);
}
