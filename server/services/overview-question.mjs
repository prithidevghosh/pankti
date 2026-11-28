import {toolNames} from './shop-tool-catalog.mjs';
import {performShopAction} from './shop-actions.mjs';
import {detailKeys,menuAction,operationalDetails} from './overview-operations.mjs';
import {locale,voiceLanguages} from '../../shared/overview-languages.mjs';
import {scopeReply,speakFacts} from './overview-speech.mjs';
import labels from '../locales/overview.json' with { type: 'json' };
import { z } from 'zod';
import { indiaDay } from '../../shared/menu-availability.mjs';
import { httpError } from '../errors.mjs';

const shopFields = ['menuCount','businessName','ownerName','phone','city','gst','payee','upi'];
export const overviewMetrics = ['billedSales','collections','billCount','paidCount','paidValue','unpaidCount','partialCount','outstanding','topDish','vendorPurchases','vendorPaid','vendorDue','soldOut',...shopFields];
const planSchema = z.object({
  action:z.object({kind:z.enum(toolNames),target:z.string().trim().min(1).max(200).nullable()}).nullish(),
  explicitBillNumber:z.number().int().positive().nullish(),
  vendorName:z.string().trim().max(160).nullish(),
  scope:z.enum(['shop','assistant','outside']).optional(),
  requestedReplyLanguage:z.string().nullable().optional(),
  courtesy:z.enum(['thanks','listening','identity','none']).optional(),
  period:z.enum(['today','yesterday','lastDays','calendar','selected','previous']), days:z.number().int(),
  start:z.iso.date().nullable(), end:z.iso.date().nullable(), language:z.string().regex(/^[a-z]{2,3}-IN$/),
  metrics:z.array(z.object({key:z.enum([...overviewMetrics,...detailKeys]), label:z.string().trim().min(1).max(120)})).max(15),
  empty:z.string().trim().max(100), clarification:z.string().trim().max(300).nullable(),
});
export const speechLanguages = new Set(Object.keys(voiceLanguages));
const money = new Set(['billedSales','collections','paidValue','outstanding','vendorPurchases','vendorPaid','vendorDue']);

