import labels from '../locales/overview.json' with { type: 'json' };
import { z } from 'zod';
import { indiaDay } from '../../shared/menu-availability.mjs';
import { httpError } from '../errors.mjs';

const shopFields = ['menuCount','businessName','ownerName','phone','city','gst','payee','upi'];
export const overviewMetrics = ['billedSales','collections','billCount','paidCount','paidValue','unpaidCount','partialCount','outstanding','topDish','vendorPurchases','vendorPaid','vendorDue','soldOut',...shopFields];
const planSchema = z.object({
  period:z.enum(['today','yesterday','lastDays','calendar','selected']), days:z.number().int(),
  start:z.iso.date().nullable(), end:z.iso.date().nullable(), language:z.string().regex(/^[a-z]{2,3}-IN$/),
  metrics:z.array(z.object({key:z.enum(overviewMetrics), label:z.string().trim().min(1).max(120)})).max(15),
  empty:z.string().trim().max(100), clarification:z.string().trim().max(300).nullable(),
});
export const speechLanguages = new Set('hi bn ta te gu kn ml mr pa od en'.split(' ').map(code=>code+'-IN'));
const money = new Set(['billedSales','collections','paidValue','outstanding','vendorPurchases','vendorPaid','vendorDue']);
const dateText = (iso, locale) => new Intl.DateTimeFormat(locale,{dateStyle:'medium',timeZone:'UTC'}).format(new Date(iso+'T00:00:00Z'));

export async function overviewAnswer(store, understand, restaurant, transcript, selected, today=indiaDay(), context={}) {
  const plan = planSchema.parse(await understand('overview',transcript,{today,previousLanguage:context.previousLanguage,previousFacts:context.previousFacts || []}));
  const language = speechLanguages.has(plan.language) ? plan.language : 'en-IN';
  const copy = labels[language];
  if (plan.clarification || !plan.metrics.length) return {language,text:copy.redirect,facts:[]};
  const ago=n=>new Date(Date.parse(today+'T00:00:00Z')-n*86400000).toISOString().slice(0,10);
  let {start,end}=selected;
  if(plan.period==='today') start=end=today;
  if(plan.period==='yesterday') start=end=ago(1);
  if(plan.period==='lastDays') {
    if(plan.days<1 || plan.days>366) throw httpError(422,'Choose a period of 1 to 366 days.');
    start=ago(plan.days-1); end=today;
  }
  if(plan.period==='calendar') {start=plan.start;end=plan.end;}
  if (!start || !end || end < start || end > today || Date.parse(end)-Date.parse(start) >= 366*86400000)
    throw httpError(422,'Choose a past or current period of up to one year.');
  const keys=new Set(plan.metrics.map(m=>m.key));
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
  if(keys.has('soldOut')) values.soldOut=(await store.menuFor(restaurant)).filter(i=>i.soldOutDay===today).map(i=>[i.name,i.variant].filter(Boolean).join(' ')).join(', ') || copy.empty;
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
    else value=String(value);
    const current=key==='soldOut'||key==='vendorDue'||shopFields.includes(key);
    return {key,label:copy[key],value,start:current?today:start,end:current?today:end};
  });
  const periods=[...new Set(facts.map(f=>f.start+'/'+f.end))];
  const text=periods.map(period=>{
    const [a,b]=period.split('/');
    const rows=facts.filter(f=>f.start===a && f.end===b);
    const hindi=language==='hi-IN';
    const relative=a===b && ['hi-IN','en-IN'].includes(language);
    const when=relative && a===today ? (hindi?'आज':'Today')
      : relative && a===ago(1) ? (hindi?'कल':'Yesterday')
      : a===b ? dateText(a,language) : dateText(a,language)+' – '+dateText(b,language);
    if(rows.length===1 && rows[0].key==='topDish' && ['en-IN','hi-IN'].includes(language)){
      const top=values.topDish;
      if(!top.length) return hindi ? when+' कोई बिक्री दर्ज नहीं हुई।' : when+', there were no recorded sales.';
      const dishes=top.map(dish=>dish.name+' ('+dish.quantity+')').join(', ');
      return hindi ? when+' सबसे ज़्यादा बिका: '+dishes+'।' : when+', your best seller'+(top.length===1?' was ':'s were ')+dishes+'.';
    }
    const summary=rows.map(f=>f.label+' — '+f.value).join('. ')+'.';
    return rows.every(f=>shopFields.includes(f.key)) ? summary : when+'. '+summary;
  }).join(' ');
  return {language,text,facts};
}
