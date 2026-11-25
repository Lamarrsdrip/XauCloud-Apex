// Research-only blind replay. No execution identifiers or order paths.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {bars,SPLITS} from './archive.mjs';
import {detect} from '../astra/pattern-engine.mjs';
import {createNative} from './native-port.mjs';
import {forwardOutcome} from './outcomes.mjs';
import {candlesPng} from '../astra/chart-png.mjs';
const fail=(message,status=400)=>Object.assign(new Error(message),{safe:true,httpStatus:status});
const digest=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const validId=x=>typeof x==='string'&&/^[0-9a-f-]{36}$/.test(x);
const round=x=>Math.round(x*10000)/10000;
const families=['NONE','V_RECOVERY_FAILURE','SPIKE_REJECTION','BREAK_PAUSE_CONTINUATION','RECOVERY_CONTINUATION','NATIVE_EXHAUSTION','OTHER'];
export const LAB_SCHEMA={type:'object',additionalProperties:false,required:['direction','family','stage','enterNow','entryCondition','invalidationPrice','targetPrice','confidence','reasoning'],properties:{
 direction:{type:'string',enum:['BUY','SELL','NONE']},family:{type:'string',enum:families},
 stage:{type:'string',enum:['NO_SETUP','DEVELOPING','READY','LATE','INVALID']},enterNow:{type:'boolean'},
 entryCondition:{type:'string'},invalidationPrice:{type:'number'},targetPrice:{type:'number'},
 confidence:{type:'number',minimum:0,maximum:100},reasoning:{type:'string'}}};
