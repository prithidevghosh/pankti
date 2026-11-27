// Live two-turn browser check. Supply two WAV files: a business question and a follow-up.
import { chromium } from 'playwright-core';
import express from 'express';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createApp} from '../server/app.mjs';
import {testDatabase} from '../server/test-database.mjs';
import {randomUUID} from 'node:crypto';

const bengali=process.argv[2]==='--bengali';
const confirmation=process.argv[2]==='--paid-confirmation';
const wavs=await Promise.all(process.argv.slice(confirmation || bengali?3:2).map(path=>readFile(path)));
assert.ok(wavs.length>=2,'Supply question.wav, follow-up.wav and optionally unrelated questions as WAV files');
const cleanup=[];
const {name}=await testDatabase({after:f=>cleanup.push(f)});
const {app,close}=await createApp({database:name,localPhoneOnly:true});
app.use(express.static('apps/web/dist'));
const server=app.listen(0,'127.0.0.1');
await new Promise(resolve=>server.once('listening',resolve));
const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({channel:'chrome',args:['--autoplay-policy=no-user-gesture-required']});
try{
  const page=await browser.newPage({viewport:{width:390,height:844}});
  await page.addInitScript(()=>{
    navigator.mediaDevices.getUserMedia=async()=>{
      const ctx=new AudioContext(), dest=ctx.createMediaStreamDestination();
      const floor=ctx.createOscillator(),gain=ctx.createGain();
      gain.gain.value=.0003;floor.connect(gain).connect(dest);floor.start();
      await ctx.resume();
      window.testMic=dest.stream;
      window.sayFixture=async bytes=>{
        const source=ctx.createBufferSource();
        source.buffer=await ctx.decodeAudioData(Uint8Array.from(atob(bytes),c=>c.charCodeAt(0)).buffer);
        source.connect(dest);source.start();
      };
      return dest.stream;
    };
  });
  const post=async(path,data)=>(await page.request.post(origin+'/api'+path,{data})).json();
  await post('/auth/signup',{phone:'+919000001777',name:'QA',businessName:'Test Counter',client:'web'});
  const {menu}=await post('/menu',[{name:'Butter Roti',variant:'',category:'Bread',price:3500}]);
  await post('/bills',{request:randomUUID(),basket:[{item:menu[0].id,quantity:3}]});
  await page.goto(origin);await page.getByRole('button',{name:'Start conversation'}).click();
  const state=page.locator('.conversation-state');
  await state.filter({hasText:/^Listening$/}).waitFor({timeout:35000});
  let firstDay;
  for(const [index,wav] of wavs.entries()) {
    const reported=page.waitForResponse(r=>r.url().endsWith('/live/report'),{timeout:30000});
    await page.evaluate(bytes=>window.sayFixture(bytes),wav.toString('base64'));
    const response=await reported;const report=await response.json();if(index>=2){
      assert.deepEqual(report.facts,[]);
      if(confirmation && index===2){
        assert.equal(report.language,'hi-IN');
        assert.match(report.text,/^मैं पंक्ति हूँ/);
      }
      assert.doesNotMatch(report.text,/delhi|दिल्ली|four|चार/i);
      await state.filter({hasText:/^Speaking$/}).waitFor({timeout:35000});
      assert.equal(await page.locator('.conversation-reply').innerText(),report.text);
      await state.filter({hasText:/^Listening$/}).waitFor({timeout:30000});
      console.log(confirmation && index===2 ? report.text : 'Spoken out-of-scope question redirected');
      continue;
    }
    assert.ok(report.facts?.length,JSON.stringify(report));
    await state.filter({hasText:/^Speaking$/}).waitFor({timeout:35000});
    if(bengali){
      assert.equal(report.language,'bn-IN');
      assert.match(report.text,/\p{Script=Bengali}/u);
      const fact=report.facts.find(f=>f.key===(index?'paidCount':'billedSales'));
      assert.ok(fact,JSON.stringify(report));
      console.log(report.text);
      await state.filter({hasText:/^Listening$/}).waitFor({timeout:30000});
      continue;
    }
    if(confirmation){
      assert.equal(report.language,'hi-IN');
      if(index===0){
        assert.ok(report.facts.some(f=>f.key==='billedSales'));
        firstDay=report.facts[0].start;
      }else{
        assert.deepEqual(report.facts.map(f=>f.key),['paidCount']);
        assert.equal(report.facts[0].value,'0');
        assert.equal(report.facts[0].start,firstDay);
        assert.equal(report.text,'आज एक भी बिल का पूरा भुगतान दर्ज नहीं है।');
      }
      console.log(report.text);
      await state.filter({hasText:/^Listening$/}).waitFor({timeout:30000});
      continue;
    }
    const fact=report.facts.find(f=>f.key==='topDish');
    assert.ok(fact,'The follow-up must retain the top dish topic');
    if(index===0){
      firstDay=fact.start;
      assert.equal(fact.value,'Butter Roti × 3');
      if(process.env.PANKTI_QA_SCREENSHOTS){
        for(const width of [390,1280]){
          await page.setViewportSize({width,height:844});
          await page.locator('.conversation-panel').screenshot({path:process.env.PANKTI_QA_SCREENSHOTS+'/active-'+width+'.png'});
        }
      }
      continue; // Interrupt the first answer with the follow-up.
    }
    assert.equal(Date.parse(firstDay)-Date.parse(fact.start),86400000);
    console.log(await page.locator('.conversation-reply').innerText());
    await state.filter({hasText:/^Listening$/}).waitFor({timeout:30000});
  }
  await page.getByRole('button',{name:'End conversation'}).click();
  assert.equal(await page.evaluate(()=>window.testMic.getAudioTracks()[0].readyState),'ended');
  console.log('Two turns, server voice playback, and microphone release passed.');
} finally {
  await browser.close();await new Promise(r=>server.close(r));await close();
  for(const f of cleanup) await f();
}
