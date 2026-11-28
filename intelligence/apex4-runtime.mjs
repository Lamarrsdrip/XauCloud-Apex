import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import crypto from 'node:crypto';
import {normalizeBars,selectIndependentPlan,wire,independentNativeOutlook} from './apex4-engine.ts';
import {buildEvidencePack} from './xaucloud/aiTraderBrain.ts';
import { brainScope, createApexTradeBrain } from './apex4-trade-brain.mjs';
import { checkEducation } from './apex4-pullback-education.mjs';
import { canonicalSourceCommit, readNativeEvidence, normalizeNativeEvidence } from './apex4-canonical-evidence.mjs';
const states=new Map();
const accountLocks=new Map();
let brain=null;

export function initializeTradeBrain(dataDir) {
 if(!brain){
  const policyVersion=crypto.createHash('sha256')
   .update(readFileSync(new URL('./apex4-engine.ts',import.meta.url)))
   .update(readFileSync(new URL('./apex4-canonical-evidence.mjs',import.meta.url)))
   .update(readFileSync(new URL('./apex4-pullback-education.mjs',import.meta.url)))
   .digest('hex');
  brain=createApexTradeBrain(dataDir,{policyVersion});
 }
}
export function recordBrokerEvents(key,account,events) {
 return brain?.recordBrokerEvents(key,account,events) ?? null;
}
export function runLearningCycle() {
 return brain?.cycle() ?? {processed:0};
}
export function changeLearningKnowledge(key,account,action,versionId) {
 if(!brain)throw Error('LEARNING_UNAVAILABLE');
 return brain.changeKnowledge(brainScope(key,account),{action,versionId});
}
function withAccountLock(id,fn) {
 const pending=(accountLocks.get(id)??Promise.resolve()).catch(()=>{}).then(fn);
 accountLocks.set(id,pending);
 return pending.finally(()=>{if(accountLocks.get(id)===pending)accountLocks.delete(id);});
}
let knowledgeCache=null,knowledgeMtime=0,loading=null;
const idOf=brainScope;
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
  knowledgeCache={ ...k, digest:crypto.createHash('sha256').update(JSON.stringify(k)).digest('hex') };
  knowledgeMtime=st.mtimeMs;
  return knowledgeCache;
 }catch{return null;}})();
 try{return await loading;}finally{loading=null;}
}
let educationCache = null;
async function educationKnowledge() {
 const file = process.env.APEX4_EDUCATION_FILE;
 if (!file) return undefined;
 try {
  const info = await fs.stat(file);
  const key = JSON.stringify([file, info.ino, info.mtimeMs, info.ctimeMs, info.size]);
  if (educationCache?.key === key) return educationCache.knowledge;
  if (info.size > 5_000_000) return null;
  const manifest = JSON.parse(await fs.readFile(file, 'utf8'));
  const supported = checkEducation(manifest) ? manifest : null;
  educationCache = {key, knowledge: supported};
  return supported;
 } catch {
  return null;
 }
}
function educationStatus(education) {
 if (!education) return {
  status: education === undefined ? 'AWAITING_CLASSROOM' : 'CLASSROOM_FILE_UNAVAILABLE',
 };
 return {
  status: education.exam?.qualifies ? 'FORWARD_QUALIFIED' :
   education.exam ? 'FORWARD_NOT_QUALIFIED' : 'AWAITING_INDEPENDENT_EXAM',
  version: education.id, through: new Date(education.trainingThrough).toISOString(),
  samples: education.samples ?? null,
  candidateGroups: education.ruleSet.length,
  executionGroups: education.exam?.qualifies ? education.ruleSet.length : 0,
  exam: education.exam?.portfolio ?? null,
  referenceCases: education.exam?.reference?.count ?? education.exam?.reference?.n ?? null,
  examVerdict: education.exam?.verdict ?? null,
 };
}
function sanitizeQuote(raw,now){
 if(!raw||!Number.isFinite(raw.bid)||!Number.isFinite(raw.ask)||!Number.isFinite(raw.atMs)||raw.bid<=0||raw.ask<raw.bid||raw.atMs>now+2000||now-raw.atMs>3000)return null;
 return {bid:raw.bid,ask:raw.ask,at:new Date(raw.atMs).toISOString()};
}
const observerConfigured=()=>!!process.env.APEX4_LOCAL_EVIDENCE_DIR&&process.env.APEX4_CANONICAL_SOURCE_COMMIT===canonicalSourceCommit;
function m10Snapshot(evidence,brokerServer){
 if(!evidence)return {status:!observerConfigured()?'NOT_CONFIGURED':brokerServer?'AWAITING_VERIFIED_EVIDENCE':'BROKER_ID_MISSING'};
 const m10=evidence.canonicalM10;
 return {status:'VERIFIED',observedAt:evidence.observedAt,sourceCommit:evidence.producer,
  evidenceId:m10.evidence_id??evidence.thesis.evidence_id??null,direction:m10.direction||m10.preferred_direction||null,
  decision:m10.decision??null,confidence:m10.confidence??null};
}
function currentM10(s,now){
 const m10=s?.m10;
 if(!m10)return {status:observerConfigured()?'AWAITING_VERIFIED_EVIDENCE':'NOT_CONFIGURED'};
 return m10.status==='VERIFIED'&&now-m10.observedAt>3000?{...m10,status:'STALE'}:m10;
}

