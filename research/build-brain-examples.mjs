#!/usr/bin/env node
// Builds data/brain/historical-examples.json from TRAIN signals only. Each example
// carries the 20 M3 bars BEFORE entry (normalised: price-entry in M3-ATR units)
// and its outcome, so retrieval can show the model both successes and failures.
import fs from 'node:fs';
import {bars} from './archive.mjs';
import {buildM3} from '../astra/pattern-engine.mjs';
const rows=fs.readFileSync('research/results/train_signals_v2.jsonl','utf8').split('\n').filter(Boolean).map(JSON.parse);
function rng(seed){let s=seed>>>0;return()=>{s=(s*1664525+1013904223)>>>0;return s/4294967296;};}
const R=rng(7),PER=60,out=[];
for(const fam of ['V_RECOVERY_FAILURE','SPIKE_REJECTION','BREAK_PAUSE_CONTINUATION','RECOVERY_CONTINUATION'])for(const dir of ['SELL','BUY'])for(const res of ['WIN','LOSS']){
  const pool=rows.filter(r=>r.family===fam&&r.direction===dir&&r.o.hitAtr?.['1_1']===res);
  for(let k=0;k<PER&&pool.length;k++){const r=pool.splice(Math.floor(R()*pool.length),1)[0];
    const m1=bars(r.t-60*60000*2,r.t),a=r.atrM3,m3=buildM3(m1).slice(-20);
    const n=x=>+((x-r.entry)/a).toFixed(2);
    out.push({id:`${fam}-${dir}-${r.t}`,at:new Date(r.t).toISOString(),split:'TRAIN',family:fam,direction:dir,
      features:{legAtr:+(r.legAtr??0).toFixed(2),recoveryFrac:+(r.recoveryFrac??0).toFixed(2),extensionAtr:+r.ext.toFixed(2),
        driftWithTradeAtr:+r.context.driftWithTradeAtr.toFixed(2),rangePosFailSide:+(dir==='SELL'?r.context.rangePos:1-r.context.rangePos).toFixed(2),hourUtc:r.context.hourUtc,fvg:r.hasFvg?1:0},
      m3AtrUnits:m3.map(b=>[n(b.o),n(b.h),n(b.l),n(b.c)]),evidence:r.evidence,
      outcome:{oneAtrFirst:res,mfe30Atr:+(r.o.mfe30/a).toFixed(2),mae30Atr:+(r.o.mae30/a).toFixed(2)}});
  }
}
fs.writeFileSync('data/brain/historical-examples.json',JSON.stringify({version:'apex-brain-examples-2026-11-25',source:'TRAIN split only (2021-11..2024-12); never VALIDATION/HELD_OUT',
  m3AtrUnits:'20 M3 bars before entry as [open,high,low,close] in M3-ATR units relative to the entry price',examples:out}));
console.log(out.length,'examples',(fs.statSync('data/brain/historical-examples.json').size/1024).toFixed(0),'KB');
