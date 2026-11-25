// Research-only blind replay. No execution identifiers or order paths.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {bars,SPLITS} from './archive.mjs';
import {detect} from '../astra/pattern-engine.mjs';
import {createNative} from './native-port.mjs';
import {forwardOutcome} from './outcomes.mjs';
import {candlesPng} from '../astra/chart-png.mjs';
import {modelInfo} from '../astra/models.mjs';
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
 const root=path.join(dataDir,'astra-lab'),active=new Set(),runningBenchmarks=new Map();
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
 async function predict(l,e,{source='USER',prediction,requestedModel=null}={}){
  if(e.revealedAt)throw fail('EPISODE_ALREADY_REVEALED',409);
  if(!['USER','MODEL','ENGINE','NATIVE'].includes(source))throw fail('INVALID_SOURCE');
  if(requestedModel!==null&&(source!=='MODEL'||!modelInfo(requestedModel)||modelInfo(requestedModel).legacy))throw fail('INVALID_MODEL');
  if(e.predictions.some(x=>x.source===source&&(source!=='MODEL'||requestedModel===null||x.model===requestedModel)))throw fail('PREDICTION_ALREADY_SEALED',409);
  let model=null,latencyMs=null;
  if(source==='MODEL'){
   if(!modelPredict)throw fail('MODEL_UNAVAILABLE',503);
   const v=await modelPredict(l,{prefix:e.prefix,quote:e.quote,atr:e.atr,engine:e.engine,image:candlesPng(e.prefix),requestedModel});
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
 async function saveBenchmark(l,j){
  const d=path.join(dir(l),'benchmarks');await fs.mkdir(d,{recursive:true,mode:0o700});
  const file=path.join(d,j.id+'.json'),tmp=file+'.'+crypto.randomUUID();await fs.writeFile(tmp,JSON.stringify(j),{mode:0o600});await fs.rename(tmp,file);
 }
 async function getBenchmark(l,id){
  if(!validId(id))throw fail('BENCHMARK_NOT_FOUND',404);
  let j;try{j=JSON.parse(await fs.readFile(path.join(dir(l),'benchmarks',id+'.json'),'utf8'));}catch(e){if(e.code==='ENOENT')throw fail('BENCHMARK_NOT_FOUND',404);throw e;}
  if(j.status==='RUNNING'&&runningBenchmarks.get(l)!==id)return {...j,status:'INTERRUPTED',reason:'SERVER_RESTARTED'};
  return j;
 }
 function summarize(rows,requested){
  const groups={};
  for(const r of rows){const g=groups[r.source==='MODEL'?'MODEL · '+r.model:r.source]??={predictions:0,entered:0,favourable:0,adverse:0,flat:0,abstained:0,mfe:0,mae:0,brierSum:0,brierN:0,latency:0,latencyN:0};
   g.predictions++;if(r.result==='ABSTAINED'){g.abstained++;continue;}g.entered++;g.mfe+=r.mfeAtr;g.mae+=r.maeAtr;
   if(r.result==='FAVOURABLE_FIRST')g.favourable++;else if(r.result==='ADVERSE_FIRST')g.adverse++;else g.flat++;
   if(r.source==='MODEL'&&r.result!=='NEITHER_WITHIN_120M'){g.brierSum+=(r.confidence/100-(r.result==='FAVOURABLE_FIRST'?1:0))**2;g.brierN++;}
   if(Number.isFinite(r.latencyMs)){g.latency+=r.latencyMs;g.latencyN++;}
  }
  return Object.fromEntries(Object.entries(groups).map(([source,g])=>[source,{predictions:g.predictions,coverage:g.predictions/requested,entered:g.entered,entryRate:g.entered/g.predictions,abstained:g.abstained,favourable:g.favourable,adverse:g.adverse,flat:g.flat,winRateResolved:g.favourable+g.adverse?g.favourable/(g.favourable+g.adverse):null,avgMfeAtr:g.entered?g.mfe/g.entered:null,avgMaeAtr:g.entered?g.mae/g.entered:null,brierResolved:g.brierN?g.brierSum/g.brierN:null,avgLatencyMs:g.latencyN?g.latency/g.latencyN:null}]));
 }
 async function benchmark(l,{split='VALIDATION',mode='random',n=10,includeModel=false,models=[]}={}){
  if(!['VALIDATION','HELD_OUT'].includes(split)||!['setup','random'].includes(mode)||!Number.isInteger(n)||n<1||n>100||typeof includeModel!=='boolean'||!Array.isArray(models)||models.length>9||new Set(models).size!==models.length||models.some(m=>!modelInfo(m)||modelInfo(m).legacy)||((includeModel||models.length)&&n>20))throw fail('INVALID_BENCHMARK_OPTIONS');
  if(active.has(l)||runningBenchmarks.has(l))throw fail('LAB_ALREADY_RUNNING',409);
  const j={id:crypto.randomUUID(),split,mode,n,includeModel,models,status:'RUNNING',completed:0,createdAt:new Date(clock()).toISOString(),episodes:[],errors:[],results:{}};
  runningBenchmarks.set(l,j.id);active.add(l);
  try{await saveBenchmark(l,j);}catch(e){runningBenchmarks.delete(l);active.delete(l);throw e;}
  // The service owns the job; no request remains open while model calls run.
  void (async()=>{
   const rows=[];
   try{
    for(let i=0;i<n;i++){
     const e=await make(l,{split,mode});await predict(l,e,{source:'ENGINE'});await predict(l,e,{source:'NATIVE'});
     const selections=models.length?models:includeModel?[null]:[];
     for(const requestedModel of selections){try{await predict(l,e,{source:'MODEL',requestedModel});}catch(err){j.errors.push({episode:e.id,source:'MODEL',model:requestedModel,reason:err.safe?err.message:'MODEL_FAILED'});}}
     const revealed=await reveal(l,e);j.episodes.push(e.id);
     for(const s of revealed.scores){const p=revealed.predictions.find(p=>p.hash===s.hash);rows.push({...s,confidence:p.prediction.confidence});}
     j.completed++;j.results=summarize(rows,n);await saveBenchmark(l,j);
     if(j.errors.some(e=>['RESEARCH_BUDGET_REACHED','NO_API_KEY','SETTINGS_CHANGED'].includes(e.reason))){j.status='PARTIAL';break;}
     await new Promise(resolve=>setImmediate(resolve));
    }
    if(j.status==='RUNNING')j.status=j.errors.length?'PARTIAL':'COMPLETED';
   }catch(err){j.status='FAILED';j.reason=err.safe?err.message:'BENCHMARK_FAILED';}
   finally{j.finishedAt=new Date(clock()).toISOString();try{await saveBenchmark(l,j);}finally{active.delete(l);runningBenchmarks.delete(l);}}
  })().catch(()=>{active.delete(l);runningBenchmarks.delete(l);});
  return {...j};
 }
 return {benchmark,getBenchmark,newEpisode:(l,o)=>lock(l,async()=>visible(await make(l,o))),get:async(l,id)=>visible(await load(l,id)),
  predict:(l,id,o)=>lock(l,async()=>predict(l,await load(l,id),o)),reveal:(l,id)=>lock(l,async()=>reveal(l,await load(l,id)))};
}