export async function analyzeBroker(key,account,input,now=Date.now(),{armed=true}={}){
 const q=sanitizeQuote(input.quote,now);
 if(!q)return {status:'STALE_QUOTE',text:'NONE|STALE_QUOTE'};
 const id=idOf(key,account);
 let added;
 try{added=normalizeBars(input.bars);}catch{return{status:'INVALID_BARS',text:'NONE|INVALID_BARS'};}
 return withAccountLock(id,async()=>{
  if(!brain)throw Error('LEARNING_UNAVAILABLE');
  const observation=brain.capture(key,account,{quote:q,bars:added,now,metadata:input});
  const old=states.get(id);
  const bars=old&&old.observationId===observation.priorId
   ? (()=>{const merged=new Map(old.bars.map(b=>[b.t,b]));
     for(const b of observation.added)merged.set(b.t,b);
     return [...merged.values()].sort((a,b)=>a.t-b.t).slice(-7500);})()
   : brain.recentBars(id,now,observation.id);
  let decision=observation.duplicate?brain.decisionAt(observation):null;
  if(!decision){
   const brokerServer=typeof input.brokerServer==='string'&&input.brokerServer.trim()?input.brokerServer.trim():undefined;
   const native=brokerServer?await readNativeEvidence(id,{account,brokerServer,quote:q,now}):undefined;
   const m10=m10Snapshot(native,brokerServer);
   if(bars.length<450){
    decision=brain.recordDecision(observation,{status:'NEED_HISTORY',local:null,plan:null,m10},{now});
   } else {
    const [k, education]=await Promise.all([knowledge(),educationKnowledge()]);
    // Only the first 25 seconds of an hourly interval use the native fields for a decision.
    const canonical=now%3600000<25000?native:undefined;
    const selected={...selectIndependentPlan(bars,q,now,k,canonical,education),m10};
    decision=brain.recordDecision(observation,armed?selected:{...selected,status:'NOT_ARMED',
     researchPlan:selected.researchPlan??selected.plan,baselineSelected:!!selected.plan,plan:null},{now,canonical,
      knowledgeDigest:selected.researchPlan?.source==="APEX4_PULLBACK_CLASSROOM_V1"?education?.id:k?.digest});
   }
  }
  const plan=armed&&decision.plan?.expires>now?decision.plan:null;
  const status=decision.status==='NEED_HISTORY'?'NEED_HISTORY':armed?decision.status:'NOT_ARMED';
  const state={key,account,bars,quote:q,at:decision.at??now,status,local:decision.local,plan,
   detected:decision.researchPlan,pullbackEvidence:decision.pullbackEvidence,m10:decision.m10,observationId:observation.id};
  if(!old||old.observationId<=observation.id){
   states.delete(id);states.set(id,state);
   while(states.size>64)states.delete(states.keys().next().value);
  }
  const reason={NEED_HISTORY:'NEED_HISTORY',NOT_ARMED:'NOT_ARMED',KNOWLEDGE_MISSING:'KNOWLEDGE_MISSING',MISSING_BROKER_DATA:'STALE_QUOTE'}[status];
  return {status,text:reason?'NONE|'+reason:wire(plan),local:decision.local?.status??null};
 });
}

