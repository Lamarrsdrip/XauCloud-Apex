#!/usr/bin/env node
// Walk-forward evaluation of the Apex pattern engine vs the native detector vs a
// random-entry baseline over the XauCloud M1 archive, per chronological split.
// Usage: node research/evaluate.mjs [--split TRAIN|VALIDATION|HELD_OUT|ALL] [--out file.json] [--signals file.jsonl]
import fs from 'node:fs';
import {bars,SPLITS,coverage} from './archive.mjs';
import {detect,ENGINE_VERSION,ENGINE_PARAMS} from '../astra/pattern-engine.mjs';
import {createNative,NATIVE_DEFAULTS} from './native-port.mjs';
import {forwardOutcome} from './outcomes.mjs';

const args=Object.fromEntries(process.argv.slice(2).reduce((a,x,i,arr)=>x.startsWith('--')?[...a,[x.slice(2),arr[i+1]]]:a,[]));
const wanted=args.split&&args.split!=='ALL'?[args.split]:Object.keys(SPLITS);
const LOOKBACK=180,TARGETS=[3,5,10];

// Deterministic PRNG for the random baseline (reproducible).
function rng(seed){let s=seed>>>0;return()=>{s=(s*1664525+1013904223)>>>0;return s/4294967296;};}

function summarize(rows){
  const n=rows.length;if(!n)return {signals:0};
  const avg=f=>rows.reduce((a,r)=>a+f(r),0)/n;
  const out={signals:n,avgMfe120:avg(r=>r.o.mfe),avgMae120:avg(r=>r.o.mae),avgMfe30:avg(r=>r.o.mfe30),avgMae30:avg(r=>r.o.mae30)};
  for(const T of TARGETS){const dec=rows.filter(r=>r.o.hit[T]!=='OPEN');const w=dec.filter(r=>r.o.hit[T]==='WIN').length;
    out['win'+T]=dec.length?w/dec.length:null;out['expPts'+T]=dec.length?(w*T-(dec.length-w)*T)/dec.length:null;}
  for(const k of ['1_1','2_1','3_1.5']){const dec=rows.filter(r=>r.o.hitAtr?.[k]==='WIN'||r.o.hitAtr?.[k]==='LOSS');const w=dec.filter(r=>r.o.hitAtr[k]==='WIN').length;
    const [a,b]=k.split('_').map(Number);out['winAtr'+k]=dec.length?w/dec.length:null;out['expR'+k]=dec.length?(w*a-(dec.length-w)*b)/b/dec.length:null;}
  const st=rows.filter(r=>r.o.structural.r!==null);
  out.structuralAvgR=st.length?st.reduce((a,r)=>a+r.o.structural.r,0)/st.length:null;
  out.structuralTargetRate=st.length?st.filter(r=>r.o.structural.result==='TARGET').length/st.length:null;
  out.avgRiskPts=avg(r=>r.o.riskPts);
  return out;
}

const report={generatedAt:new Date().toISOString(),engineVersion:ENGINE_VERSION,engineParams:ENGINE_PARAMS,nativeDefaults:NATIVE_DEFAULTS,
  archive:(({firstMonth,lastMonth,totalM1Bars})=>({firstMonth,lastMonth,totalM1Bars}))(coverage()||{}),
  method:'Every archive minute is replayed causally (only closed M1 bars up to that minute). Entry = close of the signal minute at the executable side (mid -/+ half the archive spread). Outcomes: first touch of +T vs -T points (same-bar ambiguity = loss), MFE/MAE over 30/120 minutes, and a structural 1.5R/-1R result using each signal\'s own invalidation. Random baseline: equal count of random minutes in the same split with the same direction mix.',
  splits:{}};
const sigOut=args.signals?fs.createWriteStream(args.signals):null;

