#!/usr/bin/env node
import fs from 'node:fs';import {HYPOTHESES,scoreRows} from './hypotheses.mjs';
const splits=process.argv.slice(2);const f=x=>x==null?'   -  ':x.toFixed(3);const res={};
for(const s of splits){const rows=fs.readFileSync(`research/results/${s.toLowerCase()}_signals_v2.jsonl`,'utf8').split('\n').filter(Boolean).map(JSON.parse);
  const rep=JSON.parse(fs.readFileSync(`research/results/${s.toLowerCase()}_v2.json`,'utf8')).splits[s];res[s]={};
  console.log(`\n== ${s}  days=${rep.tradingDaysApprox}`);
  const line=(n,o)=>console.log(n.padEnd(26),'n',String(o.signals??o.n).padStart(6),'/day',f(o.perDay),'win1:1',f(o.win1_1??o.winAtr1_1),'±',f(o.se1_1),'expR2:1',f(o.expR2_1),'expR3:1.5',f(o['expR3_1.5']));
  line('RANDOM_BASELINE',{...rep.randomBaseline,win1_1:rep.randomBaseline.winAtr1_1,expR2_1:rep.randomBaseline.expR2_1});
  line('NATIVE_APEX',{...rep.native.all,perDay:rep.native.perDay,win1_1:rep.native.all.winAtr1_1});
  for(const [k,fn] of Object.entries(HYPOTHESES)){const o=scoreRows(rows.filter(fn),rep.tradingDaysApprox);res[s][k]=o;line(k,o);}
}
fs.writeFileSync('research/results/hypotheses_'+splits.join('_').toLowerCase()+'.json',JSON.stringify(res,null,1));
