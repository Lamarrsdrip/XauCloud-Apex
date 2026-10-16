import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createAstraVault} from './vault.mjs';
import {buildContext} from './context.mjs';
import {DECISION_SCHEMA,KNOWLEDGE_VERSION,bindDecision,validateDecision} from './contract.mjs';
import {knowledge} from './retrieval.mjs';

const EVENT_ACTION={ENTER_BUY:'ASTRA_ENTRY',ENTER_SELL:'ASTRA_ENTRY',ADD:'ASTRA_ADD',HOLD:'ASTRA_HOLD',
  STOP_ADDING:'ASTRA_STOP_ADDING',EXIT:'ASTRA_EXIT',REDUCE:'ASTRA_STOP_ADDING',WAIT:'ASTRA_SETUP_WATCH'};
const failure=reason=>Object.assign(new Error(reason),{safe:true});

// Only this function crosses the provider boundary. The URL is fixed: a customer's
// key can never be redirected to a model-supplied/custom base URL. Provider error
// bodies, headers and request payloads are deliberately never logged or returned.
export async function callOpenAI({key,model,effort='default',context,fetchImpl=fetch,timeoutMs=6000,signal,loadKnowledge=knowledge}) {
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
  const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});
  try {
    if(signal?.aborted)throw failure('AI_TIMEOUT');
    const {instructions,examples}=await loadKnowledge(context);
    // The deadline also covers knowledge loading; never start a request after it expired.
    if(controller.signal.aborted)throw failure('AI_TIMEOUT');
    const response=await fetchImpl('https://api.openai.com/v1/responses',{
      method:'POST',headers:{authorization:`Bearer ${key}`,'content-type':'application/json'},signal:controller.signal,
      body:JSON.stringify({model,store:false, instructions,
        input:JSON.stringify({referenceExamples:examples,market:context}),
        ...(effort!=='default'?{reasoning:{effort}}:{}),
        // Reasoning tokens count against this budget; too small a cap yields incomplete output.
        text:{format:{type:'json_schema',name:'astra_decision',strict:true,schema:DECISION_SCHEMA}},max_output_tokens:6000})
    });
    if(response.status===401||response.status===403)throw failure('AUTH_ERROR');
    if(response.status===429) {
      let code='';try{code=(await response.json()).error?.code||'';}catch{}
      throw failure(code==='insufficient_quota'?'NO_CREDIT':'RATE_LIMITED');
    }
    if(!response.ok)throw failure('AI_ERROR');
    const data=await response.json();
    if(data.status!=='completed')throw failure('AI_INCOMPLETE');
    const content=(data.output||[]).filter(x=>x.type==='message'&&x.role==='assistant').flatMap(x=>x.content||[]);
    if(content.some(x=>x.type==='refusal'))throw failure('AI_REFUSAL');
    const parts=content.filter(x=>x.type==='output_text');
    if(parts.length!==1||typeof parts[0].text!=='string'||parts[0].text.length>12000)throw failure('SCHEMA_FAILURE');
    let raw;try{raw=JSON.parse(parts[0].text);}catch{throw failure('SCHEMA_FAILURE');}
    return validateDecision(raw);
  }catch(e) {
    if(controller.signal.aborted||e.name==='AbortError')throw failure('AI_TIMEOUT');
    if(e.safe||['SCHEMA_FAILURE','DIRECTION_MISMATCH','INVALID_THESIS','ACTION_STATE_MISMATCH'].includes(e.message))throw e;
    throw failure('AI_ERROR');
  }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}

