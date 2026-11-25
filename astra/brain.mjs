// Apex Brain: the permanent, model-independent strategy knowledge. Every provider
// and model receives the SAME package for the same market context, so switching
// models never loses Apex's intelligence. Nothing here can authorise an order.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const BRAIN=path.join(ROOT,'data','brain');
export const BRAIN_VERSION='apex-brain-2026-11-25';
let cached=null;
export function loadBrain(dir=BRAIN){
  if(cached&&cached.dir===dir)return cached;
  const read=f=>{try{return JSON.parse(fs.readFileSync(path.join(dir,f),'utf8'));}catch{return null;}};
  cached={dir,taxonomy:read('taxonomy.json'),episodes:read('reference-episodes.json'),baseRates:read('base-rates.json'),
    examples:read('historical-examples.json')?.examples||[]};
  return cached;
}

const KEYS=['legAtr','recoveryFrac','extensionAtr','driftWithTradeAtr','rangePosFailSide','fvg'];
const SCALE={legAtr:3,recoveryFrac:0.3,extensionAtr:0.6,driftWithTradeAtr:4,rangePosFailSide:0.3,fvg:1};
export function candidateFeatures(c){
  const rp=c.context?.rangePos;
  return {legAtr:c.legAtr??0,recoveryFrac:c.recoveryFrac??0,extensionAtr:c.extensionAtr??0,
    driftWithTradeAtr:c.context?.driftWithTradeAtr??0,rangePosFailSide:rp==null?0.5:(c.direction==='SELL'?rp:1-rp),fvg:c.fvg?1:0};
}
function distance(a,b){let s=0;for(const k of KEYS){const d=((a[k]??0)-(b[k]??0))/SCALE[k];s+=d*d;}return Math.sqrt(s);}

/** Nearest historical examples of the same family/direction: half that worked, half that failed. */
export function similarExamples(candidate,{k=6,brain=loadBrain()}={}){
  const f=candidateFeatures(candidate);
  const pool=brain.examples.filter(e=>e.family===candidate.family&&e.direction===candidate.direction)
    .map(e=>({e,d:distance(f,e.features)})).sort((x,y)=>x.d-y.d);
  const wins=pool.filter(x=>x.e.outcome.oneAtrFirst==='WIN').slice(0,Math.ceil(k/2));
  const losses=pool.filter(x=>x.e.outcome.oneAtrFirst==='LOSS').slice(0,Math.floor(k/2));
  const near=pool.slice(0,40),nearWin=near.length?near.filter(x=>x.e.outcome.oneAtrFirst==='WIN').length/near.length:null;
  return {neighbourhoodWinRate:nearWin,neighbourhoodSize:near.length,
    examples:[...wins,...losses].sort((x,y)=>x.d-y.d).map(({e,d})=>({id:e.id,at:e.at,similarity:+(1/(1+d)).toFixed(3),features:e.features,
      m3AtrUnits:e.m3AtrUnits,outcome:e.outcome,labelOrigin:'ARCHIVE_OUTCOME_AFTER_ENTRY'}))};
}

/**
 * Knowledge package for one market context. `candidates` come from the pattern
 * engine; `lessons` from the learning store. Limits are generous by default and
 * owner-configurable; they bound prompt size, not reasoning.
 */
export function brainPackage({candidates=[],lessons=[],limits={}}={},brain=loadBrain()){
  const L={families:4,examplesPerCandidate:6,episodesPerFamily:3,lessons:8,...limits};
  const active=[...new Set(candidates.map(c=>c.family))].slice(0,L.families);
  const tax=brain.taxonomy||{};
  const families=Object.fromEntries((active.length?active:Object.keys(tax.families||{})).map(f=>[f,tax.families?.[f]]));
  const episodes=(brain.episodes?.episodes||[]).filter(e=>!active.length||active.includes(e.family))
    .slice(0,active.length?L.episodesPerFamily*active.length:20)
    .map(({id,trader,timeframe,direction,family,anchor,knowable,traderExplanation,entries,after,lesson,archiveReplay})=>
      ({id,trader,timeframe,direction,family,anchorKind:anchor?.kind,knowableBeforeEntry:knowable,traderExplanation,entries,
        afterEntryOnly:after,lesson,archiveReplay}));
  return {brainVersion:BRAIN_VERSION,principle:tax.principle,families,campaign:tax.campaign,measuredReality:tax.measuredReality,
    baseRates:brain.baseRates,referenceEpisodes:episodes,crossEpisodeFindings:brain.episodes?.crossEpisodeFindings||[],
    similarHistory:candidates.slice(0,L.families).map(c=>({family:c.family,direction:c.direction,stage:c.stage,...similarExamples(c,{k:L.examplesPerCandidate,brain})})),
    lessons:lessons.slice(0,L.lessons)};
}
