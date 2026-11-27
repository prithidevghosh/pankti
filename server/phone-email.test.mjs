import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from './app.mjs';
import { phoneEmailNumber } from './phone-email.mjs';
import { testDatabase } from './test-database.mjs';
import { sessionAge } from './phone-store.mjs';

const receipt = 'https://user.phone.email/user_test123.json';
const phone = '+919000000012';
test('Phone.Email resolves a provider receipt on the server', async () => {
  const read = async (url, options) => {
    assert.equal(url, receipt);
    assert.equal(options.redirect, 'error');
    return Response.json({user_country_code:'+91', user_phone_number:'9000000012'});
  };
  assert.equal(await phoneEmailNumber(receipt, 'test', read), phone);
  await assert.rejects(phoneEmailNumber('https://example.com/user_test.json', 'test', read), {status:400});
});

test('web OTP redeems once and grants exactly 30 days without renewing on access', async t => {
  const { db, name } = await testDatabase(t);
  const {app, close} = await createApp({ database:name, localPhoneOnly:true,
    phoneEmailClientId:'fixture', receiptLookup:async () => phone });
  const server = app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  t.after(async()=>{ await new Promise(resolve=>server.close(resolve)); await close(); });
  const url = 'http://localhost:'+server.address().port+'/api';
  const post = (path,body) => fetch(url+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const signup = { name:'Mira', businessName:'Mira Kitchen' };
  assert.equal((await post('/auth/signup',{phone,...signup,client:'android'})).status,401);
  assert.equal((await post('/auth/phone-email',{phone:'+919000000011',receipt,signup})).status,401);
  const start = Date.now();
  const signed = await post('/auth/phone-email',{phone,receipt,signup});
  assert.equal(signed.status,200);
  assert.match(signed.headers.get('set-cookie'),/Max-Age=2592000/);
  const headers = {Cookie:signed.headers.get('set-cookie').split(';')[0]};
  const session = async () => (await fetch(url+'/auth/session',{headers})).json();
  const expiry = (await session()).expiresAt;
  assert.ok(Date.parse(expiry)>=start+sessionAge && Date.parse(expiry)<=Date.now()+sessionAge);
  assert.equal((await session()).expiresAt,expiry);
  const workspace = await (await fetch(url+'/workspace',{headers})).json();
  assert.equal(workspace.restaurant.name,signup.businessName);
  assert.equal((await post('/auth/phone-email',{phone,receipt})).status,409);
  const second = await post('/auth/phone-email',{phone,receipt:receipt.replace('123','124')});
  assert.equal(second.status,200);
  await db.collection('phone_sessions').updateMany({},{$set:{expiresAt:new Date(Date.now()-1)}});
  assert.equal((await session()).authenticated,false);
  assert.equal((await fetch(url+'/workspace',{headers})).status,401);
});
