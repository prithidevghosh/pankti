// Real semantic routing against an isolated shop; no production records.
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {createApp} from '../server/app.mjs';
import {testDatabase} from '../server/test-database.mjs';
import {indiaDay} from '../shared/menu-availability.mjs';
import {readOverviewAloud} from '../server/providers.mjs';
const cleanup=[];
const {name}=await testDatabase({after:f=>cleanup.push(f)});
const {app,close}=await createApp({database:name,localPhoneOnly:true,
  readInvoice:async()=>({vendor:"Sonu",number:"D12",lines:[{name:"Potato",unit:"kg",quantity:10,ratePaise:3000}]})});
const server=app.listen(0,'127.0.0.1');
await new Promise(r=>server.once('listening',r));
let cookie;
async function api(path,body){
  const multipart=body instanceof FormData;
  const res=await fetch('http://127.0.0.1:'+server.address().port+'/api'+path,{method:body?'POST':'GET',
    headers:{...(cookie?{Cookie:cookie}:{}),...(!multipart&&body?{'Content-Type':'application/json'}:{})},
    body:multipart?body:JSON.stringify(body)});
  if(res.headers.get('set-cookie'))cookie=res.headers.get('set-cookie').split(';')[0];
  const data=await res.json();assert.ok(res.ok,JSON.stringify(data));return data;
}
let previousId;
async function ask(question,spoken=false){
  let body={question,date:indiaDay(),days:'7',previousId,turnId:randomUUID()};
  if(spoken){
    const wav=Buffer.from(await readOverviewAloud(question,'hi-IN'),'base64');
    const form=new FormData();
    for(const [k,v] of Object.entries(body)) if(k!=='question' && v) form.append(k,v);
    form.append('audio',new Blob([wav],{type:'audio/wav'}),'q.wav');body=form;
  }
  const answer=await api('/overview/live/report',body);
  previousId=answer.id;console.log(question,answer.text);
  assert.deepEqual((await api('/overview/live/report',body)).text,answer.text);
  return answer;
}
try{
  await api('/auth/signup',{name:'QA',phone:'+919000099999',businessName:'Counter',client:'web'});
  const {menu}=await api('/menu',[{name:'Samosa',price:15000,category:'Snacks',variant:''}]);
  let bill;
  for(let i=0;i<3;i++)({bill}=await api('/bills',{request:randomUUID(),basket:[{item:menu[0].id,quantity:2}]}));
  await api('/vendors',{request:randomUUID(),entries:[{kind:'purchase',vendor:'Sonu',amount:50000,note:'Potatoes'}]});
  assert.ok((await ask('बिल नंबर तीन का पूरा पैसा कैश में मिल गया है।',true)).changed);
  let saved=(await api('/bills/'+bill.id)).bill;
  assert.equal(saved.received,30000);assert.equal(saved.movements.length,1);assert.equal(saved.method,'cash');
  assert.ok((await ask('सोनू को दो सौ रुपये दे दिए।',true)).changed);
  const ledger=await api('/vendors');assert.equal(ledger.balances[0].due,30000);assert.equal(ledger.events.length,2);
  const hypothetical=await ask('If I paid Sonu another hundred rupees tomorrow how much would remain?');
  assert.ok(!hypothetical.changed);assert.equal((await api('/vendors')).events.length,2);
  const method=await ask('Bill 0002 has been paid in full.');assert.ok(!method.changed);
  assert.ok((await ask('By UPI.')).changed);
  assert.ok((await ask('Add a cup of Chai for 20 rupees to my menu.')).changed);
  assert.ok((await ask('Change the price of Chai to 25 rupees.')).changed);
  assert.equal((await api('/workspace')).menu.find(i=>i.name.toLowerCase().includes('chai')).price,2500);
  assert.ok((await ask('Set the GST on my account to five percent.')).changed);
  assert.equal((await api('/workspace')).restaurant.gstBps,500);
  const draft=await ask('Take an order for two samosas.');assert.equal(draft.work?.lines?.[0]?.quantity,2);
  assert.ok((await ask('Make the bill for that order.')).changed);
  assert.equal((await api('/workspace')).pendingBill.total,31500);
  assert.equal((await ask('I want to scan a new QR payment card.')).openTab,'bank');
  assert.ok((await ask('Teach my counter a menu shortcut called Morning Pair. It means two samosas.')).changed);
  const deletion=await ask('Remove the Morning Pair shortcut from my menu.');
  assert.ok(deletion.work?.deleteId);
  assert.ok((await ask('Yes, delete that shortcut.')).changed);
  const photo=new FormData();
  photo.append('bill',new Blob(['fixture'],{type:'image/png'}),'bill.png');
  const invoice=await api('/vendor-invoices',photo);
  assert.ok((await ask("Check Sonu's invoice D12: we ordered ten kilos of potatoes and received eight kilos.")).changed);
  const checked=(await api('/vendor-invoices')).invoices.find(i=>i._id===invoice._id);
  assert.equal(checked.check.rows[0].shortage,2);
}finally{await new Promise(r=>server.close(r));await close();for(const f of cleanup)await f();}
