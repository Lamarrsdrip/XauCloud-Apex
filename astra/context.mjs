import crypto from 'node:crypto';

function fail(){throw new Error('INVALID_MARKET_CONTEXT');}
function number(x,{min=-1e15,max=1e15}={}){if(typeof x!=='number'||!Number.isFinite(x)||x<min||x>max)fail();return x;}
function text(x,max=128){if(typeof x!=='string'||x.length>max||/[\x00-\x1f]/.test(x))fail();return x;}
const positive=x=>number(x,{min:0});
const mean=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:0;
const last=a=>a.at(-1);

function candles(input,limit,now) {
  if(!Array.isArray(input)||input.length<3||input.length>limit)fail();
  return input.map((x,i)=>{
    const time=number(x.time,{min:1,max:now+2000});
    if(i&&time<=input[i-1].time)fail();
    const open=positive(x.open),high=positive(x.high),low=positive(x.low),close=positive(x.close);
    if(low>Math.min(open,close)||high<Math.max(open,close)||low>high||low===0)fail();
    const body=Math.abs(close-open),range=high-low;
    return {time,open,high,low,close,body,range,upperWick:high-Math.max(open,close),
      lowerWick:Math.min(open,close)-low,direction:close>open?'UP':close<open?'DOWN':'FLAT'};
  });
}
function atr(bars) {
  return mean(bars.slice(-14).map((b,i,arr)=>{
    const previous=bars[bars.indexOf(b)-1];
    return previous?Math.max(b.high-b.low,Math.abs(b.high-previous.close),Math.abs(b.low-previous.close)):b.high-b.low;
  }));
}
function summary(bars) {
  const a=atr(bars),b=last(bars),first=bars[Math.max(0,bars.length-8)];
  return {atr:a,netMove:b.close-first.open,impulseAtr:a?(b.close-first.open)/a:0,
    high:Math.max(...bars.slice(-30).map(x=>x.high)),low:Math.min(...bars.slice(-30).map(x=>x.low)),
    lastDirection:b.direction,upBars:bars.slice(-7).filter(x=>x.direction==='UP').length,
    downBars:bars.slice(-7).filter(x=>x.direction==='DOWN').length};
}

