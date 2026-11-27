import phrases from '../locales/overview-speech.json' with {type:'json'};

const snapshot = new Set(['vendorDue','soldOut','menuCount','businessName','ownerName','phone','city','gst','payee','upi']);
const singular = {billCount:'billOne',paidCount:'paidOne',unpaidCount:'unpaidOne',partialCount:'partialOne',menuCount:'menuOne'};
const zero = {billCount:'noBills',vendorDue:'noDue',outstanding:'noOutstanding',partialCount:'noPartial',unpaidCount:'noUnpaid'};
const fill = (phrase, slots) => phrase.replace(/\{(\w+)\}/g, (_, key) => slots[key]);
const dayMs = 86400000;

export function scopeReply(language, courtesy) {
  const key=courtesy==='thanks' || courtesy==='listening' ? courtesy : 'redirect';
  return phrases[language][key];
}

export function speakFacts(facts, values, language, today) {
  const words=phrases[language];
  const date=new Intl.DateTimeFormat(language,{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'});
  const number=new Intl.NumberFormat(language,{maximumFractionDigits:3});
  const list=new Intl.ListFormat(language,{type:'conjunction'});
  function period(start,end) {
    const days=(Date.parse(end)-Date.parse(start))/dayMs+1;
    if(days===1){
      if(start===today) return words.today;
      if(Date.parse(today)-Date.parse(start)===dayMs) return words.yesterday;
      return fill(words.on,{date:date.format(new Date(start))});
    }
    if(end===today) return fill(words.recent,{days:number.format(days)});
    return fill(words.range,{start:date.format(new Date(start)),end:date.format(new Date(end))});
  }

  let lastPeriod;
  return facts.map(({key,value,label,start,end})=>{
    const raw=values[key];
    let phrase=key;
    const slots={v:value,field:label};
    if(key==='topDish'){
      const top=raw || [];
      phrase=top.length>1?'tied':top.length?'topDish':'noSales';
      slots.v=list.format(top.map(dish=>dish.name));
      slots.dish=top[0]?.name;
      slots.qty=top.length?number.format(top[0].quantity):'';
    } else if(key==='soldOut'){
      phrase=!raw.length?'noneSoldOut':raw.length>1?'soldOutList':'soldOut';
      slots.v=list.format(raw);
    } else if(raw==null || raw===''){
      phrase='missing';
    } else if(raw===0 && zero[key]){
      phrase=zero[key];
    } else if(raw===1 && singular[key]){
      phrase=singular[key];
    }
    const sentence=fill(words[phrase],slots);
    const currentPeriod=snapshot.has(key)?null:start+'/'+end;
    const prefix=currentPeriod && currentPeriod!==lastPeriod ? period(start,end)+' ' : '';
    lastPeriod=currentPeriod;
    const line=prefix+sentence;
    return line.charAt(0).toLocaleUpperCase(language)+line.slice(1);
  }).join(' ');
}
