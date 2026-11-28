import {z} from 'zod';
import words from '../locales/shop-actions.json' with {type:'json'};
import invoiceWords from '../locales/overview-operations.json' with {type:'json'};
import {basketSchema,entrySchema,shortText,vendorCorrection,vendorEntries} from '../schemas.mjs';
import {paymentDraft,receivedOn} from '../payment.mjs';
import {compareDelivery} from './delivery-check.mjs';
import {indiaDay} from '../../shared/menu-availability.mjs';
import {httpError} from '../errors.mjs';

const label=item=>[item.name,item.variant].filter(Boolean).join(' ');
const patch=value=>Object.fromEntries(Object.entries(value).filter(([,v])=>v!=null));
const same=(a,b)=>a.trim().normalize('NFKC').toLowerCase()===b.trim().normalize('NFKC').toLowerCase();

export async function performShopAction(store,understand,shopId,transcript,action,language,context){
  const {kind}=action, copy=words[language];
  const prior=context.priorWork?.kind===kind?context.priorWork:{};
  const reply=(text,extra={})=>({language,text,facts:[],...extra});
  const ask=(text,{billRefs,...details}={})=>reply(text||copy.missing,{
    ...(billRefs && {billRefs}),
    ...(kind==='vendor' && {vendorRefs:context.previousVendorRefs||[]}),
    work:{kind,transcript:[prior.transcript,transcript].filter(Boolean).join("\n").slice(-3000),question:text||copy.missing,...details},
  });
  const money=n=>new Intl.NumberFormat(language,{style:'currency',currency:'INR',maximumFractionDigits:2,minimumFractionDigits:0}).format(n/100);
  const parse=(task,fields)=>understand(task,transcript,{language,...fields,
    ...(prior.transcript && {clarificationReply:{previous:prior.transcript,question:prior.question}})});
  const commit=(fn,extra={})=>context.commit(async()=>reply(await fn(),{changed:true,...extra}));
  const billLabel=b=>copy.bill+' #'+String(b.number).padStart(4,'0');
  const balance=b=>copy.received+' '+money(receivedOn(b))+'. '+copy.due+' '+money(b.total-receivedOn(b))+'.';

  if(['bankPhoto','invoicePhoto','menuPhoto'].includes(kind))
    return reply(copy.upload,{openTab:{bankPhoto:'bank',invoicePhoto:'vendors',menuPhoto:'menu'}[kind]});

  if(kind==='billBalance' || kind==='billPayment'){
    const refs=context.previousBillRefs||[];
    const number=context.explicitBillNumber??(refs.length===1?refs[0]:null);
    if(number==null) return ask(copy.whichBill,{billRefs:refs});
    if(kind==='billBalance'){
      const bill=await store.billByNumber(shopId,number);
      if(!bill) throw httpError(404,'That bill number was not found in your shop.');
      const due=money(bill.total-receivedOn(bill));
      const received=money(receivedOn(bill));
      const text=language==='hi-IN'?billLabel(bill)+' पर '+due+' बाकी हैं। अब तक '+received+' मिले हैं।':
        language==='en-IN'?billLabel(bill)+' has '+due+' left to collect. You’ve received '+received+'.':billLabel(bill)+'. '+balance(bill);
      return reply(text,{billRefs:[bill.number]});
    }
    const result=await parse('order',{menu:[],basket:[],phrases:[],orderNote:null,resolvedBillNumber:number});
    if(result.question || !result.payment) return ask(result.question||copy.whichBill,{billRefs:[number]});
    const intent=result.payment;
    if(intent.number!==number) return ask(copy.whichBill,{billRefs:[]});
    const bill=await store.billByNumber(shopId,number);
    if(!bill) throw httpError(404,'That bill number was not found in your shop.');
    const change=paymentDraft(bill,intent);
    if(!change.method) return ask(copy.method,{billRefs:[bill.number]});
    const method=z.enum(['cash','upi']).parse(change.method);
    return commit(async()=>{
      const current=await store.billFor(shopId,bill.id);
      if(!current || (current.paymentRevision||0)!==change.revision)
        throw httpError(409,'The payment changed while I was checking. Please check the balance and try again.');
      const saved=await store.recordPayment(shopId,bill.id,method,change);
      if(!saved) throw httpError(404,'That bill could not be updated.');
      const due=money(saved.total-receivedOn(saved)),received=money(receivedOn(saved));
      if(language==='hi-IN') return billLabel(saved)+' पर '+(method==='cash'?'नकद':'यूपीआई से')+' भुगतान दर्ज हो गया। कुल '+received+' मिले हैं। '+(saved.total===receivedOn(saved)?'अब कुछ बाकी नहीं है।':'अभी '+due+' बाकी हैं।');
      if(language==='en-IN') return 'I’ve recorded the '+(method==='cash'?'cash':'UPI')+' payment on '+billLabel(saved)+'. You’ve received '+received+' in total, with '+due+' left to collect.';
      return billLabel(saved)+' · '+method.toUpperCase()+'. '+balance(saved);
    },{billRefs:[bill.number]});
  }

  if(kind==='vendor'){
    const ledger=await store.vendors(shopId);
    const recentEntries=ledger.events.filter(e=>!e.linkedPurchase);
    const previousVendorRefs=(context.previousVendorRefs||[]).filter(name=>ledger.balances.some(b=>same(b.vendor,name)));
    const result=await parse('vendor',{previousVendorRefs,vendors:ledger.balances,recentEntries:recentEntries.slice(0,100)});
    if(result.recipientSource==='reference' && (previousVendorRefs.length!==1 ||
       result.entries?.some(e=>!same(e.vendor,previousVendorRefs[0])) ||
       (result.editId!=null && !recentEntries.some(e=>e.id===result.editId && same(e.vendor,previousVendorRefs[0])))))
      return ask([copy.which,...previousVendorRefs.slice(0,4)].join(' '));
    if(result.question || result.recipientSource==='missing') return ask(result.question||copy.which);
    let update,names,description,payment;
    if(result.editId!=null){
      const entry=recentEntries.find(e=>e.id===result.editId);
      if(!entry) return ask(copy.which);
      const corrected=await parse('vendorEdit',{entry});
      if(corrected.question) return ask(corrected.question);
      const details=vendorCorrection.parse(corrected);
      if(details.paid>details.amount || (details.amount===0 && ['purchase','payment'].includes(entry.kind))) return ask(copy.missing);
      update=()=>store.correctVendor(shopId,{id:entry.id,revision:ledger.revision,details},true);
      names=[details.vendor];description=copy.saved+' #'+entry.id;
    }else{
      const entries=vendorEntries.parse(result.entries);
      if(!entries.length) return ask(copy.missing);
      names=[...new Set(entries.map(e=>e.vendor))];
      if(entries.length===1 && entries[0].kind==='payment') payment=entries[0];
      description=entries.map(e=>(e.kind==='payment'?copy.paid:copy.recorded)+' '+money(e.amount)+' · '+e.vendor).join('. ');
      update=async()=>{await store.postVendor(shopId,context.turnId,entries);return store.vendors(shopId);};
    }
    return commit(async()=>{
      const updated=await update();
      const vendor=payment && updated.balances.find(b=>same(b.vendor,payment.vendor));
      if(vendor && language==='hi-IN'){
        const rest=vendor.due<0?money(-vendor.due)+' अग्रिम जमा है।':vendor.due?money(vendor.due)+' देना बाकी है।':'कुछ देना बाकी नहीं है।';
        return vendor.vendor+' को '+money(payment.amount)+' का भुगतान दर्ज हो गया। अब '+rest;
      }
      if(vendor && language==='en-IN') return 'I’ve recorded '+money(payment.amount)+' paid to '+vendor.vendor+'. '+(vendor.due<0?'You have '+money(-vendor.due)+' in advance credit.':'You still owe '+money(vendor.due)+'.');
      const dues=updated.balances.filter(b=>names.some(n=>same(n,b.vendor))).map(b=>
        b.vendor+' · '+(b.due<0?copy.credit:copy.due)+' '+money(Math.abs(b.due)));
      return description+'. '+dues.join('. ')+'.';
    },{vendorRefs:names});
  }

  if(kind==='profileEdit'){
    const proposed=await parse('profilePatch',{});
    if(proposed.question) return ask(proposed.question);
    const changes=z.object({name:shortText.nullable(),businessName:shortText.nullable(),city:z.string().trim().max(96).nullable(),
      gstBps:z.number().int().min(0).max(10000).nullable()}).parse(proposed);
    const fields=patch(changes);
    if(!Object.keys(fields).length) return ask(copy.missing);
    return commit(async()=>{
      const profile=await store.accountDetails(context.uid),shop=await store.restaurantFor(context.uid);
      await store.updateProfile(context.uid,{name:profile.name,businessName:shop.name,city:shop.city,...fields});
      return copy.saved+' · '+Object.entries(fields).map(([k,v])=>k==='gstBps'?'GST '+v/100+'%':v).join(', ')+'.';
    });
  }

  if(kind==='invoiceCheck'){
    const invoices=await store.listInvoices(shopId);
    const target=await parse('invoiceTarget',{invoices:invoices.map(({_id:id,vendor,number})=>({id,vendor,number}))});
    const invoice=invoices.find(i=>i._id===target.id);
    if(!invoice || target.question) return ask(target.question||copy.which);
    const claim=await parse('deliveryClaim',{lines:invoice.lines.map(({name,unit},line)=>({line,name,unit}))});
    if(!claim.claims?.length) return ask(copy.missing);
    const check=compareDelivery(invoice,claim.claims);
    return commit(async()=>{
      await store.saveInvoiceCheck(shopId,invoice._id,invoice.revision,{...check,transcript});
      const labels=invoiceWords[language];
      const differences=check.rows.filter(row=>row.status==='difference').map(row=>
        row.name+' · '+labels.invoice+' '+row.quantity+' '+(row.unit||'')+
        ' · '+labels.received+' '+(row.received?.quantity??'—')+' '+(row.received?.unit||''));
      return [copy.saved+' · '+[invoice.vendor,invoice.number].filter(Boolean).join(' '),...differences].join('. ')+'.';
    });
  }

  const menu=await store.menuFor(shopId);
  const menuContext=menu.map(({id,name,variant,soldOutDay})=>({id,name,variant,soldOut:soldOutDay===indiaDay()}));
  if(kind==='menuAdd'){
    const result=await parse('menu',{menu:menuContext,previous:[]});
    if(result.question || !result.entries?.length) return ask(result.question);
    const entries=z.array(entrySchema).min(1).max(80).parse(result.entries);
    return commit(async()=>{const imported=await store.importMenu(shopId,entries);
      return copy.saved+' · '+imported.added+'/'+entries.length+'.';});
  }
  if(kind==='menuEdit'){
    const result=await parse('menuPatch',{menu:menu.map(({id,name,variant,category,price})=>({id,name,variant,category,price}))});
    const existing=menu.find(i=>i.id===result.id);
    if(result.question || !existing) return ask(result.question||copy.which);
    const {id,question,...values}=result;
    const changes=patch(values);
    if(!Object.keys(changes).length) return ask(copy.missing);
    return commit(async()=>{
      const current=(await store.menuFor(shopId)).find(i=>i.id===id);
      if(!current) throw httpError(409,'The menu item has changed.');
      const entry=entrySchema.parse({...entrySchema.strip().parse(current),...changes});
      if(!await store.editMenu(shopId,id,entry)) throw httpError(409,'The menu item has changed.');
      return copy.saved+' · '+label(entry)+' · '+money(entry.price)+'.';
    });
  }
  const phrases=await store.phrasesFor(shopId);
  if(kind==='order'){
    const result=await parse('order',{menu:menuContext,phrases,basket:prior.lines||[],orderNote:prior.orderNote||null});
    if(result.payment) return ask(copy.whichBill);
    if(result.question) return ask(result.question,{lines:prior.lines||[],orderNote:prior.orderNote||null});
    const lines=basketSchema.parse(result.lines);
    const prices={};
    for(const line of lines){
      const item=menu.find(i=>i.id===line.item);
      if(!item || item.soldOutDay===indiaDay()) throw httpError(409,'An ordered item is unavailable.');
      prices[item.id]=item.price;
    }
    if(!lines.length) return reply(copy.draft+' · 0.');
    const note=z.string().trim().max(600).nullish().parse(result.orderNote);
    if(!result.readyToBill){
      const summary=lines.map(l=>l.quantity+' × '+label(menu.find(i=>i.id===l.item))).join(', ');
      return ask(copy.draft+' · '+summary+'. '+copy.confirmBill,{lines,orderNote:note});
    }
    return context.commit(async()=>{
      const bill=await store.createBill(shopId,context.turnId,lines,prices,context.shop.gstBps||0,note);
      if(!bill) throw httpError(409,'An item changed before billing.');
      return reply(billLabel(bill)+' · '+copy.due+' '+money(bill.total)+'.',{changed:true,billRefs:[bill.number]});
    });
  }
  if(kind==='phraseSave' || kind==='phraseDelete'){
    const target=await parse('phraseTarget',{phrases:phrases.map(({id,name})=>({id,name})),pendingDeleteId:prior.deleteId});
    const existing=phrases.find(p=>p.id===(target.id??(target.mode==="confirmDelete"?prior.deleteId:null)));
    if(target.question || target.mode==='unclear') return ask(target.question||copy.which);
    if(kind==='phraseDelete'){
      if(!existing) return ask(copy.which);
      if(target.mode!=='confirmDelete' || prior.deleteId!==existing.id) return ask(existing.name+'. '+copy.confirmDelete,{deleteId:existing.id});
      return commit(async()=>{await store.forgetPhrase(shopId,existing.id);return copy.saved+' · '+existing.name+'.';});
    }
    if(!['create','update'].includes(target.mode) || (target.mode==='update' && !existing)) return ask(copy.which);
    const result=await parse('phrase',{menu:menuContext,previous:existing||null,basket:[]});
    if(result.question || !result.name || !result.lines?.length) return ask(result.question);
    const name=shortText.parse(result.name),lines=basketSchema.parse(result.lines);
    return commit(async()=>{await store.savePhrase(shopId,existing?.id,name,lines);return copy.saved+' · '+name+'.';});
  }
  throw httpError(422,'This action is unavailable.');
}
