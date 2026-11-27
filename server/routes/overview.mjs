import { openLiveOverview } from '../services/live-overview.mjs';
import { z } from 'zod';
import { overviewAnswer,speechLanguages } from '../services/overview-question.mjs';
import { httpError } from '../errors.mjs';

export function registerOverview(app,{store,requireRestaurant,upload,speech,understand,readAloud}) {
  app.post('/api/overview/live',async(req,res)=>{
    requireRestaurant(req);
    const sdp=z.string().startsWith('v=0').max(100000).parse(req.body.sdp);
    res.json({sdp:await openLiveOverview(sdp)});
  });
  app.post('/api/overview/live/report',async(req,res)=>{
    const shop=requireRestaurant(req);
    const {question,date,days,previousId}=z.object({question:z.string().trim().min(1).max(1200),date:z.iso.date(),days:z.enum(['1','7','14','30']),previousId:z.uuid().optional()}).parse(req.body);
    const start=new Date(Date.parse(date+'T00:00:00Z')-(Number(days)-1)*86400000).toISOString().slice(0,10);
    const previous=previousId && await store.overviewReply(shop.id,previousId);
    const answer=await overviewAnswer(store,understand,shop.id,question,{start,end:date},undefined,{
      shop,uid:req.uid,previousLanguage:previous?.answer?.language,previousFacts:(previous?.answer?.facts || []).map(({key,start,end})=>({key,start,end})),
    });
    const {insertedId}=await store.recordOverview(req.uid,shop.id,question,answer);
    res.json({...answer,voiceId:insertedId});
  });
  app.post('/api/overview/ask',upload.single('audio'),async(req,res)=>{
    const shop=requireRestaurant(req);
    if(!req.file?.size || !/^(audio\/|video\/mp4$)/.test(req.file.mimetype)) throw httpError(422,'Record your business question first.');
    const end=z.iso.date().parse(req.body.date);
    const days=Number(z.enum(['1','7','14','30']).parse(req.body.days));
    const start=new Date(Date.parse(end+'T00:00:00Z')-(days-1)*86400000).toISOString().slice(0,10);
    const transcript=await speech(req.file);
    const answer=await overviewAnswer(store,understand,shop.id,transcript,{start,end},undefined,{shop,uid:req.uid});
    const {insertedId}=await store.recordOverview(req.uid,shop.id,transcript,answer);
    res.json({transcript,...answer,voiceId:speechLanguages.has(answer.language) && answer.text.length<=2500 ? insertedId : null});
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
