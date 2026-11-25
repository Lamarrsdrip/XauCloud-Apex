// XAUUSD M1 research archive (Exness public ticks aggregated to UTC minute
// bars of the bid/ask MID). Research only — never presented as a live quote.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import {fileURLToPath} from 'node:url';

export const ARCHIVE_DIR=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..','data','gold_history');

// Chronological splits are fixed BEFORE any evaluation. Definitions are designed
// from the reference videos, sanity-checked on TRAIN, compared on VALIDATION and
// reported once on HELD_OUT. Nothing is tuned on HELD_OUT.
export const SPLITS={
  TRAIN:{from:Date.UTC(2021,10,1),to:Date.UTC(2025,0,1)},
  VALIDATION:{from:Date.UTC(2025,0,1),to:Date.UTC(2026,0,1)},
  HELD_OUT:{from:Date.UTC(2026,0,1),to:Date.UTC(2026,10,1)}
};
export function splitOf(ms){for(const [k,v] of Object.entries(SPLITS))if(ms>=v.from&&ms<v.to)return k;return null;}

const cache=new Map();
function monthKey(ms){const d=new Date(ms);return d.getUTCFullYear()+'_'+String(d.getUTCMonth()+1).padStart(2,'0');}
export function loadMonth(key,dir=ARCHIVE_DIR){
  const cacheKey=path.resolve(dir,key);
  if(cache.has(cacheKey))return cache.get(cacheKey);
  const file=path.join(dir,'XAUUSD_M1_'+key+'.csv.gz');
  const bars=[];
  if(fs.existsSync(file)){
    for(const line of zlib.gunzipSync(fs.readFileSync(file)).toString('utf8').split('\n')){
      if(!line)continue;const p=line.split(',');
      const t=Number(p[0])*60000,o=+p[1],h=+p[2],l=+p[3],c=+p[4];
      if(!Number.isFinite(t)||![o,h,l,c].every(x=>Number.isFinite(x)&&x>0)||h<Math.max(o,c)||l>Math.min(o,c))continue;
      bars.push({t,o,h,l,c,spread:+p[5]||0,ticks:+p[6]||0});
    }
  }
  cache.set(cacheKey,bars);
  while(cache.size>14)cache.delete(cache.keys().next().value);
  return bars;
}
/** Closed M1 bars with open time in [fromMs,toMs). */
export function bars(fromMs,toMs,dir=ARCHIVE_DIR){
  const out=[];
  for(let d=new Date(Date.UTC(new Date(fromMs).getUTCFullYear(),new Date(fromMs).getUTCMonth(),1));d.getTime()<toMs;d=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,1)))
    for(const b of loadMonth(monthKey(d.getTime()),dir))if(b.t>=fromMs&&b.t<toMs)out.push(b);
  return out;
}
export function coverage(dir=ARCHIVE_DIR){
  try{return JSON.parse(fs.readFileSync(path.join(dir,'manifest.json'),'utf8'));}catch{return null;}
}