export async function overviewAnswer(store, understand, restaurant, transcript, selected, today=indiaDay(), context={}) {
  const plan = planSchema.parse(await understand('overview',transcript,{today,previousBillRefs:context.previousBillRefs,previousVendorRefs:context.previousVendorRefs,inputLanguage:context.detectedLanguage,previousLanguage:context.previousLanguage,referencedMenuItems:context.previousMenuRefs?.length || 0,pendingAvailability:context.pendingAvailability,pendingTool:context.priorWork?.kind,priorQuestion:context.priorWork?.question,previousFacts:context.previousFacts || []}));
  const detected=locale(context.detectedLanguage);
  const previous=locale(context.previousLanguage);
  const planned=locale(plan.language);
  // Keep brief code-mixed follow-ups in the established language. Recognize
  // a change when both the audio detector and transcript planner identify it.
  const switched=detected && detected!=='en-IN' && detected===planned;
  const language=locale(plan.requestedReplyLanguage) ||
    (switched && detected) || previous || detected || planned || 'en-IN';
  const copy = labels[language];
  if (plan.scope==='outside') return {language,text:scopeReply(language),facts:[]};
  if(plan.scope==='shop' && plan.action){
    if(['enable','disable'].includes(plan.action.kind))
      return menuAction(store,understand,restaurant,transcript,plan.action,context.previousMenuRefs || [],language,context.commit);
    if(!context.commit) throw httpError(422,'Start a conversation to record this change.');
    return performShopAction(store,understand,restaurant,transcript,plan.action,language,{...context,explicitBillNumber:plan.explicitBillNumber});
  }
  if (plan.scope==='assistant' || plan.clarification || !plan.metrics.length) return {language,text:scopeReply(language,plan.courtesy),facts:[]};
  const ago=n=>new Date(Date.parse(today+'T00:00:00Z')-n*86400000).toISOString().slice(0,10);
  let {start,end}=selected;
  if(plan.period==='previous' && context.previousFacts?.length){
    const matching=context.previousFacts.find(f=>plan.metrics.some(m=>m.key===f.key));
    const prior=matching || context.previousFacts[0];
    ({start,end}=prior);
  }
  if(plan.period==='today') start=end=today;
  if(plan.period==='yesterday') start=end=ago(1);
  if(plan.period==='lastDays') {
    if(plan.days<1 || plan.days>366) throw httpError(422,'Choose a period of 1 to 366 days.');
    start=ago(plan.days-1); end=today;
  }
  if(plan.period==='calendar') {start=plan.start;end=plan.end;}
  if (!start || !end || end < start || end > today || Date.parse(end)-Date.parse(start) >= 366*86400000)
    throw httpError(422,'Choose a past or current period of up to one year.');
  const requested=[...new Set(plan.metrics.map(m=>m.key))];
  const details=await operationalDetails(store,restaurant,requested,start,end,today,language,plan.vendorName,understand);
  const keys=new Set(requested.filter(key=>!detailKeys.includes(key)));
  if(keys.has('unpaidCount')) keys.add('partialCount');
  const values={};
  if ([...keys].some(k=>!k.startsWith('vendor') && k!=='soldOut' && !shopFields.includes(k))) Object.assign(values,await store.overviewFigures(restaurant,start,end));
  if ([...keys].some(k=>k.startsWith('vendor'))) {
    const ledger=await store.vendors(restaurant);
    const events=ledger.events.filter(e=>!e.linkedPurchase && indiaDay(Date.parse(e.created))>=start && indiaDay(Date.parse(e.created))<=end);
    values.vendorPurchases=events.reduce((n,e)=>n+(e.kind==='purchase'?e.amount:0),0);
    values.vendorPaid=events.reduce((n,e)=>n+e.paid,0);
    values.vendorDue=ledger.balances.reduce((n,b)=>n+Math.max(0,b.due),0);
  }
  if(keys.has('soldOut')){
    const disabled=(await store.menuFor(restaurant)).filter(i=>i.soldOutDay===today);
    values.soldOut=disabled.map(i=>[i.name,i.variant].filter(Boolean).join(' '));
    details.menuRefs.push(...disabled.map(i=>i.id));
  }
  if(keys.has('menuCount')) values.menuCount=(await store.menuFor(restaurant)).length;
  const shop=context.shop;
  if(shop){
    Object.assign(values,{businessName:shop.name,city:shop.city,gst:(shop.gstBps||0)/100+'%',payee:shop.payee,
      upi:shop.qr ? new URL(shop.qr).searchParams.get('pa') : null});
    if(keys.has('ownerName') || keys.has('phone')){
      const profile=await store.accountDetails(context.uid);
      Object.assign(values,{ownerName:profile.name,phone:profile.phone});
    }
  }
  const currency=new Intl.NumberFormat(language,{style:'currency',currency:'INR',minimumFractionDigits:0,maximumFractionDigits:2});
  const facts=Array.from(keys,key=>{
    let value=values[key] ?? copy.empty;
    if(money.has(key)) value=currency.format(value/100);
    else if(key==='topDish') value=value.length ? value.map(r=>r.name+' × '+r.quantity).join(', ') : copy.empty;
    else if(key==='soldOut') value=value.join(', ') || copy.empty;
    else value=String(value);
    const current=key==='soldOut'||key==='vendorDue'||shopFields.includes(key);
    return {key,label:copy[key],value,start:current?today:start,end:current?today:end};
  });
  const report=[speakFacts(facts,values,language,today),...details.spoken].filter(Boolean).join(' ');
  const text=plan.courtesy==='identity' ? scopeReply(language,'identity')+' '+report : report;
  return {language,text,facts:[...facts,...details.facts],sections:details.sections,billRefs:details.billRefs,vendorRefs:details.vendorRefs,menuRefs:details.menuRefs};
}