export function createAstraService({dataDir,emit=async()=>{},fetchImpl=fetch,clock=Date.now,timeoutMs=6000}={}) {
  const vault=createAstraVault(dataDir),jobs=new Map(),last=new Map(),running=new Map(),recent=new Map();
  // Persisted per-license request counts per UTC day (hashed identity, no license text).
  const usageFile=path.join(dataDir,'astra-usage.json');let usage=null,usageChain=Promise.resolve();
  const day=()=>new Date(clock()).toISOString().slice(0,10);
  const uid=license=>crypto.createHash('sha256').update(String(license)).digest('hex').slice(0,32);
  async function loadUsage(){if(usage)return usage;try{usage=JSON.parse(await fs.readFile(usageFile,'utf8'));}catch{usage={};}
    if(!usage||typeof usage!=='object'||Array.isArray(usage))usage={};return usage;}
  async function usedToday(license){const u=await loadUsage(),r=u[uid(license)];return r&&r.day===day()?r.count:0;}
  function countRequest(license){usageChain=usageChain.then(async()=>{const u=await loadUsage(),id=uid(license),today=day();
    u[id]=u[id]?.day===today?{day:today,count:u[id].count+1}:{day:today,count:1};
    const tmp=usageFile+'.tmp-'+crypto.randomUUID();await fs.writeFile(tmp,JSON.stringify(u),{mode:0o600});await fs.rename(tmp,usageFile);}).catch(()=>{});
    return usageChain;}
  async function event(license,type,fields={}) {
    // Callers pass only this service's validated DTOs, never an API response/body/key.
    await emit({license,type,strategyVersion:KNOWLEDGE_VERSION,...fields}).catch(()=>{});
  }
  function prune() {
    const now=clock();for(const [id,job]of jobs)if(now-job.started>180000){job.controller.abort();jobs.delete(id);}
    for(const [id,value]of recent)if(now-value.at>180000)recent.delete(id);
    // Bounded job retention. Old records have no authority after expiration.
    if(jobs.size>2000)for(const [id,job]of jobs){if(job.status!=='PENDING')jobs.delete(id);if(jobs.size<=1500)break;}
  }
  function publicJob(job) {
    if(job.status==='ACTIVE'&&clock()>job.result.expiresAtMs)return {status:'AI_ERROR',fallbackReason:'STALE_DECISION',requestId:job.id,snapshotId:job.snapshotId};
    return {status:job.status,requestId:job.id,snapshotId:job.snapshotId,
      fallbackReason:job.fallbackReason||null,...(job.result||{})};
  }
  function cancel(license) {const job=running.get(license);if(job){job.controller.abort();job.status='DISABLED';job.fallbackReason='SETTINGS_CHANGED';running.delete(license);}}
  async function available(license) {
    const settings=await vault.settings(license);
    const requestsToday=await usedToday(license);
    return {...settings,requestsToday,status:!settings.enabled?'DISABLED':!settings.hasKey?'NO_API_KEY':
      requestsToday>=settings.dailyRequestLimit?'DAILY_BUDGET_REACHED':'ASTRA_READY',strategyVersion:KNOWLEDGE_VERSION};
  }
  const service={
    async settings(license) {return service.status(license);},
    async configure(license,patch) {cancel(license);await vault.update(license,patch);last.delete(license);recent.delete(license);return service.status(license);},
    async remove(license) {cancel(license);await vault.remove(license);last.delete(license);recent.delete(license);return service.status(license);},
    async status(license) {
      const base=await available(license),record=last.get(license);
      return {...base,status:base.status==='ASTRA_READY'?(record?.status||'ASTRA_READY'):base.status,
        lastDecision:record?.decision||null,latencyMs:record?.latencyMs??null,
        lastFallbackReason:record?.fallbackReason||null,knowledgeVersion:KNOWLEDGE_VERSION};
    },
    async submit(license,snapshot) {
      prune();
      const settings=await available(license);
      if(settings.status!=='ASTRA_READY')return {status:settings.status,fallbackReason:settings.status};
      const context=buildContext(snapshot,{now:clock()});
      if(context.campaign.positions.length&&context.campaign.owner!=='ASTRA')return {status:'NATIVE_LIFESTYLE',fallbackReason:'CAMPAIGN_OWNED_BY_NATIVE'};
      const pending=running.get(license);
      if(pending) {
        if(pending.snapshotId===context.snapshotId)return publicJob(pending);
        return {status:'PENDING',requestId:pending.id,snapshotId:pending.snapshotId,fallbackReason:null};
      }
      const previous=recent.get(license);
      const eventKey=`${context.structure.eventKey}|${context.campaign.id}|${context.campaign.layers}`;
      if(previous&&clock()-previous.at<2000)return {status:'PENDING',requestId:previous.jobId,snapshotId:previous.snapshotId,fallbackReason:null};
      const id=crypto.randomUUID(),job={id,license,snapshotId:context.snapshotId,status:'PENDING',started:clock(),controller:new AbortController()};
      await countRequest(license);
      jobs.set(id,job);running.set(license,job);recent.set(license,{eventKey,at:clock(),jobId:id,snapshotId:context.snapshotId});
      await event(license,'ASTRA_REQUEST',{decisionId:id,snapshotId:context.snapshotId,model:settings.model});
      job.promise=(async()=>{
        try {
          const raw=await vault.withKey(license,key=>callOpenAI({key,model:settings.model,effort:settings.reasoningEffort,context,fetchImpl,timeoutMs,signal:job.controller.signal}));
          const current=await vault.settings(license);
          if(current.revision!==settings.revision||!current.enabled||job.controller.signal.aborted)return;
          const decision=bindDecision(raw,context,{now:clock(),requestId:id});
          if(clock()>decision.expiresAtMs)throw failure('STALE_DECISION');
          const latencyMs=clock()-job.started;
          job.status='ACTIVE';job.result={...decision,model:settings.model,latencyMs};
          last.set(license,{status:'ASTRA_ACTIVE',decision:{...decision,model:settings.model},latencyMs});
          await event(license,'ASTRA_DECISION',{...decision,model:settings.model,latencyMs});
          if(decision.state==='INVALID')await event(license,'ASTRA_INVALID',{decisionId:id,state:decision.state,action:decision.action});
          // Recommendations are not fills; only the EA emits ASTRA_ENTRY/ADD/EXIT.
          await event(license,EVENT_ACTION[decision.action]==='ASTRA_SETUP_WATCH'?'ASTRA_SETUP_WATCH':'ASTRA_RECOMMENDATION',
            {decisionId:id,state:decision.state,action:decision.action,direction:decision.direction});
        }catch(e) {
          if(job.controller.signal.aborted&&job.status==='DISABLED')return;
          const reason=['AI_TIMEOUT','RATE_LIMITED','NO_CREDIT','AUTH_ERROR','SCHEMA_FAILURE','AI_REFUSAL','AI_INCOMPLETE','STALE_DECISION',
            'DIRECTION_MISMATCH','INVALID_THESIS','ACTION_STATE_MISMATCH','CAMPAIGN_CONFLICT','NO_CAMPAIGN','NATIVE_CAMPAIGN_OWNS_STRATEGY',
            'CAMPAIGN_DIRECTION_CONFLICT','NO_WINNER_PROOF','INVALIDATION_WRONG_SIDE'].includes(e.message)?e.message:'AI_ERROR';
          job.status=['AI_TIMEOUT','RATE_LIMITED','NO_CREDIT'].includes(reason)?reason:'AI_ERROR';job.fallbackReason=reason;
          last.set(license,{status:job.status,fallbackReason:reason,latencyMs:clock()-job.started});
          await event(license,'ASTRA_FALLBACK',{decisionId:id,fallbackReason:reason,model:settings.model,latencyMs:clock()-job.started});
        }finally {if(running.get(license)===job)running.delete(license);}
      })();
      return publicJob(job);
    },
    async decision(license,id) {
      const job=jobs.get(id);if(!job||job.license!==license)return {status:'AI_ERROR',fallbackReason:'UNKNOWN_REQUEST'};
      const settings=await available(license);
      // A request already paid for stays retrievable when it used the last budget slot.
      if(!['ASTRA_READY','DAILY_BUDGET_REACHED'].includes(settings.status))return {status:settings.status,fallbackReason:settings.status};
      return publicJob(job);
    },
    // scope CONNECTION proves key/model/schema reachability only; scope STRATEGY grades
    // synthetic fixtures. Neither proves trading performance; both incur user API cost.
    async test(license,contexts,{scope='STRATEGY'}={}) {
      const settings=await available(license);
      if(!settings.hasKey)return {ok:false,status:'NO_API_KEY',scope,results:[]};
      const results=[];
      for(const item of contexts) {
        const started=clock();
        try {
          const context=buildContext(item.snapshot,{now:clock()});
          const raw=await vault.withKey(license,key=>callOpenAI({key,model:settings.model,effort:settings.reasoningEffort,context,fetchImpl,timeoutMs:20000}));
          // Also apply executable contract rules; tests do not submit to MT5.
          bindDecision(raw,context,{now:context.observedAtMs,requestId:crypto.randomUUID()});
          const latencyMs=clock()-started;
          const matched=item.expected.includes(raw.action)&&(!item.expectedStates||item.expectedStates.includes(raw.state));
          results.push({name:item.name,passed:scope==='CONNECTION'?true:matched,matchedFixture:matched,action:raw.action,state:raw.state,expected:item.expected,latencyMs,
            withinDecisionBudget:latencyMs<=timeoutMs});
        }catch(e){results.push({name:item.name,passed:false,latencyMs:clock()-started,
          error:['NO_CREDIT','RATE_LIMITED','AUTH_ERROR','AI_TIMEOUT','AI_INCOMPLETE','AI_REFUSAL','SCHEMA_FAILURE'].includes(e.message)?e.message:'AI_ERROR'});}
      }
      const ok=results.length>0&&results.every(x=>x.passed);
      return {ok,status:scope==='CONNECTION'?(ok?'CONNECTED':'CONNECTION_FAILED'):(ok?'TEST_PASSED':'TEST_FAILED'),
        model:settings.model,reasoningEffort:settings.reasoningEffort,strategyVersion:KNOWLEDGE_VERSION,scope,
        note:scope==='CONNECTION'?'KEY_MODEL_AND_SCHEMA_REACHABLE_ONLY':'SYNTHETIC_FIXTURES_ONLY_NOT_PERFORMANCE_EVIDENCE',results};
    },
    // In-process test harness waits on actual async lifecycle. Never exposed as HTTP.
    async drain(){await Promise.allSettled([...jobs.values()].map(x=>x.promise));},
    close(){for(const job of jobs.values())job.controller.abort();}
  };
  return service;
}