// These are causal, deterministic measurements. Their names describe price
// events, not proven liquidity, the trader's private indicator, or a calibrated edge.
export function buildContext(snapshot,{now=Date.now()}={}) {
  if(!snapshot||typeof snapshot!=='object')fail();
  const snapshotId=text(snapshot.snapshotId,128),symbol=text(snapshot.symbol,40);
  if(!snapshotId||!symbol.toUpperCase().includes('XAU'))fail();
  const observedAtMs=number(snapshot.observedAtMs,{min:now-8000,max:now+2000});
  const bid=positive(snapshot.quote?.bid),ask=positive(snapshot.quote?.ask);
  if(!bid||ask<bid)fail();
  const ageMs=number(snapshot.quote.ageMs,{min:0,max:3000});
  const q={bid,ask,spread:ask-bid,ageMs,timestamp:observedAtMs-ageMs};
  const account={};
  for(const name of ['balance','equity','freeMargin','marginLevel','leverage'])account[name]=number(snapshot.account?.[name],{min:name==='leverage'?1:-1e12,max:1e12});
  account.floatingProfit=number(snapshot.account.floatingProfit??(account.equity-account.balance));
  if(!['NORMAL','UNLIMITED'].includes(snapshot.account.profile))fail();
  account.profile=snapshot.account.profile;
  const m1=candles(snapshot.candles?.m1,180,observedAtMs),m3=candles(snapshot.candles?.m3,60,observedAtMs),m5=candles(snapshot.candles?.m5,60,observedAtMs);
  if(m1.length<20||observedAtMs-last(m1).time>180000)fail();
  // Input arrays explicitly contain CLOSED candles. A timestamp is a bar OPEN time.
  for(const [arr,seconds] of [[m1,60],[m3,180],[m5,300]])if(last(arr).time+seconds*1000>observedAtMs+2000)fail();
  const a=atr(m1);if(a<=0)fail();
  for(const bars of [m1,m3,m5]) {
    const ownAtr=atr(bars);
    for(const b of bars){b.rangeAtr=b.range/ownAtr;b.bodyAtr=b.body/ownAtr;b.atrTimeframe=bars===m1?'M1':bars===m3?'M3':'M5';}
  }
  const raw=snapshot.campaign||{},positions=raw.positions;
  if(!Array.isArray(positions)||positions.length>200)fail();
  const c={id:text(raw.id||'',128),owner:raw.owner||'LIFESTYLE_NATIVE',direction:raw.direction||'NONE',
    layers:number(raw.layers??positions.length,{min:0,max:100000}),
    l1Price:positive(raw.l1Price??0),weightedEntry:positive(raw.weightedEntry??0),lastAddPrice:positive(raw.lastAddPrice??0),
    basketProfit:number(raw.basketProfit??0),mfe:number(raw.mfe??0),mae:number(raw.mae??0),
    positions:positions.map(p=>({ticket:text(String(p.ticket),32),price:positive(p.price),volume:positive(p.volume)}))};
  c.profitMfe=c.mfe;c.profitMae=c.mae;c.excursionUnit='ACCOUNT_CURRENCY_BASKET_PNL_NOT_GOLD_PRICE';
  if(!['ASTRA','LIFESTYLE_NATIVE'].includes(c.owner)||!['BUY','SELL','NONE'].includes(c.direction))fail();
  if(positions.length&&(!c.id||c.direction==='NONE'||!c.l1Price||c.layers<1))fail();
  const b=last(m1),prev=m1.at(-2),third=m1.at(-3),recent=m1.slice(-8),history=m1.slice(0,-8).slice(-60);
  const high=Math.max(...history.map(x=>x.high)),low=Math.min(...history.map(x=>x.low));
  const upper=recent.filter(x=>x.high>high),lower=recent.filter(x=>x.low<low);
  const latestUpper=last(upper),latestLower=last(lower);
  const upperSweep=latestUpper?{time:latestUpper.time,level:high,extreme:Math.max(...upper.map(x=>x.high)),penetrationAtr:(Math.max(...upper.map(x=>x.high))-high)/a}:null;
  const lowerSweep=latestLower?{time:latestLower.time,level:low,extreme:Math.min(...lower.map(x=>x.low)),penetrationAtr:(low-Math.min(...lower.map(x=>x.low)))/a}:null;
  const recentHigh=Math.max(...m1.slice(-20).map(x=>x.high)),recentLow=Math.min(...m1.slice(-20).map(x=>x.low));
  const bosSell=b.close<prev.low,bosBuy=b.close>prev.high;
  const failedBullishRecovery=prev.close>prev.open&&b.close<prev.low;
  const failedBearishRecovery=prev.close<prev.open&&b.close>prev.high;
  const signed=c.direction==='BUY'?1:c.direction==='SELL'?-1:0,executable=c.direction==='BUY'?bid:ask;
  const pivots={highs:[],lows:[]};
  for(let i=2;i<m1.length-2;i++) {
    const x=m1[i],near=m1.slice(i-2,i+3);
    if(near.every(y=>y===x||x.high>y.high))pivots.highs.push({time:x.time,price:x.high,confirmedAt:m1[i+2].time+60000});
    if(near.every(y=>y===x||x.low<y.low))pivots.lows.push({time:x.time,price:x.low,confirmedAt:m1[i+2].time+60000});
  }
  let ticks=[];
  if(snapshot.recentTicks!==undefined) {
    if(!Array.isArray(snapshot.recentTicks)||snapshot.recentTicks.length>160)fail();
    ticks=snapshot.recentTicks.map((t,i)=>{
      const time=number(t.time,{min:observedAtMs-120000,max:observedAtMs+2000});
      if(i&&time<snapshot.recentTicks[i-1].time)fail();
      const tb=positive(t.bid),ta=positive(t.ask);if(!tb||ta<tb)fail();return {time,bid:tb,ask:ta};
    });
  }
  // Intrabar event sequence: a local counterpush of at least current spread
  // (quote noise is excluded), followed by a fresh break back through its origin.
  // No fixed Gold distance turns this measurement into an ADD command.
  const micro={sell:false,buy:false,eventTime:0};
  for(let i=2;i<ticks.length;i++) {
    const before=ticks.slice(0,i),lo=Math.min(...before.map(t=>t.bid)),hi=Math.max(...before.map(t=>t.ask));
    const t=ticks[i],p=ticks[i-1],spread=Math.max(q.spread,t.ask-t.bid);
    if(p.bid-lo>=spread&&t.bid<lo){micro.sell=true;micro.eventTime=t.time;}
    if(hi-p.ask>=spread&&t.ask>hi){micro.buy=true;micro.eventTime=t.time;}
  }
  const structure={atr:a,pointMeasurementsOnly:true,levelSelection:'ROLLING_WINDOW_EXTREMA_AND_CONFIRMED_LOCAL_PIVOTS_NOT_VERIFIED_TRADER_LEVELS',approach:summary(m1),
    swingHighs:pivots.highs.slice(-8),swingLows:pivots.lows.slice(-8),
    localFailedRecoveryOrigin:failedBullishRecovery?{time:prev.time,price:prev.high,direction:'SELL'}:
      failedBearishRecovery?{time:prev.time,price:prev.low,direction:'BUY'}:null,
    opposingReactionCandidates:{below:pivots.lows.filter(x=>x.price<bid).slice(-4),above:pivots.highs.filter(x=>x.price>ask).slice(-4)},
    approachVelocityPerSecond:(b.close-third.open)/180,meaningfulHigh:high,meaningfulLow:low,
    upperSweep,lowerSweep,upperFailedAcceptance:!!upperSweep&&b.close<high,
    lowerFailedAcceptance:!!lowerSweep&&b.close>low,
    upperAcceptanceCloses:recent.filter(x=>x.close>high).length,lowerAcceptanceCloses:recent.filter(x=>x.close<low).length,
    upperRejectionWickRatio:b.upperWick/Math.max(b.body,0.000001),lowerRejectionWickRatio:b.lowerWick/Math.max(b.body,0.000001),
    bosSell,bosBuy,microBosSell:bid<Math.min(prev.low,b.low),microBosBuy:ask>Math.max(prev.high,b.high),
    displacementAtr:b.body/a,failedBullishRecovery,failedBearishRecovery,
    continuationSell:bosSell&&prev.close<third.low,continuationBuy:bosBuy&&prev.close>third.high,
    microFailedCounterpush:micro,
    distanceFromUpperOriginAtr:(recentHigh-bid)/a,distanceFromLowerOriginAtr:(ask-recentLow)/a,
    triggerExtensionSellAtr:Math.max(0,b.close-bid)/a,triggerExtensionBuyAtr:Math.max(0,ask-b.close)/a,
    upperSetupAgeSec:upperSweep?(observedAtMs-upperSweep.time)/1000:null,
    lowerSetupAgeSec:lowerSweep?(observedAtMs-lowerSweep.time)/1000:null,
    favorableSinceL1:signed&&c.l1Price?signed*(executable-c.l1Price):0,
    favorableSinceLastAdd:signed&&c.lastAddPrice?signed*(executable-c.lastAddPrice):0,
    recentHigh,recentLow,volatility:summary(m1).atr};
  structure.eventKey=crypto.createHash('sha256').update(JSON.stringify({bar:b.time,bosSell,bosBuy,failedBullishRecovery,failedBearishRecovery,
    microEvent:micro.eventTime,lowerBreak:structure.microBosSell,upperBreak:structure.microBosBuy})).digest('hex').slice(0,24);
  let forming=null;
  if(snapshot.forming!==undefined) {
    const f=snapshot.forming;if(f.isClosed!==false)fail();
    const time=number(f.time,{min:last(m1).time+60000,max:observedAtMs+2000});
    const open=positive(f.open),high=positive(f.high),low=positive(f.low),close=positive(f.close);
    if(low<=0||low>Math.min(open,close)||high<Math.max(open,close))fail();
    forming={isClosed:false,time,open,high,low,close};
  }
  return {schemaVersion:1,snapshotId,observedAtMs,symbol,quote:q,account,candles:{m1,m3,m5},forming,
    higherContext:{m3:summary(m3),m5:summary(m5)},structure,campaign:c,recentTicks:ticks};
}