export function validatePrediction(p,quote){
 if(!p||!['BUY','SELL','NONE'].includes(p.direction)||!families.includes(p.family)||!LAB_SCHEMA.properties.stage.enum.includes(p.stage)||typeof p.enterNow!=='boolean'||!Number.isFinite(p.confidence)||p.confidence<0||p.confidence>100||!Number.isFinite(p.invalidationPrice)||!Number.isFinite(p.targetPrice)||typeof p.reasoning!=='string'||typeof p.entryCondition!=='string'||p.reasoning.length>8000||p.entryCondition.length>2000)throw fail('INVALID_PREDICTION');
 if(p.enterNow&&(p.direction==='NONE'||p.stage!=='READY'||(p.direction==='BUY'?(p.invalidationPrice>=quote.ask||p.targetPrice<=quote.ask):(p.invalidationPrice<=quote.bid||p.targetPrice>=quote.bid))))throw fail('INVALID_ENTRY_LEVELS');
 return Object.fromEntries(LAB_SCHEMA.required.map(k=>[k,p[k]]));
}
function rulePrediction(c,quote,atr){
 if(!c)return {direction:'NONE',family:'NONE',stage:'NO_SETUP',enterNow:false,entryCondition:'No rule trigger',invalidationPrice:0,targetPrice:0,confidence:0,reasoning:'No qualifying signal at the cutoff.'};
 const entry=c.direction==='BUY'?quote.ask:quote.bid,sign=c.direction==='BUY'?1:-1;
 const ready=c.stage==='READY';
 return {direction:c.direction,family:c.family,stage:c.stage,enterNow:ready,entryCondition:ready?'At replay close':'Wait for rule readiness',invalidationPrice:entry-sign*atr,targetPrice:entry+sign*atr,confidence:50,reasoning:'Mechanical baseline; 50 is an uncalibrated placeholder.'};
}
export function scorePrediction(p,episode){
 if(p.direction==='NONE'||!p.enterNow)return {result:'ABSTAINED',mfePts:null,maePts:null,atr:episode.atr,entered:false};
 const entry=p.direction==='BUY'?episode.quote.ask:episode.quote.bid;
 const o=forwardOutcome(episode.future,{direction:p.direction,entry,invalidation:p.invalidationPrice,spread:episode.quote.spread,atr:episode.atr});
 const hit=o.hitAtr['1_1'];
 return {entered:true,entry,result:hit==='WIN'?'FAVOURABLE_FIRST':hit==='LOSS'?'ADVERSE_FIRST':'NEITHER_WITHIN_120M',mfePts:o.mfe,maePts:o.mae,mfeAtr:o.mfe/episode.atr,maeAtr:o.mae/episode.atr,atr:episode.atr,horizonBars:episode.future.length,method:'Fixed entry spread proxy; same-minute ambiguity counts adverse; 1 ATR each way.'};
}
export function createLab(dataDir,{clock=Date.now,loadBars=bars,modelPredict,learning}={}){
 const root=path.join(dataDir,'astra-lab'),active=new Set();
 const dir=l=>path.join(root,digest(String(l)).slice(0,32));
 const filename=(l,id)=>path.join(dir(l),id+'.json');
 async function load(l,id){if(!validId(id))throw fail('EPISODE_NOT_FOUND',404);try{return JSON.parse(await fs.readFile(filename(l,id),'utf8'));}catch(e){if(e.code==='ENOENT')throw fail('EPISODE_NOT_FOUND',404);throw e;}}
 async function save(l,e){await fs.mkdir(dir(l),{recursive:true,mode:0o700});const file=filename(l,e.id),tmp=file+'.'+crypto.randomUUID();await fs.writeFile(tmp,JSON.stringify(e),{mode:0o600});await fs.rename(tmp,file);}
 async function lock(l,fn){if(active.has(l))throw fail('LAB_ALREADY_RUNNING',409);active.add(l);try{return await fn();}finally{active.delete(l);}}
 function visible(e){return {id:e.id,split:e.split,mode:e.mode,createdAt:e.createdAt,prefix:e.prefix,quote:e.quote,atr:e.atr,predictions:e.predictions.map(p=>({source:p.source,model:p.model,at:p.at,hash:p.hash,prediction:p.prediction})),revealed:!!e.revealedAt,...(e.revealedAt?{future:e.future,scores:e.scores,revealedAt:e.revealedAt,archiveCutoff:e.archiveCutoff}:{})};}
 async function make(l,{split='VALIDATION',mode='setup'}={}){
  if(!['VALIDATION','HELD_OUT'].includes(split)||!['setup','random'].includes(mode))throw fail('INVALID_LAB_OPTIONS');
  const range=SPLITS[split];let chosen;
  for(let attempt=0;attempt<30&&!chosen;attempt++){
   const t=range.from+crypto.randomInt(Math.floor((range.to-range.from)/60000))*60000;
   const raw=loadBars(Math.max(range.from,t-240*60000),Math.min(range.to,t+480*60000));
   for(let i=180;i+120<raw.length;i++){
    if(raw[i].t<t)continue;
    const pre=raw.slice(i-179,i+1),fut=raw.slice(i+1,i+121);
    if(fut.at(-1).t-pre[0].t!==299*60000)continue;
    if(!pre.concat(fut).every((b,j,a)=>j===0||b.t-a[j-1].t===60000))continue;
    const offset=1000-pre.at(-1).c+crypto.randomInt(1,1000)/100;
    const start=Date.UTC(2000,0,3,0,Math.floor(pre[0].t/60000)%3);
    const rebase=(b,j)=>({t:start+j*60000,o:round(b.o+offset),h:round(b.h+offset),l:round(b.l+offset),c:round(b.c+offset),spread:b.spread||0.17});
    const prefix=pre.map(rebase),future=fut.map((b,j)=>rebase(b,j+180));
    const mid=prefix.at(-1).c,spread=prefix.at(-1).spread,quote={bid:mid-spread/2,ask:mid+spread/2,spread};
    const engine=detect({m1:prefix,bid:quote.bid,ask:quote.ask});
    if(!(engine.atrM3>0)||(mode==='setup'&&!engine.candidates.length))continue;
    const native=createNative();let n;for(let j=95;j<=prefix.length;j++)n=native(prefix.slice(0,j));
    const nc=n?{direction:n.dir<0?'SELL':'BUY',family:'NATIVE_EXHAUSTION',stage:'READY'}:null;
    chosen={id:crypto.randomUUID(),split,mode,createdAt:new Date(clock()).toISOString(),archiveCutoff:new Date(pre.at(-1).t+60000).toISOString(),prefix,future,quote,atr:engine.atrM3,engine,native:nc,predictions:[]};break;
   }
  }
  if(!chosen)throw fail('ARCHIVE_WINDOW_UNAVAILABLE',503);
  await save(l,chosen);return chosen;
 }
 async function predict(l,e,{source='USER',prediction}={}){
  if(e.revealedAt)throw fail('EPISODE_ALREADY_REVEALED',409);
  if(!['USER','MODEL','ENGINE','NATIVE'].includes(source))throw fail('INVALID_SOURCE');
  if(e.predictions.some(x=>x.source===source))throw fail('PREDICTION_ALREADY_SEALED',409);
  let model=null,latencyMs=null;
  if(source==='MODEL'){
   if(!modelPredict)throw fail('MODEL_UNAVAILABLE',503);
   const v=await modelPredict(l,{prefix:e.prefix,quote:e.quote,atr:e.atr,engine:e.engine,image:candlesPng(e.prefix)});
   prediction=v.prediction;model=v.model;latencyMs=v.latencyMs;
  }else if(source!=='USER'){
   const c=source==='NATIVE'?e.native:e.engine.candidates.find(x=>x.stage==='READY')||e.engine.candidates[0];
   prediction=rulePrediction(c,e.quote,e.atr);
  }
  prediction=validatePrediction(prediction,e.quote);
  const sealed={source,model,latencyMs,at:new Date(clock()).toISOString(),prediction};
  sealed.hash=digest({id:e.id,prefix:e.prefix,...sealed});
  e.predictions.push(sealed);await save(l,e);return visible(e);
 }
 async function reveal(l,e){
  if(e.revealedAt)return visible(e);
  if(!e.predictions.length)throw fail('PREDICT_BEFORE_REVEAL',409);
  e.scores=e.predictions.map(p=>({source:p.source,model:p.model,latencyMs:p.latencyMs,hash:p.hash,...scorePrediction(p.prediction,e)}));
  e.revealedAt=new Date(clock()).toISOString();await save(l,e);
  if(learning)for(let i=0;i<e.predictions.length;i++){const p=e.predictions[i],s=e.scores[i];if(s.entered)await learning.resolved(l,{source:'LAB_'+p.source,model:p.model,family:p.prediction.family,direction:p.prediction.direction,thesis:p.prediction.reasoning,episodeId:e.id,predictionHash:p.hash},s);}
  return visible(e);
 }
 return {newEpisode:(l,o)=>lock(l,async()=>visible(await make(l,o))),get:async(l,id)=>visible(await load(l,id)),
  predict:(l,id,o)=>lock(l,async()=>predict(l,await load(l,id),o)),reveal:(l,id)=>lock(l,async()=>reveal(l,await load(l,id))};
}
