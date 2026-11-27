import { z } from 'zod';
import { indiaDay } from '../../shared/menu-availability.mjs';
import { httpError } from '../errors.mjs';

export const overviewMetrics = ['billedSales','collections','billCount','paidCount','paidValue','unpaidCount','partialCount','outstanding','topDish','vendorPurchases','vendorPaid','vendorDue','soldOut'];
const planSchema = z.object({
  period:z.enum(['today','yesterday','lastDays','calendar','selected']), days:z.number().int(),
  start:z.iso.date().nullable(), end:z.iso.date().nullable(), language:z.string().regex(/^[a-z]{2,3}-IN$/),
  metrics:z.array(z.object({key:z.enum(overviewMetrics), label:z.string().trim().min(1).max(120)})).max(15),
  empty:z.string().trim().max(100), clarification:z.string().trim().max(300).nullable(),
});
export const speechLanguages = new Set('hi bn ta te gu kn ml mr pa od en'.split(' ').map(code=>code+'-IN'));
const money = new Set(['billedSales','collections','paidValue','outstanding','vendorPurchases','vendorPaid','vendorDue']);
const dateText = (iso, locale) => new Intl.DateTimeFormat(locale,{dateStyle:'medium',timeZone:'UTC'}).format(new Date(iso+'T00:00:00Z'));

export async function overviewAnswer(store, understand, restaurant, transcript, selected, today=indiaDay()) {
  const plan = planSchema.parse(await understand('overview',transcript,{today}));
  const {language} = plan;
  if (plan.clarification || !plan.metrics.length) return {language,text:plan.clarification || 'Ask about sales, bills, menu availability or vendor totals.', facts:[]};
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
  const values={};
  if ([...keys].some(k=>!k.startsWith('vendor') && k!=='soldOut')) Object.assign(values,await store.overviewFigures(restaurant,start,end));
  if ([...keys].some(k=>k.startsWith('vendor'))) {
    const ledger=await store.vendors(restaurant);
    const events=ledger.events.filter(e=>!e.linkedPurchase && indiaDay(Date.parse(e.created))>=start && indiaDay(Date.parse(e.created))<=end);
    values.vendorPurchases=events.reduce((n,e)=>n+(e.kind==='purchase'?e.amount:0),0);
    values.vendorPaid=events.reduce((n,e)=>n+e.paid,0);
    values.vendorDue=ledger.balances.reduce((n,b)=>n+Math.max(0,b.due),0);
  }
  if(keys.has('soldOut')) values.soldOut=(await store.menuFor(restaurant)).filter(i=>i.soldOutDay===today).map(i=>[i.name,i.variant].filter(Boolean).join(' ')).join(', ') || plan.empty;
  const currency=new Intl.NumberFormat(language,{style:'currency',currency:'INR',minimumFractionDigits:0,maximumFractionDigits:2});
  const facts=plan.metrics.map(({key,label})=>{
    let value=values[key];
    if(money.has(key)) value=currency.format(value/100);
    else if(key==='topDish') value=value.length ? value.map(r=>r.name+' × '+r.quantity).join(', ') : plan.empty;
    else value=String(value);
    const current=key==='soldOut'||key==='vendorDue';
    return {key,label,value,start:current?today:start,end:current?today:end};
  });
  const periods=[...new Set(facts.map(f=>f.start+'/'+f.end))];
  const text=periods.map(period=>{
    const [a,b]=period.split('/');
    return (a===b?dateText(a,language):dateText(a,language)+' – '+dateText(b,language))+'. '+
      facts.filter(f=>f.start===a&&f.end===b).map(f=>f.label+' — '+f.value).join('. ')+'.';
  }).join(' ');
  return {language,text,facts};
}
