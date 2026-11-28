// Research contract for the next native basket adapter. Never manufactures
// STRONG grades or approved hours. It consumes the canonical Outlook record.
export const basketPolicy=Object.freeze({schema:'APEX_NATIVE_BASKET_V1',targetGoldMove:5,stopLoss:null,holdMinutes:null,orderGapMs:100});
export function clipForEquity(equity){
 if(!Number.isFinite(equity)||equity<20)return 0;
 return equity>=1000?.50:equity>=500?.20:equity>=200?.10:equity>=100?.05:equity>=50?.02:.01;
}
// The native broker adapter tries these legal sizes, largest first, and
// checks actual OrderCheck margin for each. A preferred size is a ceiling,
// not a requirement or a fixed minimum.
export function candidateVolumes(preferred,minimum,maximum,step){
 if(![preferred,minimum,maximum,step].every(Number.isFinite)||step<=0||minimum<=0||maximum<minimum||preferred<minimum)return [];
 const high=Math.floor((Math.min(preferred,maximum)+1e-9)/step),low=Math.ceil((minimum-1e-9)/step);
 if(high-low>10000)return [];
 return Array.from({length:Math.max(0,high-low+1)},(_,i)=>Math.round((high-i)*step*1e8)/1e8);
}
export function basketFromEntry({id,side,entry,source}){
 if(typeof id!=='string'||!id||!['BUY','SELL'].includes(side)||!Number.isFinite(entry)||entry<=5||
    !['CANONICAL_STRONG_OUTLOOK','NATIVE_XAUCLOUD_PULLBACK'].includes(source))return null;
 return {schema:basketPolicy.schema,id,side,source,anchor:entry,target:Math.round((entry+(side==='BUY'?5:-5))*1e8)/1e8,stopLoss:null,holdMinutes:null};
}
// Approved hours are supplied by a versioned historical policy; they cannot
// be inferred from a signal, a preferred window, or the current quote.
export function canonicalStrongBasket(signal,approvedWatHours,now=Date.now()){
 if(!signal||signal.grade!=='STRONG'||signal.status!=='ACTIONABLE'||!Array.isArray(approvedWatHours)||
    !Number.isFinite(now)||!Number.isFinite(signal.publishedAt)||!Number.isFinite(signal.expiresAt)||
    signal.publishedAt>now||signal.expiresAt<=now)return null;
 const hour=new Date(signal.publishedAt+3600000).getUTCHours();
 if(!approvedWatHours.includes(hour))return null;
 return basketFromEntry({id:signal.id,side:signal.side,entry:signal.entry,source:'CANONICAL_STRONG_OUTLOOK'});
}

// Owner-selected 08:00–10:00 WAT session; not a claim of new profitability.
// Explicit override is parsed once and must contain valid unique WAT hours.
export function nativeOutlookHours(raw='8,9'){
 const xs=String(raw).split(',').map(x=>x.trim());
 if(!xs.length||xs.some(x=>!/^([0-9]|1[0-9]|2[0-3])$/.test(x)))throw Error('INVALID_NATIVE_OUTLOOK_HOURS');
 return [...new Set(xs.map(Number))];
}
export function nativeOutlookReplayCsv(signals,hours){
 if(!Array.isArray(signals)||!Array.isArray(hours))throw Error('INVALID_REPLAY_INPUT');
 const seen=new Set(),slots=new Set(),rows=[];
 for(const s of signals.filter(s=>s&&Number.isSafeInteger(s.publishedAt)).sort((a,b)=>a.publishedAt-b.publishedAt)){
  if(!s||s.engine!=='OUTLOOK'||s.canonical!==true||typeof s.id!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(s.id))continue;
  if(!Number.isSafeInteger(s.publishedAt)||!Number.isSafeInteger(s.expiresAt))continue;
  if(!canonicalStrongBasket(s,hours,s.publishedAt))continue;
  const slot=Math.floor(s.publishedAt/3600000);
  if(seen.has(s.id)||slots.has(slot))throw Error('DUPLICATE_CANONICAL_OUTLOOK');
  seen.add(s.id);slots.add(slot);
  const published=Math.ceil(s.publishedAt/1000),expires=Math.floor(s.expiresAt/1000);
  if(expires<=published||Math.floor(published/3600)!==slot)continue;
  rows.push([published,expires,s.id,s.side,s.entry,'STRONG',new Date(s.publishedAt+3600000).getUTCHours()].join(','));
 }
 return rows.length?rows.join('\n')+'\n':'';
}

