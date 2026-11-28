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
export type PullbackCase={at:number;group:string;r:number;tp1?:boolean;tp2:boolean;stopped?:boolean;maeR:number;mfeR?:number;minutes:number};
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
 return localOutlookFromMarket(brokerFrames(raw,quote,now),quote,now);
}
function localOutlookFromMarket(mk:Market|null,quote:Quote,now:number):{plan:Plan|null;features:Row;status:string}{
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
export function pullbackFromMarket(mk:Market,q:Quote,now:number):Plan|null{
 const f=mk.m1!,slow=mk.m5!,higher=mk.m15!;
 const higherSide=higher.trend==="UP"?1:higher.trend==="DOWN"?-1:0;
 if(!higherSide)return null;
 const trendAligned=trendPullback(mk,q,now,higherSide);
 if(trendAligned)return trendAligned;

 // Preserve the earlier correction study. These groups still need positive
 // chronological evidence before they can authorize a candidate order.
 const side=slow.trend==="UP"?-1:slow.trend==="DOWN"?1:0;
 if(!side)return null;
 const entry=side>0?q.ask:q.bid;
 const stretched=side*slow.extension<=-1.2|| (side>0?slow.rsi<35:slow.rsi>65);
 const turn=side>0?(f.sweptLow||f.lowerRejection||f.bullishDivergence):(f.sweptHigh||f.upperRejection||f.bearishDivergence);
 const shift=side>0?f.structureShiftUp||f.brokeUp:f.structureShiftDown||f.brokeDown;
 const liveTurn=side*(entry-f.close)>f.atr*.1;
 if(!stretched||!(turn||shift)||!(side*f.acceleration>0||side*f.pressure>.1||liveTurn))return null;
 const direction:Side=side>0?"BUY":"SELL";
 const execution:Market={...mk,m5:f,h1:slow,m15:higher};
 const ideas=sideCandidates(execution,direction,15).filter(c=>["COUNTERTREND_CORRECTION","EXHAUSTION_REVERSAL","FAILED_BREAKOUT","SR_REJECTION"].includes(c.strategy));
 const group=[direction,turn?"REJECTION":"SHIFT",Math.abs(slow.extension)>=2?"EXTREME":"STRETCHED",side*f.pressure>0?"PRESSURE":"TURN"].join("|");
 return buildPullback(f,q,now,side,slow.emaFast,group,ideas.map(c=>c.strategy));
}

function trendPullback(mk:Market,q:Quote,now:number,side:number):Plan|null{
 const f=mk.m1!,slow=mk.m5!,higher=mk.m15!;
 const entry=side>0?q.ask:q.bid;
 const parentInvalidation=side>0?higher.lastSwingLow:higher.lastSwingHigh;
 const previousExtreme=side>0?higher.lastSwingHigh:higher.lastSwingLow;
 if(parentInvalidation===null||previousExtreme===null||
    side*(entry-parentInvalidation)<=0||side*(previousExtreme-entry)<=0)return null;
 // An opposing higher timeframe or a completed M15 structural failure moves
 // the idea out of the trend-continuation family.
 const opposing=side>0?"DOWN":"UP";
 if(mk.h1?.trend===opposing||(side>0?higher.structureShiftDown:higher.structureShiftUp))return null;
 const excursion=side*(previousExtreme-parentInvalidation);
 const depth=side*(previousExtreme-entry)/excursion;
 if(depth<.25||depth>.78)return null;
 const touchedValue=side>0?f.last.l<=slow.emaFast:f.last.h>=slow.emaFast;
 const sweep=side>0?f.sweptLow:f.sweptHigh;
 const rejection=side>0?f.lowerRejection:f.upperRejection;
 const shift=side>0?f.structureShiftUp||f.brokeUp:f.structureShiftDown||f.brokeDown;
 if(!(touchedValue||sweep)||!(sweep||rejection||shift))return null;
 const reclaim=side*(entry-f.close)>f.atr*.1;
 if(!reclaim&&!(side*f.acceleration>0&&side*f.pressure>0))return null;
 const direction=side>0?"BUY":"SELL";
 const trigger=sweep?"LIQUIDITY_SWEEP":shift?"STRUCTURE_RECLAIM":"REJECTION";
 const group=["CONTINUATION",direction,depth>=.5?"DEEP":"HEALTHY",trigger].join("|");
 const cues=["M15 structure intact",trigger.toLowerCase().replaceAll("_"," "),reclaim?"live quote reclaim":"M1 pressure recovering"];
 return buildPullback(f,q,now,side,previousExtreme,group,cues,parentInvalidation);
}

function buildPullback(f:Frame,q:Quote,now:number,side:number,targetLimit:number,group:string,cues:string[],parentInvalidation?:number):Plan|null{
 const direction:Side=side>0?"BUY":"SELL",entry=side>0?q.ask:q.bid;
 const adverse=side>0?Math.min(f.last.l,f.lastSwingLow??f.last.l):Math.max(f.last.h,f.lastSwingHigh??f.last.h);
 const stop=r2(adverse-side*(f.atr*.25+(q.ask-q.bid)));
 if(parentInvalidation!==undefined&&side*(adverse-parentInvalidation)<=0)return null;
 const risk=side*(entry-stop),room=side*(targetLimit-entry),dist=Math.min(room,f.atr*2);
 if(!(risk>0)||dist<risk+(q.ask-q.bid))return null;
 const plan:Plan={id:hash("PULLBACK:"+direction+":"+f.last.t),kind:"PULLBACK",side:direction,entry,sl:stop,tp1:r2(entry+side*dist*.5),tp2:r2(entry+side*dist),published:now,expires:now+12000,reason:[group,...cues].join("; "),source:"XAUCLOUD_M1_FEATURES_EXPERIMENTAL_PULLBACK",group};
 return planOK(plan)?plan:null;
}
// Score the TP2-only basket exit policy, not XauCloud's thirds-at-targets P&L.
// Minute data cannot prove sub-second execution. Stop is pessimistically checked first.
export function replayPullback(p:Plan,bars:Bar[],spread:number,slippage:number,horizon=20,roundTripCommissionPerOunce=0):PullbackCase|null{
 if(!Number.isFinite(roundTripCommissionPerOunce)||roundTripCommissionPerOunce<0)throw Error("INVALID_COMMISSION");
 const after=bars.filter(b=>b.t>=Math.ceil(p.published/60000)*60000&&b.t<p.published+horizon*60000);
 if(after.length<horizon-2)return null;
 const s=sg(p.side),fill=p.entry+s*slippage,risk=s*(fill-p.sl);
 if(!(risk>0)||s*(p.tp2-fill)<=0)return null;
 let mae=0,mfe=0,exit=fill,tp1=false,hit=false,stopped=false,minutes=0;
 for(const b of after){
   const low=b.l,high=b.h+(s<0?spread:0);
   const adverse=s>0?low:high,favorable=s>0?b.h:b.l+spread;
   mae=Math.max(mae,Math.max(0,s*(fill-adverse))/risk);minutes=(b.t-p.published)/60000+1;
   if(s*(adverse-p.sl)<=0){exit=p.sl-s*slippage;stopped=true;break;}
   mfe=Math.max(mfe,Math.max(0,s*(favorable-fill))/risk);
   if(s*(favorable-p.tp1)>=0)tp1=true;
   if(s*(favorable-p.tp2)>=0){exit=p.tp2-s*slippage;hit=true;break;}
   exit=b.c+(s<0?spread:0)-s*slippage;
 }
 return {at:p.published,group:p.group??"UNKNOWN",r:(s*(exit-fill)-roundTripCommissionPerOunce)/risk,tp1,tp2:hit,stopped,maeR:mae,mfeR:mfe,minutes};
}
export function scanPullbacks(bars:Bar[],spread=.25,slippage=.10,roundTripCommissionPerOunce=0,
 onReplay?:(plan:Plan,index:number,outcome:PullbackCase)=>void):PullbackCase[]{
 if(!Number.isFinite(spread)||spread<=0||!Number.isFinite(slippage)||slippage<0)throw Error("INVALID_COSTS");
 const cases:PullbackCase[]=[];
 const end=bars.at(-1)?.t??0;
 const f5=aggregate(bars,5,end+60000,5),f15=aggregate(bars,15,end+60000,14),f60=aggregate(bars,60,end+60000,54);
 let i5=0,i15=0,i60=0,cache5:Frame|null=null,cache15:Frame|null=null,cache60:Frame|null=null;
 const recent=(a:number)=>bars.slice(Math.max(0,a-150),a);
 // Pre-aggregated bars are consumed only after their complete interval ended.
 // This avoids rescanning five days of history per minute in a long archive.
 for(let i=450;i<bars.length-20;){
   const now=bars[i]!.t,open=bars[i]!.o;
   const a=i5,b=i15,cursor60=i60;
   while(i5<f5.length&&f5[i5]!.t+300000<=now)i5++;
   while(i15<f15.length&&f15[i15]!.t+900000<=now)i15++;
   while(i60<f60.length&&f60[i60]!.t+3600000<=now)i60++;
   if(a!==i5||!cache5)cache5=analyzeFrame(f5.slice(Math.max(0,i5-120),i5));
   if(b!==i15||!cache15)cache15=analyzeFrame(f15.slice(Math.max(0,i15-120),i15));
   if(cursor60!==i60||!cache60)cache60=analyzeFrame(f60.slice(Math.max(0,i60-120),i60));
   const m1=analyzeFrame(recent(i)),last=bars[i-1]!;
   if(!cache5||!cache15||!m1||now-last.t>150000||recent(i).filter(x=>x.t>=now-150*60000).length<135||!isMarketOpen(new Date(now))){i++;continue;}
   const q={bid:open,ask:open+spread,at:new Date(now).toISOString()};
   const mk:Market={now,bid:q.bid,ask:q.ask,m1,m5:cache5,m15:cache15,h1:cache60};
   const p=pullbackFromMarket(mk,q,now);
   if(!p){i++;continue;}
   const c=replayPullback(p,bars.slice(i,i+20),spread,slippage,20,roundTripCommissionPerOunce);
   if(c){cases.push(c);onReplay?.(p,i,c);}
   i+=20;
 }
 return cases;
}
export function trainKnowledge(cases:TradingCase[],pullbacks:PullbackCase[],trainEnd:number,validationEnd:number,dataThrough:number,pullbackSplit={trainEnd,validationEnd}):Knowledge{
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
 const pbTrain=pullbackSplit.trainEnd,pbVal=pullbackSplit.validationEnd;
 if(!(pbTrain<pbVal&&pbVal<dataThrough))throw Error('INVALID_PULLBACK_SPLITS');
 const groups=[...new Set(pullbacks.filter(c=>c.at<pbVal).map(c=>c.group))].map(group=>({group,train:stat(pullbacks.filter(c=>c.group===group&&c.at+20*60000<=pbTrain)),validation:stat(pullbacks.filter(c=>c.group===group&&c.at>=pbTrain&&c.at+20*60000<=pbVal))}));
 const selected=groups.filter(g=>g.train.n>=25&&g.validation.n>=10&&g.train.avgR>0&&g.validation.avgR>0);
 const holdout=pullbacks.filter(c=>c.at>=pbVal&&c.at+20*60000<=dataThrough&&selected.some(g=>g.group===c.group));
 const lessons=[...discoverLessons(training,"OUTLOOK",trEnd,vaEnd),...discoverLessons(training,"M10_ENGINE",trEnd,vaEnd)];
 return {version:VERSION,builtAt:Date.now(),dataThrough,rules,history,hours,pullbacks:selected,diagnostics:{hourRows,pullbackGroups:groups,pullbackHoldout:stat(holdout),outlookHoldout:validateQuality(eligible,rules,vaEnd),exam:holdoutExam(eligible,lessons,vaEnd),lessons,strategyEvidence:STRATEGY_EVIDENCE,caseCount:eligible.length,pullbackCaseCount:pullbacks.length,trainEnd,validationEnd,pullbackSplit}};
}
export function selectIndependentPlan(raw:Bar[],q:Quote,now:number,k:Knowledge|null,canonical?:Parameters<typeof outlookFromCanonicalEvidence>[0]){
 const market=brokerFrames(raw,q,now);
 const local=localOutlookFromMarket(market,q,now);
 const calibrated=Boolean(k&&k.dataThrough<=now);
 if(!market)return {plan:null,researchPlan:null,local,status:"MISSING_BROKER_DATA"};
 if(!isMarketOpen(new Date(now)))return {plan:null,researchPlan:null,local,status:"MARKET_CLOSED"};
 if(now%3600000<25000){
   const p=canonical&&outlookFromCanonicalEvidence(canonical,now);
   if(!calibrated||!k)return {plan:null,researchPlan:p??local.plan,local,status:"KNOWLEDGE_MISSING"};
   if(p&&canonical){
     const f=caseFeatures(raw,now,p.side,{...canonical.thesis,structure_state:canonical.thesis.structure,market_regime:canonical.thesis.market_regime,confidence_pct:resolveHourlyBias(canonical.canonicalM10,canonical.thesis).confidence});
     const grade=assessOutlookQuality(f,k.rules,k.history);
     const researchPlan={...p,grade:grade.grade};
     if(grade.grade==="STRONG"&&k.hours.includes(hourWAT(now)))return {plan:researchPlan,researchPlan,local,status:"CANONICAL_OUTLOOK"};
     return {plan:null,researchPlan,local,status:"OUTLOOK_NOT_QUALIFIED"};
   }
   return {plan:null,researchPlan:local.plan,local,status:canonical?"OUTLOOK_NOT_QUALIFIED":"ORIGINAL_M10_PRODUCER_REQUIRED"};
 }
 const p=pullbackFromMarket(market,q,now);
 if(!calibrated||!k)return {plan:null,researchPlan:p,local,status:"KNOWLEDGE_MISSING"};
 if(p&&k.pullbacks.some(x=>x.group===p.group))return {plan:p,researchPlan:p,local,status:"HISTORICALLY_SELECTED_PULLBACK_CANDIDATE"};
 return {plan:null,researchPlan:p,local,status:p?"PULLBACK_UNCALIBRATED":"NO_PULLBACK"};
}
export function wire(p:Plan|null):string{
 if(!p||!planOK(p))return "NONE|ARMED_NO_PLAN";
 return ["APEX4",p.id,p.side,p.entry,p.sl,p.tp1,p.tp2,Math.floor(p.published/1000),Math.floor(p.expires/1000),p.kind].join("|");
}
