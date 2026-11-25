#!/usr/bin/env node
// Replays the archive minute-by-minute around each reference entry whose market
// minute is anchored (server timestamps on screen, or a unique price-path match),
// and reports when the engine / native detector would have fired.
import {bars} from './archive.mjs';
import {detect} from '../astra/pattern-engine.mjs';
import {createNative} from './native-port.mjs';
export const ANCHORED=[
 {id:'V1',direction:'SELL',entryUtc:'2026-10-01T07:12:00Z',entryBid:4178.353,anchor:'ON_SCREEN_SERVER_TIME 2026.10.01 07:13 (add ticket)'},
 {id:'V4',direction:'SELL',entryUtc:'2026-10-20T15:17:00Z',entryBid:4138.832,anchor:'UNIQUE_PRICE_PATH_MATCH'},
 {id:'V7',direction:'SELL',entryUtc:'2026-09-18T04:12:00Z',entryBid:4360.077,anchor:'ON_SCREEN_SERVER_TIME 2026.09.18 04:13'},
 {id:'V9',direction:'SELL',entryUtc:'2026-10-05T11:31:00Z',entryBid:4165.602,anchor:'ON_SCREEN_SERVER_TIME 2026.10.05 11:32-11:33'}
];
export function referenceCheck({before=45,after=10}={}){
  return ANCHORED.map(ep=>{
    const t=Date.parse(ep.entryUtc),all=bars(t-400*60000,t+after*60000+60000);
    const native=createNative();const fires=[];const seen=new Set();
    for(let i=180;i<all.length;i++){
      const win=all.slice(i-179,i+1),b=all[i],sp=b.spread||0.17,at=b.t+60000;
      const n=native(win);
      if(at<t-before*60000||at>t+after*60000)continue;
      const r=detect({m1:win,bid:b.c-sp/2,ask:b.c+sp/2});
      for(const c of r.candidates){const k=c.eventKey+c.stage;if(seen.has(k))continue;seen.add(k);
        fires.push({src:'ENGINE',minRel:(at-t)/60000,family:c.family,dir:c.direction,stage:c.stage,entry:+c.entry.toFixed(2)});}
      if(n)fires.push({src:'NATIVE',minRel:(at-t)/60000,dir:n.dir<0?'SELL':'BUY',entry:+(n.dir<0?b.c-sp/2:b.c+sp/2).toFixed(2)});
    }
    return {...ep,fires};
  });
}
if(import.meta.url===`file://${process.argv[1]}`)for(const r of referenceCheck()){console.log(`\n${r.id} ${r.direction} @${r.entryBid} ${r.entryUtc}`);for(const f of r.fires)console.log(' ',JSON.stringify(f));}