export function nativeBasketStatus(input,now,armed){
 if(!input||!Number.isFinite(now)||typeof input.basketActive!=='boolean'||
    ![0,1,-1].includes(input.side)||!Number.isSafeInteger(input.positions)||input.positions<0||
    !Number.isSafeInteger(input.orders)||input.orders<0||![input.anchor,input.target].every(Number.isFinite))return null;
 if(input.basketActive?(input.side===0||input.anchor<=5||Math.abs(input.target-input.anchor-input.side*5)>1e-6):
    (input.side!==0||input.positions!==0||input.anchor!==0||input.target!==0))return null;
 const optionalFinite=(n)=>typeof n==='number'&&Number.isFinite(n)?n:null;
 const preferred=optionalFinite(input.preferredVolume),last=optionalFinite(input.lastFillVolume);
 if((preferred!==null&&preferred<0)||(last!==null&&(last<0||preferred!==null&&last>preferred+1e-8)))return null;
 return {observedAt:now,armed:armed===true,terminalArmed:typeof input.terminalArmed==='boolean'?input.terminalArmed:null,active:input.basketActive,side:input.side===1?'BUY':input.side===-1?'SELL':null,
  preferredVolume:preferred,lastFillVolume:last,freeMargin:optionalFinite(input.freeMargin),equity:optionalFinite(input.equity),
  orderGapMs:Number.isSafeInteger(input.orderGapMs)&&input.orderGapMs>0?input.orderGapMs:null,
  strategy:NATIVE_STRATEGIES.includes(input.strategy)?input.strategy:null,
  quote:input.quote&&Number.isFinite(input.quote.bid)&&Number.isFinite(input.quote.ask)&&input.quote.bid>0&&input.quote.ask>=input.quote.bid&&Number.isSafeInteger(input.quote.atMs)&&input.quote.atMs<=now+2000&&now-input.quote.atMs<=3000?{bid:input.quote.bid,ask:input.quote.ask,atMs:input.quote.atMs}:null,
  entrySource:typeof input.entrySource==='string'?input.entrySource.slice(0,100):null,
  diagnostic:typeof input.diagnostic==='string'?input.diagnostic.slice(0,200):null,
  buyScore:Number.isSafeInteger(input.buyScore)&&input.buyScore>=0&&input.buyScore<=30?input.buyScore:null,
  sellScore:Number.isSafeInteger(input.sellScore)&&input.sellScore>=0&&input.sellScore<=30?input.sellScore:null,
  anchor:input.basketActive?input.anchor:null,target:input.basketActive?input.target:null,positions:input.positions,orders:input.orders,stopLoss:null};
}

export const NATIVE_STRATEGIES=Object.freeze(['OUTLOOK','BOTH','PULLBACK']);
export function nativeStrategy(value,fallback='BOTH'){return NATIVE_STRATEGIES.includes(value)?value:fallback;}
export function nativeStrategyWire({armed,strategy,plan,signal}){
 if(!NATIVE_STRATEGIES.includes(strategy))throw Error('INVALID_NATIVE_STRATEGY');
 if(!armed)return 'NONE|NOT_ARMED|'+strategy;
 if(strategy==='PULLBACK'||!plan||!signal)return 'NONE|ARMED_NO_PLAN|'+strategy;
 return ['NATIVE',plan.id,plan.side,plan.anchor,plan.target,Math.floor(signal.publishedAt/1000),Math.floor(signal.expiresAt/1000),strategy].join('|');
}
