// Real planner, authenticated HTTP endpoints, and an isolated Mongo shop.
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {createApp} from '../server/app.mjs';
import {testDatabase} from '../server/test-database.mjs';
import {indiaDay} from '../shared/menu-availability.mjs';
import {readOverviewAloud} from '../server/providers.mjs';

const cleanup=[];
const {name}=await testDatabase({after:f=>cleanup.push(f)});
const {app,close}=await createApp({database:name,verify:async()=> 'owner',
  readInvoice:async()=>({vendor:'Shyam Dairy',number:'D12',lines:[{name:'Paneer',unit:'kg',quantity:10,ratePaise:32000}]})});
const server=app.listen(0,'127.0.0.1');
await new Promise(r=>server.once('listening',r));
async function api(path,body,method){
  const multipart=body instanceof FormData;
  const res=await fetch('http://127.0.0.1:'+server.address().port+'/api'+path,{method:method || (body?'POST':'GET'),
    headers:{authorization:'Bearer test',...(!multipart&&body?{'Content-Type':'application/json'}:{})},
    body:multipart?body:JSON.stringify(body)});
  const data=await res.json();assert.ok(res.ok,JSON.stringify(data));return data;
}
let previousId;
async function ask(question,spoken=false){
  let body={question,date:indiaDay(),days:'7',previousId};
  if(spoken){
    const wav=Buffer.from(await readOverviewAloud(question,'hi-IN'),'base64');
    body=new FormData();body.append('audio',new Blob([wav],{type:'audio/wav'}),'question.wav');
    body.append('date',indiaDay());body.append('days','7');
    if(previousId) body.append('previousId',previousId);
  }
  const answer=await api('/overview/live/report',body);
  previousId=answer.id;console.log(question,answer.text);
  return answer;
}
try{
  await api('/workspace',{name:'Corner Kitchen',city:'Delhi'});
  const {menu}=await api('/menu',[{name:'Chai',price:2000,variant:'',category:'Drink'},{name:'Paneer',price:20000,variant:'',category:'Main'}]);
  const chai=menu.find(i=>i.name==='Chai');
  for(const method of ['cash','upi']){
    const {bill}=await api('/bills',{request:randomUUID(),basket:[{item:chai.id,quantity:1}]});
    await api('/bills/'+bill.id+'/payment',{method});
  }
  await api('/vendors',{request:randomUUID(),entries:['Shyam Dairy','Sonu'].map((vendor,i)=>({kind:'purchase',vendor,note:'Milk',amount:10000*(i+1),paid:0}))});
  const photo=new FormData();photo.append('bill',new Blob(['fixture'],{type:'image/png'}),'bill.png');
  const invoice=await api('/vendor-invoices',photo);
  const delivery=new FormData();
  const audio=Buffer.from(await readOverviewAloud('दस किलो पनीर मंगाया था लेकिन नौ किलो मिला।','hi-IN'),'base64');
  delivery.append('audio',new Blob([audio],{type:'audio/wav'}),'delivery.wav');delivery.append('revision','0');
  await api('/vendor-invoices/'+invoice._id+'/check',delivery);
  const dues=await ask('चेक कर सकते हो कौन से वेंडर के पास कितना उधार है?',true);
  assert.match(dues.text,/Shyam Dairy/);assert.match(dues.text,/Sonu/);
  for(const [question,key,count] of [
    ['What are my orders?','orders',2],['Which orders were paid by UPI?','upiOrders',1],['And by cash?','cashOrders',1],
    ['What mismatches did we find on vendor deliveries?','vendorMismatches',1],['Which is the most expensive item in my menu?','maxPrice',1],
  ]){
    const result=await ask(question);
    const section=result.sections.find(s=>s.key===key);
    assert.equal(section?.rows.length,count,key);
    if(key==='cashOrders')assert.match(section.rows[0],/#0001/);
    if(key==='upiOrders')assert.match(section.rows[0],/#0002/);
    if(key==='vendorMismatches')assert.match(section.rows[0],/Paneer.*10 kg.*9 kg/);
    if(key==='maxPrice')assert.match(section.rows[0],/Paneer/);
  }
  await api('/menu/availability',[{item:chai.id,available:false}],'PUT');
  const sold=await ask('Which items are disabled?');
  assert.deepEqual(sold.menuRefs,[chai.id]);
  assert.ok((await ask('Please enable it')).menuChanged);
  const restored=(await api('/workspace')).menu.find(i=>i.id===chai.id);
  assert.notEqual(restored.soldOutDay,indiaDay());
  const blocked=await ask('Tell me the capital of India and disable the chai.');
  assert.ok(!blocked.menuChanged);
  assert.notEqual((await api('/workspace')).menu.find(i=>i.id===chai.id).soldOutDay,indiaDay());
}finally{
  await new Promise(r=>server.close(r)); await close();for(const f of cleanup)await f();
}
