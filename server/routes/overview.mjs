import {createHash,randomUUID} from 'node:crypto';
import {greetingFor} from '../services/overview-greeting.mjs';
import { z } from 'zod';
import { overviewAnswer,speechLanguages } from '../services/overview-question.mjs';
import { httpError } from '../errors.mjs';

export function registerOverview(app,{store,requireRestaurant,upload,speech,understand,readAloud}) {
  const greet=greetingFor(readAloud);
  app.post('/api/overview/live/greeting',async(req,res)=>{
    requireRestaurant(req);
    res.json(await greet(z.string().max(40).optional().parse(req.body.language)));
  });
  app.post('/api/overview/live',async(req,res)=>{
    requireRestaurant(req);
    if(!process.env.SARVAM_API_KEY || !process.env.OPENAI_API_KEY) throw httpError(503,'Voice is unavailable until the server keys are configured.');
    res.json({ready:true});
  });
  app.post(['/api/overview/live/report','/api/overview/ask'],upload.single('audio'),async(req,res)=>{
    const legacy=req.path.endsWith('/ask');
    if(legacy && (!req.file?.size || !/^(audio\/|video\/mp4$)/.test(req.file.mimetype))) throw httpError(422,'Record your business question first.');
    const shop=requireRestaurant(req);
    const id=z.uuid().optional().parse(req.body.turnId) || randomUUID();
    const inputHash=createHash('sha256').update(req.file?.buffer || String(req.body.question)).update(JSON.stringify([req.body.previousId,req.body.date,req.body.days])).digest('hex');
    const respond=(answer,transcript)=>res.json({...answer,...(legacy && {transcript}),id,voiceId:speechLanguages.has(answer.language) && answer.text.length<=2500?id:null});
    const saved=await store.overviewReply(shop.id,id);
    if(saved){
      if(saved.inputHash!==inputHash) throw httpError(409,'This turn identifier was already used.');
      return respond(saved.answer,saved.transcript);
    }
    const heard=req.file && await speech(req.file,[],{withLanguage:true});
    const {question,date,days,previousId}=z.object({question:z.string().trim().min(1).max(1200),date:z.iso.date(),days:z.enum(['1','7','14','30']),previousId:z.uuid().optional()}).parse({
      ...req.body,question:(typeof heard==='string'?heard:heard?.transcript) || req.body.question,
    });
    const start=new Date(Date.parse(date+'T00:00:00Z')-(Number(days)-1)*86400000).toISOString().slice(0,10);
    const previous=previousId && await store.overviewReply(shop.id,previousId);
    let committed=false;
    const commit=async apply=>{
      const result=await store.finishTurn({id,owner:req.uid,restaurant:shop.id,inputHash,transcript:question},apply);
      committed=true;
      return result;
    };
    const answer=await overviewAnswer(store,understand,shop.id,question,{start,end:date},undefined,{
      shop,uid:req.uid,turnId:id,commit,previousVendorRefs:previous?.answer?.vendorRefs,priorWork:previous?.answer?.work,pendingAvailability:previous?.answer?.pendingAvailability,previousMenuRefs:previous?.answer?.menuRefs,detectedLanguage:heard?.language,previousLanguage:previous?.answer?.language,previousFacts:(previous?.answer?.facts || []).map(({key,start,end})=>({key,start,end})),
    });
    respond(committed?answer:await commit(()=>answer),question);
  });
  app.post('/api/overview/:id/speech',async(req,res)=>{
    const shop=requireRestaurant(req);
    const reply=await store.overviewReply(shop.id,z.uuid().parse(req.params.id));
    if(!reply) throw httpError(404,'Answer not found.');
    if(!speechLanguages.has(reply.answer.language) || reply.answer.text.length>2500)
      throw httpError(422,'Audio is unavailable for this answer.');
    res.json({audio:await readAloud(reply.answer.text,reply.answer.language)});
  });
}
