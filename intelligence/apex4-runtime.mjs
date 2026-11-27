import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import {normalizeBars,selectIndependentPlan,wire,brokerFrames} from './apex4-engine.ts';
import {buildEvidencePack} from './xaucloud/aiTraderBrain.ts';
const states=new Map();
let knowledgeCache=null,knowledgeMtime=0,loading=null;
const idOf=(key,account)=>crypto.createHash('sha256').update(key+'|'+account).digest('hex');
async function knowledge(){
 const file=process.env.APEX4_KNOWLEDGE_FILE;
 if(!file)return null;
 if(loading)return loading;
 loading=(async()=>{try{
  const st=await fs.stat(file);
  if(knowledgeCache&&st.mtimeMs===knowledgeMtime)return knowledgeCache;
  if(st.size>20_000_000)throw Error('KNOWLEDGE_TOO_LARGE');
  const k=JSON.parse(await fs.readFile(file,'utf8'));
  if(k.version!=='APEX4_XAUCLOUD_DETERMINISTIC_V1'||!Number.isFinite(k.dataThrough)||!Array.isArray(k.rules)||!k.history||!Array.isArray(k.hours)||!Array.isArray(k.pullbacks))throw Error('INVALID_KNOWLEDGE');
  knowledgeCache=k;knowledgeMtime=st.mtimeMs;return k;
 }catch{return null;}})();
 try{return await loading;}finally{loading=null;}
}
function sanitizeQuote(raw,now){
 if(!raw||!Number.isFinite(raw.bid)||!Number.isFinite(raw.ask)||!Number.isFinite(raw.atMs)||raw.bid<=0||raw.ask<raw.bid||raw.atMs>now+2000||now-raw.atMs>3000)return null;
 return {bid:raw.bid,ask:raw.ask,at:new Date(raw.atMs).toISOString()};
}
export async function analyzeBroker(key,account,input,now=Date.now()){
 const q=sanitizeQuote(input.quote,now);
 if(!q)return {status:'STALE_QUOTE',text:'NONE|STALE_QUOTE'};
 const id=idOf(key,account),old=states.get(id);
 let added;
 try{added=normalizeBars(input.bars);}catch{return{status:'INVALID_BARS',text:'NONE|INVALID_BARS'};}
 const merge=new Map((old?.bars??[]).map(b=>[b.t,b]));
 for(const b of added)if(b.t+60000<=now)merge.set(b.t,b);
 const bars=[...merge.values()].sort((a,b)=>a.t-b.t).slice(-7500);
 if(bars.length<450){return{status:'NEED_HISTORY',text:'NONE|NEED_HISTORY'};}
 const k=await knowledge();
 // Local broker M1 ingestion only. Never accept arbitrary user-supplied M10 evidence
 // as "the XauCloud EA". The original producer must be integrated and attested first.
 const decision=selectIndependentPlan(bars,q,now,k);
 const state={key,account,bars,quote:q,at:now,status:decision.status,local:decision.local,plan:decision.plan};
 states.delete(id);states.set(id,state);
 while(states.size>64)states.delete(states.keys().next().value);
 return {status:decision.status,text:wire(decision.plan),local:decision.local?.status??null};
}
export async function chatContext(key,now=Date.now()){
 const latest=[...states.values()].filter(s=>s.key===key).sort((a,b)=>b.at-a.at)[0];
 const k=await knowledge();
 return {
  mode:'APEX4_PROVIDER_FREE_EXECUTION_RESEARCH',
  market:latest&&now-latest.at<600000?buildEvidencePack(latest.bars,now,latest.quote):null,
  marketAgeMs:latest?now-latest.at:null,localOutlook:latest?.local??null,lastDecision:latest?.plan??null,
  status:latest?.status??'NO_LOCAL_MARKET',
  historical:k?{through:new Date(k.dataThrough).toISOString(),hoursWAT:k.hours,validatedPullbackGroups:k.pullbacks,
   outlookQuality:k.history,pullbackHoldout:k.diagnostics?.pullbackHoldout,strategyEvidence:k.diagnostics?.strategyEvidence}:null,
  caveat:'Historical evidence is not guaranteed performance. Experimental local Outlook is not parity with the original M10 producer. No chat response can execute an order.'
 };
}