function persistedState(key,account=null){
 const saved=brain?.latestMarket(key,account);
 if(!saved)return null;
 return {bars:saved.bars,quote:saved.quote,at:saved.at,status:saved.decision?.status??'AWAITING_EVALUATION',
  local:saved.decision?.local??null,plan:saved.decision?.plan??null,detected:saved.decision?.researchPlan??null,
  m10:saved.decision?.m10??null,pullbackEvidence:saved.decision?.pullbackEvidence??null,scope:saved.scope};
}
function chatExecution(scope){
 const execution=scope?brain?.latestExecution(scope):null;
 if(!execution)return null;
 const {dealId,positionId,eventId,planId,...researchContext}=execution;
 return researchContext;
}
export async function chatContext(key,now=Date.now()){
 const latest=[...states.values()].filter(s=>s.key===key).sort((a,b)=>b.at-a.at)[0]??persistedState(key);
 const scope=latest?.scope??(latest?idOf(key,latest.account):null);
 const [k,education]=await Promise.all([knowledge(),educationKnowledge()]);
 return {
  mode:'APEX4_PROVIDER_FREE_EXECUTION_RESEARCH',
  market:latest&&now-latest.at<600000?buildEvidencePack(latest.bars,now,latest.quote):null,
  marketAgeMs:latest?now-latest.at:null,localOutlook:latest?.local??null,lastDecision:latest?.plan??null,
  lastDetectedSetup:latest?.detected??null,pullbackEvidence:latest?.pullbackEvidence??null,
  pullbackEducation:education?{
   ...educationStatus(education), referenceExam:education.exam?.reference??null,
   developmentPerformance:education.measurements?.portfolio??null,
   patternPerformance:education.measurements?.featureGroups?.stage??null,
  }:educationStatus(education),m10:currentM10(latest,now),
  status:latest?.status??'NO_LOCAL_MARKET',
  historical:k?{through:new Date(k.dataThrough).toISOString(),hoursWAT:k.hours,validatedPullbackGroups:k.pullbacks,
   outlookQuality:k.history,pullbackHoldout:k.diagnostics?.pullbackHoldout,strategyEvidence:k.diagnostics?.strategyEvidence,
   caseCount:k.diagnostics?.caseCount,pullbackCaseCount:k.diagnostics?.pullbackCaseCount}:null,
  currentLearning:scope?brain?.summary(scope)??null:null,
  promotedResearch:scope?brain?.promotedResearch(scope)??null:null,
  recentLessons:scope?brain?.recentLessons(scope)??[]:[],
  latestExecution:chatExecution(scope),
  caveat:'Observed-quote simulations and EA-reported broker deals are separate. Chat has no order authority.'
 };
}

export async function dashboardStatus(key,account,now=Date.now()){
 const scope=idOf(key,String(account||''));
 const s=states.get(scope)??(account?persistedState(key,String(account)):null);
 const [k,education]=await Promise.all([knowledge(),educationKnowledge()]);
 const fresh=!!s&&now>=s.at&&now-s.at<=8000&&now-Date.parse(s.quote.at)<=8000;
 return {mode:'APEX4_DEMO',fresh,observedAt:s?new Date(s.at).toISOString():null,
  status:s?(fresh?s.status:'MARKET_STALE'):'AWAITING_CANDIDATE',
  quote:fresh?s.quote:null,plan:fresh&&s.plan&&s.plan.expires>now?s.plan:null,
  latestAssessment:s?.local??null,latestDecision:s?{status:s.status,at:new Date(s.at).toISOString(),plan:s.plan,detected:s.detected,pullbackEvidence:s.pullbackEvidence}:null,
  m10:currentM10(s,now),
  candles:s?s.bars.slice(-60):[],
  knowledge:{loaded:!!k,through:k?new Date(k.dataThrough).toISOString():null,hoursWAT:k?.hours??[],pullbackGroups:k?.pullbacks?.length??0,
   caseCount:k?.diagnostics?.caseCount??null,pullbackCaseCount:k?.diagnostics?.pullbackCaseCount??null},
  education:educationStatus(education),
  learning:account?brain?.summary(scope)??null:null,
  latestExecution:account?brain?.latestExecution(scope)??null:null,
  canonicalProducerConfigured:observerConfigured(),
  execution:'DEMO_ONLY',modelExecution:false};
}

const nativeHourlyPublications=new Map();
export async function nativeOutlookForBasket(key,account,input,now,hours){
 const scope=idOf(key,account),hour=Math.floor(now/3600000);
 if(!hours.includes(new Date(now+3600000).getUTCHours())||now%3600000>=60000)return {status:'OUTSIDE_OUTLOOK_WINDOW',signal:null};
 return withAccountLock('native:'+scope,async()=>{
  const old=nativeHourlyPublications.get(scope);
  if(old?.hour===hour)return old.signal.expiresAt>now?{status:'STRONG',signal:old.signal}:{status:'OUTLOOK_EXPIRED',signal:null};
  const k=await knowledge();
  if(!k||!k.rules.length||!k.history?.STRONG?.signals)return {status:'OUTLOOK_GRADE_UNAVAILABLE',signal:null};
  const brokerServer=typeof input.brokerServer==='string'?input.brokerServer:'';
  // Optional operator-controlled local file is preferred. Authenticated demo
  // terminal packets are untrusted observations, never proof of live fills or
  // historical training labels. Source/schema/freshness/account are checked.
  const q=sanitizeQuote(input.nativeEvidence?.quote,now);
  if(!q||!brokerServer)return {status:'AWAITING_NATIVE_EVIDENCE',signal:null};
  const canonical=await readNativeEvidence(scope,{account,brokerServer,quote:q,now})
    ??normalizeNativeEvidence(input.nativeEvidence,{account,brokerServer,quote:q,now});
  let bars;
  try{bars=normalizeBars(input.bars);}catch{return {status:'INVALID_NATIVE_BARS',signal:null};}
  const result=independentNativeOutlook(bars,q,now,k,canonical,hours);
  if(result.signal){
   nativeHourlyPublications.set(scope,{hour,signal:result.signal});
   while(nativeHourlyPublications.size>128)nativeHourlyPublications.delete(nativeHourlyPublications.keys().next().value);
  }
  return result;
 });
}