for(const split of wanted){
  const {from,to}=SPLITS[split];
  const all=bars(from-LOOKBACK*60000*3,to+200*60000);
  const native=createNative();const seen=new Set();
  const eng=[],nat=[],dev={};let minutes=0,start=0;
  while(start<all.length&&all[start].t<from)start++;
  for(let i=Math.max(start,LOOKBACK);i<all.length&&all[i].t<to;i++){
    // Continuity: skip windows that span a weekend/feed gap > 30 minutes.
    if(all[i].t-all[i-LOOKBACK+1].t>(LOOKBACK+30)*60000){native(all.slice(i-LOOKBACK+1,i+1));continue;}
    minutes++;
    const win=all.slice(i-LOOKBACK+1,i+1),b=all[i],spread=b.spread||0.17;
    const bid=b.c-spread/2,ask=b.c+spread/2,fwd=all.slice(i+1,i+121);
    const r=detect({m1:win,bid,ask});
    for(const c of r.candidates){
      if(c.stage==='DEVELOPING'){dev[c.family]=(dev[c.family]||0)+1;continue;}
      if(seen.has(c.eventKey))continue;seen.add(c.eventKey);
      const o=forwardOutcome(fwd,{direction:c.direction,entry:c.entry,invalidation:c.invalidation,spread,targets:TARGETS,atr:r.atrM3});
      const row={t:b.t+60000,family:c.family,direction:c.direction,entry:c.entry,invalidation:c.invalidation,atrM3:r.atrM3,ext:c.extensionAtr,o};
      eng.push(row);sigOut?.write(JSON.stringify({split,source:'ENGINE',...row,evidence:c.evidence,legAtr:c.legAtr,recoveryFrac:c.recoveryFrac,context:c.context,riskPts:c.riskPts,hasFvg:!!c.fvg})+'\n');
    }
    const n=native(win);
    if(n){const direction=n.dir<0?'SELL':'BUY',entry=direction==='SELL'?bid:ask;
      const o=forwardOutcome(fwd,{direction,entry,invalidation:n.extreme,spread,targets:TARGETS,atr:detect({m1:win,bid,ask}).atrM3});
      nat.push({t:b.t+60000,family:'NATIVE_EXHAUSTION',direction,o});}
  }
  // Random baseline with the engine's count and direction mix.
  const R=rng(20261125),inSplit=[];for(let i=0;i<all.length;i++)if(all[i].t>=from&&all[i].t<to&&i+120<all.length)inSplit.push(i);
  const rnd=eng.map(e=>{const i=inSplit[Math.floor(R()*inSplit.length)],b=all[i],sp=b.spread||0.17,ra=detect({m1:all.slice(Math.max(0,i-179),i+1),bid:b.c,ask:b.c}).atrM3;
    const entry=e.direction==='SELL'?b.c-sp/2:b.c+sp/2;
    return {o:forwardOutcome(all.slice(i+1,i+121),{direction:e.direction,entry,invalidation:e.direction==='SELL'?entry+(e.o.riskPts||5):entry-(e.o.riskPts||5),spread:sp,targets:TARGETS,atr:ra})};});
  const days=minutes/1380;
  const byFamily={};for(const f of new Set(eng.map(x=>x.family)))for(const d of ['SELL','BUY']){const rows=eng.filter(x=>x.family===f&&x.direction===d);if(rows.length)byFamily[f+'|'+d]=summarize(rows);}
  report.splits[split]={tradingDaysApprox:+days.toFixed(1),minutesReplayed:minutes,developingMinutesByFamily:dev,
    engine:{all:summarize(eng),perDay:eng.length/days,byFamily},native:{all:summarize(nat),perDay:nat.length/days,
      bySide:Object.fromEntries(['SELL','BUY'].map(d=>[d,summarize(nat.filter(x=>x.direction===d))]))},
    randomBaseline:summarize(rnd)};
  console.error(split,'done',eng.length,'engine signals',nat.length,'native signals');
}
sigOut?.end();
const text=JSON.stringify(report,null,1);
if(args.out)fs.writeFileSync(args.out,text);else console.log(text);
