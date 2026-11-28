import copy from '../locales/overview-operations.json' with {type:'json'};

export const detailKeys=['orders','cashOrders','upiOrders','vendorBalances','vendorMismatches','maxPrice'];
const dishName=item=>[item.name,item.variant].filter(Boolean).join(' ');
const normalize=value=>value.normalize('NFKC').trim().toLocaleLowerCase();

export async function menuAction(store,understand,restaurant,transcript,action,previousIds,language,commit=fn=>fn()){
  const menu=await store.menuFor(restaurant);
  const words=copy[language];
  let candidates;
  if(action.target===null){
    candidates=menu.filter(item=>previousIds.includes(item.id));
  }else{
    const exact=menu.filter(item=>normalize(dishName(item))===normalize(action.target) || normalize(item.name)===normalize(action.target));
    if(exact.length) candidates=exact;
    else{
      const result=await understand('availabilityTarget',transcript,{menu:menu.map(({id,name,variant})=>({id,name,variant}))});
      candidates=menu.filter(item=>result.ids?.includes(item.id));
    }
  }
  if(candidates.length!==1) return {language,text:[words.choose,...candidates.slice(0,4).map(dishName)].join(' '),facts:[],pendingAvailability:action.kind,menuRefs:candidates.map(i=>i.id)};
  const [item]=candidates;
  const available=action.kind==='enable';
  const name=dishName(item);
  const text=language==='hi-IN'
    ? (available?name+' अब मेनू में उपलब्ध है।':name+' को आज के लिए अनुपलब्ध कर दिया है।')
    : language==='en-IN'
      ? (available?name+' is available to order again.':name+' is marked sold out for today.')
      : words[available?'enabled':'disabled']+' · '+name+'.';
  return commit(async()=>{
    await store.setAvailability(restaurant,[{item:item.id,available}]);
    return {language,text,facts:[],menuRefs:[item.id],menuChanged:true};
  });
}

export async function operationalDetails(store,restaurant,keys,start,end,today,language,vendorName){
  const words=copy[language];
  const currency=new Intl.NumberFormat(language,{style:'currency',currency:'INR',maximumFractionDigits:2,minimumFractionDigits:0});
  const money=paise=>currency.format(paise/100);
  const spoken=[];
  const sections=[];
  const facts=[];
  const menuRefs=[];
  const vendorMatches=name=>!vendorName || (name && normalize(name)===normalize(vendorName));
  function add(key,rows,current=false,sentence){
    const from=current?today:start, to=current?today:end;
    const title=words[key]+(current?'':' · '+(from===to?from:from+' – '+to));
    const preview=rows.slice(0,3).join('. ') || words.empty;
    const more=rows.length>3?' '+words.more.replace('{n}','3').replace('{total}',String(rows.length)):'';
    const clipped=preview.length>260;
    const excerpt=clipped?preview.slice(0,260)+'…':preview;
    spoken.push(sentence || title+' · '+excerpt+more+'.');
    sections.push({key,title,rows,clipped});
    facts.push({key,label:title,value:preview+more,start:from,end:to});
  }
  if(keys.includes('vendorBalances')){
    const {balances}=await store.vendors(restaurant);
    const due=balances.filter(b=>b.due>0 && vendorMatches(b.vendor)).sort((a,b)=>b.due-a.due);
    let sentence;
    if(language==='hi-IN' || language==='en-IN'){
      const list=new Intl.ListFormat(language,{type:'conjunction'});
      const hindi=language==='hi-IN';
      const entries=due.slice(0,3).map(b=>hindi?b.vendor+' को '+money(b.due):money(b.due)+' to '+b.vendor);
      if(due.length) sentence=hindi?'आपको '+list.format(entries)+' देना बाकी है।':'You owe '+list.format(entries)+'.';
      if(sentence && due.length>3) sentence+=' '+words.more.replace('{n}','3').replace('{total}',String(due.length));
    }
    add('vendorBalances',due.map(b=>b.vendor+' · '+money(b.due)),true,sentence);
  }
  if(keys.includes('maxPrice')){
    const menu=await store.menuFor(restaurant);
    const max=menu.reduce((n,i)=>Math.max(n,i.price),-1);
    const most=menu.filter(i=>i.price===max);
    menuRefs.push(...most.map(i=>i.id));
    add('maxPrice',most.map(i=>dishName(i)+' · '+money(i.price)),true);
  }
  const orderKeys=keys.filter(k=>['orders','cashOrders','upiOrders'].includes(k));
  if(orderKeys.length){
    const bills=await store.ordersInPeriod(restaurant,start,end);
    for(const key of orderKeys){
      const method=key==='cashOrders'?'cash':'upi';
      const rows=[];
      for(const bill of bills){
        const paidByMethod=(bill.movements ?? (bill.paid?[{method:bill.method,amount:bill.total}]:[]))
          .reduce((sum,p)=>sum+(p.method===method?p.amount:0),0);
        if(key!=='orders' && paidByMethod<=0) continue;
        const items=bill.lines.map(line=>line.quantity+' × '+dishName(line)).join(', ');
        rows.push('#'+String(bill.number).padStart(4,'0')+' · '+items+' · '+money(key==='orders'?bill.total:paidByMethod));
      }
      add(key,rows);
    }
  }
  if(keys.includes('vendorMismatches')){
    const invoices=await store.checkedInvoicesInPeriod(restaurant,start,end);
    const rows=[];
    const measure=m=>m?[m.quantity,m.unit].filter(x=>x!=null).join(' '):'—';
    for(const invoice of invoices.filter(i=>vendorMatches(i.vendor))){
      for(const row of invoice.check.rows.filter(r=>r.status==='difference')){
        rows.push([invoice.vendor,invoice.number,row.name,words.invoice+' '+measure(row),words.ordered+' '+measure(row.ordered),
          words.received+' '+measure(row.received)].filter(Boolean).join(' · '));
      }
    }
    add('vendorMismatches',rows);
  }
  return {facts,sections,menuRefs,spoken};
}
