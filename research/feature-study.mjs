#!/usr/bin/env node
// Bucket study of engine signals by one feature at a time (TRAIN/VALIDATION files only).
import fs from 'node:fs';
const [file,famFilter]=process.argv.slice(2);
const rows=fs.readFileSync(file,'utf8').split('\n').filter(Boolean).map(JSON.parse).filter(r=>!famFilter||r.family.startsWith(famFilter));
const feats={drift:r=>r.context.driftWithTradeAtr,rangePos:r=>r.direction==='SELL'?r.context.rangePos:1-r.context.rangePos,
  rangeAtr:r=>r.context.rangeAtr,leg:r=>r.legAtr,rec:r=>r.recoveryFrac,ext:r=>r.ext,risk:r=>r.riskPts,atr:r=>r.atrM3,hour:r=>r.context.hourUtc,fvg:r=>r.hasFvg?1:0};
const stat=g=>{const d=g.filter(r=>r.o.hit[5]!=='OPEN'),w=d.filter(r=>r.o.hit[5]==='WIN').length;const d10=g.filter(r=>r.o.hit[10]!=='OPEN'),w10=d10.filter(r=>r.o.hit[10]==='WIN').length;
  return `n=${String(g.length).padStart(5)} win5=${(w/d.length).toFixed(3)} exp5=${((2*w-d.length)*5/d.length).toFixed(2)} win10=${(w10/d10.length).toFixed(3)} mfe30=${(g.reduce((a,r)=>a+r.o.mfe30,0)/g.length).toFixed(2)}`;};
console.log('ALL',stat(rows));
for(const [name,f] of Object.entries(feats)){
  const v=rows.map(f).filter(Number.isFinite).sort((a,b)=>a-b);if(!v.length)continue;
  const q=[0.2,0.4,0.6,0.8].map(p=>v[Math.floor(p*v.length)]);
  console.log('\n'+name,'quintile cuts',q.map(x=>x.toFixed(2)).join(' '));
  const edges=[-Infinity,...q,Infinity];
  for(let i=0;i<5;i++){const g=rows.filter(r=>{const x=f(r);return x>=edges[i]&&x<edges[i+1];});if(g.length)console.log(`  [${edges[i].toFixed?.(2)},${edges[i+1].toFixed?.(2)})`.padEnd(20),stat(g));}
}
