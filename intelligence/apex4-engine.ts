import { createHash } from "node:crypto";
import { analyzeFrame, aggregate, sideCandidates, STRATEGY_EVIDENCE, type Bar, type Frame, type Market, type Side } from "./xaucloud/aiOpportunityEngine.ts";
import { caseFeatures, discoverLessons, holdoutExam, type TradingCase } from "./xaucloud/aiTradingEducation.ts";
import { discoverQualityRules, gradeFor, gradeHistory, assessOutlookQuality, validateQuality, type QualityRule } from "./xaucloud/aiOutlookQuality.ts";
import { resolveHourlyBias } from "./xaucloud/marketOutlookSignal.ts";
import { computeZoneAndTargets, expectedPath } from "./xaucloud/marketOutlookConfidence.ts";
import { evaluateOwnerPolicy, clampGoldStopToMaxDistance, XAUCLOUD_TP1_GOLD_MOVES, XAUCLOUD_TP2_GOLD_MOVES } from "./xaucloud/marketOutlookCore.ts";
import { usableCurrentQuote } from "./xaucloud/aiCurrentOpportunity.ts";
import { isMarketOpen } from "./xaucloud/marketCalendar.ts";
type Row = Record<string, unknown>;
export type Quote={bid:number;ask:number;at:string};
export type Plan={id:string;kind:"OUTLOOK"|"PULLBACK";side:Side;entry:number;sl:number;tp1:number;tp2:number;published:number;expires:number;reason:string;grade?:string;source:string;group?:string};
export type PullbackCase={at:number;group:string;r:number;tp2:boolean;maeR:number;minutes:number};
export type PullbackGroup={group:string;train:{n:number;avgR:number};validation:{n:number;avgR:number}};
export type Knowledge={version:string;builtAt:number;dataThrough:number;rules:QualityRule[];history:ReturnType<typeof gradeHistory>;hours:number[];pullbacks:PullbackGroup[];diagnostics:Row};
const VERSION="APEX4_XAUCLOUD_DETERMINISTIC_V1";
const hash=(s:string)=>createHash("sha256").update(s).digest("hex").slice(0,24);
const r2=(x:number)=>Math.round(x*100)/100;
const sg=(s:Side)=>s==="BUY"?1:-1;
const hourWAT=(t:number)=>new Date(t+3600000).getUTCHours();
const avg=(xs:number[])=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:0;
const stat=(xs:PullbackCase[])=>({n:xs.length,avgR:avg(xs.map(c=>c.r))});
export const USER_PRIORITY_HOURS_WAT=[8,9,10] as const;
export function normalizeBars(raw:unknown):Bar[]{
 if(!Array.isArray(raw)||raw.length>15000)throw Error("INVALID_BARS");
 const out=new Map<number,Bar>();
 for(const b of raw){
   if(!b||typeof b!=="object")throw Error("INVALID_BAR");
   const {t,o,h,l,c}=b as Bar;
   if(![t,o,h,l,c].every(Number.isFinite)||t<0||t%60000!==0||l<=0||l>Math.min(o,c)||h<Math.max(o,c))throw Error("INVALID_BAR");
   out.set(t,{t,o,h,l,c});
 }
 return [...out.values()].sort((a,b)=>a.t-b.t);
}
export function brokerFrames(raw:Bar[],q:Quote,now:number):Market|null{
 if(!usableCurrentQuote(q,now)||now-Date.parse(q.at)>3000||Date.parse(q.at)>now+2000)return null;
 const past=raw.filter(b=>b.t+60000<=now).slice(-7500);
 const last=past.at(-1);
 if(!last||now-last.t-60000>90000||past.filter(b=>b.t>=now-150*60000).length<135)return null;
 const frame=(m:number)=>analyzeFrame(m===1?past:aggregate(past,m,now,Math.ceil(m*.9)));
 const m1=frame(1),m5=frame(5),m15=frame(15);
 if(!m1||!m5||!m15||m1.atr<=0||m5.atr<=0)return null;
 return {now,bid:q.bid,ask:q.ask,m1,m5,m15,h1:frame(60),m10:frame(10),m30:frame(30)};
}
function planOK(p:Plan):boolean{
 const s=sg(p.side);
 return [p.entry,p.sl,p.tp1,p.tp2,p.published,p.expires].every(Number.isFinite)&&p.sl>0&&p.tp2>0&&p.expires>p.published&&s*(p.entry-p.sl)>0&&s*(p.tp1-p.entry)>0&&s*(p.tp2-p.tp1)>0;
}
// Use the actual XauCloud upstream thesis only when the evidence producer is available.
// This is not a claim that a guessed M10 adapter is the original EA.
export function outlookFromCanonicalEvidence(input:{canonicalM10:Row;thesis:Row;quote:Quote;htfComplete:boolean;brainRecommendation?:string;observedAt:number},now:number):Plan|null{
 const {canonicalM10,thesis,quote}=input;
 if(!input.htfComplete||!usableCurrentQuote(quote,now)||now-input.observedAt>3000||input.observedAt>now+2000||!isMarketOpen(new Date(now)))return null;
 if(["REJECT","WAIT"].includes(input.brainRecommendation??""))return null;
 const b=resolveHourlyBias(canonicalM10,thesis);
 if(b.direction_label!=="BUY"&&b.direction_label!=="SELL"||!evaluateOwnerPolicy(canonicalM10).allowed)return null;
 const side=b.direction_label,s=sg(side),mid=(quote.bid+quote.ask)/2,entry=s>0?quote.ask:quote.bid;
 const structuralEntry=Number(thesis.structural_entry),structuralSL=Number(thesis.structural_sl),atr=Number(thesis.atr_m5);
 const useStructural=structuralEntry>0&&structuralSL>0&&atr>0;
 const sl=useStructural?clampGoldStopToMaxDistance(structuralEntry,structuralSL,s):computeZoneAndTargets(s,mid,thesis,atr>0?atr:mid*.0035).suggested_sl;
 const zoneMid=useStructural?structuralEntry:(()=>{const z=computeZoneAndTargets(s,mid,thesis,atr>0?atr:mid*.0035);return(z.preferred_entry_zone_low+z.preferred_entry_zone_high)/2;})();
 if(Math.abs(zoneMid-mid)>Math.max((atr>0?atr:Math.max(1,mid*.005))*5,mid*.02))return null;
 const p:Plan={id:hash("OUTLOOK:"+Math.floor(now/3600000)),kind:"OUTLOOK",side,entry,sl:r2(sl),tp1:r2(entry+s*XAUCLOUD_TP1_GOLD_MOVES),tp2:r2(entry+s*XAUCLOUD_TP2_GOLD_MOVES),published:now,expires:now+25000,reason:expectedPath(s,thesis),source:"VENDORED_XAUCLOUD_BIAS_CANONICAL_INPUT"};
 return planOK(p)?p:null;
}
// Independently generated experimental outlook; no source parity assertion.
// Uses actual XauCloud feature extraction and directional resolver, NOT a fabricated M10 signal.
// Keep output observable in research; cannot authorize a production trade.
export function localOutlookResearch(raw:Bar[],quote:Quote,now:number):{plan:Plan|null;features:Row;status:string}{
 const mk=brokerFrames(raw,quote,now);
 if(!mk||!isMarketOpen(new Date(now)))return {plan:null,features:{},status:"MISSING_BROKER_DATA"};
 const f=mk.m5!,h=mk.m15!, m1=mk.m1!;
 const pressure=(f.pressure+h.pressure+m1.pressure)/3;
 const buy=Math.max(0,Math.min(100,50+pressure*50)),sell=100-buy;
 const thesis:Row={buy_pressure:buy,sell_pressure:sell,structure:"STRUCTURE_MIXED",market_regime:f.trend,atr_m5:f.atr,
  exhaustion_pct:Math.min(100,Math.abs(f.extension)*25),movement_consumed_pct:Math.min(100,Math.abs(f.extension)*25),
  location:Math.abs(f.extension)>2?"LOCATION_LATE":"LOCATION_ACCEPTABLE",remaining_room_r:Math.max(.5,2-Math.abs(f.extension)*.3)};
 // Empty canonical direction is intentional; the real resolver decides only from pressure.
 const bias=resolveHourlyBias({},thesis);
 if(bias.direction_label!=="BUY"&&bias.direction_label!=="SELL")return{plan:null,features:thesis,status:"NEUTRAL"};
 const side=bias.direction_label,s=sg(side),entry=s>0?quote.ask:quote.bid;
 const z=computeZoneAndTargets(s,(quote.ask+quote.bid)/2,thesis,f.atr);
 const p:Plan={id:hash("LOCAL_OUTLOOK:"+Math.floor(now/3600000)),kind:"OUTLOOK",side,entry,sl:z.suggested_sl,tp1:r2(entry+s*5),tp2:r2(entry+s*10),published:now,expires:now+25000,reason:expectedPath(s,thesis),source:"EXPERIMENTAL_LOCAL_EVIDENCE_NOT_M10_PARITY"};
 return {plan:planOK(p)?p:null,features:{...thesis,confidence_pct:bias.confidence,structure_state:thesis.structure},status:"LOCAL_RESEARCH_ONLY"};
}
// Pullback-specific candidate: use the real XauCloud M1 feature implementation.
// Quote is observed NOW. Completed candles never include future or forming highs/lows.
export function pullbackCandidate(raw:Bar[],q:Quote,now:number):Plan|null{
 const mk=brokerFrames(raw,q,now);
 return mk&&isMarketOpen(new Date(now))?pullbackFromMarket(mk,q,now):null;
}
function pullbackFromMarket(mk:Market,q:Quote,now:number):Plan|null{
 const f=mk.m1!,slow=mk.m5!,higher=mk.m15!;
 const s=slow.trend==="UP"?-1:slow.trend==="DOWN"?1:0;
 if(!s||higher.trend==="RANGE")return null;
 const side:Side=s>0?"BUY":"SELL",entry=s>0?q.ask:q.bid;
 const stretched=s*slow.extension<=-1.2|| (s>0?slow.rsi<35:slow.rsi>65);
 const turn=s>0?(f.sweptLow||f.lowerRejection||f.bullishDivergence):(f.sweptHigh||f.upperRejection||f.bearishDivergence);
 const shift=s>0?f.structureShiftUp||f.brokeUp:f.structureShiftDown||f.brokeDown;
 const liveTurn=s*(entry-f.close)>f.atr*.1;
 // Earlier bar evidence + live quote; no requirement to wait for another bar.
 if(!stretched||!(turn||shift)||!(s*f.acceleration>0||s*f.pressure>.1||liveTurn))return null;
 const execution:Market={...mk,m5:f,h1:slow,m15:higher};
 const rawIdeas=sideCandidates(execution,side,15).filter(c=>["COUNTERTREND_CORRECTION","EXHAUSTION_REVERSAL","FAILED_BREAKOUT","SR_REJECTION"].includes(c.strategy));
 const adverse=s>0?Math.min(f.last.l,f.lastSwingLow??f.last.l):Math.max(f.last.h,f.lastSwingHigh??f.last.h);
 const stop=r2(adverse-s*(f.atr*.25+(q.ask-q.bid)));
 // The retracement target is bounded by the prior move's mean rather than promising reversal.
 const room=s*(slow.emaFast-entry);
 if(!(room>0)||s*(entry-stop)<=0)return null;
 const risk=Math.abs(entry-stop),dist=Math.min(room,f.atr*2);
 if(dist<risk+(q.ask-q.bid))return null;
 const group=[side,turn?"REJECTION":"SHIFT",Math.abs(slow.extension)>=2?"EXTREME":"STRETCHED",s*f.pressure>0?"PRESSURE":"TURN"].join("|");
 const p:Plan={id:hash("PULLBACK:"+side+":"+f.last.t),kind:"PULLBACK",side,entry,sl:stop,tp1:r2(entry+s*dist*.5),tp2:r2(entry+s*dist),published:now,expires:now+12000,reason:group+"; "+rawIdeas.map(c=>c.strategy).join(","),source:"XAUCLOUD_M1_FEATURES_EXPERIMENTAL_PULLBACK",group};
 return planOK(p)?p:null;
}
// Score the TP2-only basket exit policy, not XauCloud's thirds-at-targets P&L.
// Minute data cannot prove sub-second execution. Stop is pessimistically checked first.
export function replayPullback(p:Plan,bars:Bar[],spread:number,slippage:number,horizon=20):PullbackCase|null{
 const after=bars.filter(b=>b.t>=Math.ceil(p.published/60000)*60000&&b.t<p.published+horizon*60000);
 if(after.length<horizon-2)return null;
 const s=sg(p.side),fill=p.entry+s*slippage,risk=s*(fill-p.sl);
 if(!(risk>0)||s*(p.tp2-fill)<=0)return null;
 let mae=0,exit=fill,hit=false,minutes=0;
 for(const b of after){
   const low=b.l,high=b.h+(s<0?spread:0);
   const adverse=s>0?low:high,favorable=s>0?b.h:b.l+spread;
   mae=Math.max(mae,Math.max(0,s*(fill-adverse))/risk);minutes=(b.t-p.published)/60000+1;
   if(s*(adverse-p.sl)<=0){exit=p.sl-s*slippage;break;}
   if(s*(favorable-p.tp2)>=0){exit=p.tp2-s*slippage;hit=true;break;}
   exit=b.c+(s<0?spread:0)-s*slippage;
 }
 return {at:p.published,group:p.group??"UNKNOWN",r:s*(exit-fill)/risk,tp2:hit,maeR:mae,minutes};
}
export function scanPullbacks(bars:Bar[],spread=.25,slippage=.10):PullbackCase[]{
 if(!Number.isFinite(spread)||spread<=0||!Number.isFinite(slippage)||slippage<0)throw Error("INVALID_COSTS");
 const cases:PullbackCase[]=[];
 const end=bars.at(-1)?.t??0;
 const f5=aggregate(bars,5,end+60000,5),f15=aggregate(bars,15,end+60000,14);
 let i5=0,i15=0,cache5:Frame|null=null,cache15:Frame|null=null;
 const recent=(a:number)=>bars.slice(Math.max(0,a-150),a);
 // Pre-aggregated bars are consumed only after their complete interval ended.
 // This avoids rescanning five days of history per minute in a long archive.
 for(let i=450;i<bars.length-20;){
   const now=bars[i]!.t,open=bars[i]!.o;
   let a=i5,b=i15;
   while(i5<f5.length&&f5[i5]!.t+300000<=now)i5++;
   while(i15<f15.length&&f15[i15]!.t+900000<=now)i15++;
   if(a!==i5||!cache5)cache5=analyzeFrame(f5.slice(Math.max(0,i5-120),i5));
   if(b!==i15||!cache15)cache15=analyzeFrame(f15.slice(Math.max(0,i15-120),i15));
   const m1=analyzeFrame(recent(i)),last=bars[i-1]!;
   if(!cache5||!cache15||!m1||now-last.t>150000||recent(i).filter(x=>x.t>=now-150*60000).length<135||!isMarketOpen(new Date(now))){i++;continue;}
   const q={bid:open,ask:open+spread,at:new Date(now).toISOString()};
   const mk:Market={now,bid:q.bid,ask:q.ask,m1,m5:cache5,m15:cache15,h1:null};
   const p=pullbackFromMarket(mk,q,now);
   if(!p){i++;continue;}
   const c=replayPullback(p,bars.slice(i,i+20),spread,slippage);
   if(c)cases.push(c);
   i+=20;
 }
 return cases;
}
export function trainKnowledge(cases:TradingCase[],pullbacks:PullbackCase[],trainEnd:number,validationEnd:number,dataThrough:number):Knowledge{
 if(![trainEnd,validationEnd,dataThrough].every(Number.isFinite)||!(trainEnd<validationEnd&&validationEnd<dataThrough))throw Error("INVALID_SPLITS");
 const resolved=cases.filter(c=>Number.isFinite(Date.parse(c.at))&&Date.parse(c.at)+270*60000<=dataThrough);
 const trEnd=new Date(trainEnd).toISOString(),vaEnd=new Date(validationEnd).toISOString();
 // Purge cases whose outcome window crosses a split; no future outcomes in training.
 const eligible=resolved.filter(c=>{const t=Date.parse(c.at);return t<trainEnd?t+270*60000<=trainEnd:t<validationEnd?t+270*60000<=validationEnd:true;});
 const training=eligible.filter(c=>Date.parse(c.at)<validationEnd);
 const rules=discoverQualityRules(training,trEnd,vaEnd); // no holdout rows given for rule selection
 const history=gradeHistory(training,rules);
 const hourStats=(h:number,from:number,to:number)=>{
   const xs=training.filter(c=>c.engine==="OUTLOOK"&&Date.parse(c.at)>=from&&Date.parse(c.at)<to&&hourWAT(Date.parse(c.at))===h&&gradeFor(c.features,rules).grade==="STRONG"&&c.outcome.published_r!==null);
   return {n:xs.length,avgR:avg(xs.map(c=>c.outcome.published_r!)),tp2Rate:avg(xs.map(c=>Number(c.outcome.first60.tp2)))};
 };
 const hourRows=Array.from({length:24},(_,h)=>({h,train:hourStats(h,-Infinity,trainEnd),validation:hourStats(h,trainEnd,validationEnd)}));
 const hours=hourRows.filter(x=>x.train.n>=15&&x.validation.n>=8&&x.train.avgR>0&&x.validation.avgR>0).sort((a,b)=>b.validation.avgR-a.validation.avgR).map(x=>x.h);
 const groups=[...new Set(pullbacks.map(c=>c.group))].map(group=>({group,train:stat(pullbacks.filter(c=>c.group===group&&c.at+20*60000<=trainEnd)),validation:stat(pullbacks.filter(c=>c.group===group&&c.at>=trainEnd&&c.at+20*60000<=validationEnd))}));
 const selected=groups.filter(g=>g.train.n>=25&&g.validation.n>=10&&g.train.avgR>0&&g.validation.avgR>0);
 const holdout=pullbacks.filter(c=>c.at>=validationEnd&&c.at+20*60000<=dataThrough&&selected.some(g=>g.group===c.group));
 const lessons=[...discoverLessons(training,"OUTLOOK",trEnd,vaEnd),...discoverLessons(training,"M10_ENGINE",trEnd,vaEnd)];
 return {version:VERSION,builtAt:Date.now(),dataThrough,rules,history,hours,pullbacks:selected,diagnostics:{hourRows,pullbackGroups:groups,pullbackHoldout:stat(holdout),outlookHoldout:validateQuality(eligible,rules,vaEnd),exam:holdoutExam(eligible,lessons,vaEnd),lessons,strategyEvidence:STRATEGY_EVIDENCE,caseCount:eligible.length,pullbackCaseCount:pullbacks.length,trainEnd,validationEnd}};
}
export function selectIndependentPlan(raw:Bar[],q:Quote,now:number,k:Knowledge|null,canonical?:Parameters<typeof outlookFromCanonicalEvidence>[0]){
 const local=localOutlookResearch(raw,q,now);
 // User's morning window is a test hypothesis, not a fabricated historical result.
 if(!k||k.dataThrough>now)return{plan:null,local,status:"KNOWLEDGE_MISSING"};
 if(new Date(now).getUTCMinutes()===0&&now%3600000<25000){
   if(canonical){
     const p=outlookFromCanonicalEvidence(canonical,now);
     if(p){
       const f=caseFeatures(raw,now,p.side,{...canonical.thesis,structure_state:canonical.thesis.structure,market_regime:canonical.thesis.market_regime,confidence_pct:resolveHourlyBias(canonical.canonicalM10,canonical.thesis).confidence});
       const grade=assessOutlookQuality(f,k.rules,k.history);
       // Require actual historical grade; strongest hours are separately measured.
       if(grade.grade==="STRONG"&&k.hours.includes(hourWAT(now)))return{plan:{...p,grade:grade.grade},local,status:"CANONICAL_OUTLOOK"};
     }
   }
   return{plan:null,local,status:canonical?"OUTLOOK_NOT_QUALIFIED":"ORIGINAL_M10_PRODUCER_REQUIRED"};
 }
 const p=pullbackCandidate(raw,q,now);
 if(p&&k.pullbacks.some(x=>x.group===p.group))return{plan:p,local,status:"HISTORICALLY_SELECTED_PULLBACK_CANDIDATE"};
 return {plan:null,local,status:p?"PULLBACK_UNCALIBRATED":"NO_PULLBACK"};
}
export function wire(p:Plan|null):string{
 if(!p||!planOK(p))return "NONE|NO_FRESH_STRONG";
 return ["APEX4",p.id,p.side,p.entry,p.sl,p.tp1,p.tp2,Math.floor(p.published/1000),Math.floor(p.expires/1000)].join("|");
}
