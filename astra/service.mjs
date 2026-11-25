import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createAstraVault} from './vault.mjs';
import {buildContext} from './context.mjs';
import {DECISION_SCHEMA,KNOWLEDGE_VERSION,bindDecision,validateDecision} from './contract.mjs';
import {knowledge} from './retrieval.mjs';
import {callAstraChat,validateChatInput} from './chat.mjs';
import {providerForKey,assertProviderModel,callAnthropicDecision,callModel} from './providers.mjs';
import {createLearning} from './learning.mjs';
import {BRAIN_VERSION} from './brain.mjs';
import {MODELS,modelInfo} from './models.mjs';
import {budgetReached} from './contract.mjs';
const providerForModel=model=>/^claude-/i.test(model)?'anthropic':'openai';
import {visionTestChart} from './chart-png.mjs';
import {createConversations} from './conversations.mjs';
import {createLab,LAB_SCHEMA} from '../research/lab.mjs';

const EVENT_ACTION={ENTER_BUY:'ASTRA_ENTRY',ENTER_SELL:'ASTRA_ENTRY',ADD:'ASTRA_ADD',HOLD:'ASTRA_HOLD',
  STOP_ADDING:'ASTRA_STOP_ADDING',EXIT:'ASTRA_EXIT',REDUCE:'ASTRA_STOP_ADDING',WAIT:'ASTRA_SETUP_WATCH'};
const failure=reason=>Object.assign(new Error(reason),{safe:true});
const SAFE_REASONS=['AI_TIMEOUT','RATE_LIMITED','NO_CREDIT','AUTH_ERROR','SCHEMA_FAILURE','AI_REFUSAL','AI_INCOMPLETE','STALE_DECISION',
  'DIRECTION_MISMATCH','INVALID_THESIS','ACTION_STATE_MISMATCH','CAMPAIGN_CONFLICT','NO_CAMPAIGN','NATIVE_CAMPAIGN_OWNS_STRATEGY',
  'CAMPAIGN_DIRECTION_CONFLICT','NO_WINNER_PROOF','INVALIDATION_WRONG_SIDE','MODEL_NOT_AVAILABLE','PROVIDER_REJECTED_REQUEST','PROVIDER_UNAVAILABLE'];

// Only this function crosses the provider boundary for OpenAI decisions. The URL is
// fixed: a customer's key can never be redirected. Provider error bodies,
// headers and request payloads are deliberately never logged or returned.
export async function callOpenAI({key,model,effort='default',context,fetchImpl=fetch,timeoutMs=6000,signal,loadKnowledge=knowledge}) {
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
  const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});
  try {
    if(signal?.aborted)throw failure('AI_TIMEOUT');
    const {instructions,examples,brain}=await loadKnowledge(context);
    // The deadline also covers knowledge loading; never start a request after it expired.
    if(controller.signal.aborted)throw failure('AI_TIMEOUT');
    const r=await callModel({key,model,effort,system:instructions,text:JSON.stringify({apexBrain:brain,referenceExamples:examples,market:context}),
      schema:DECISION_SCHEMA,fetchImpl,signal:controller.signal,maxTokens:12000});
    if(r.text.length>12000)throw failure('SCHEMA_FAILURE');
    let raw;try{raw=JSON.parse(r.text);}catch{throw failure('SCHEMA_FAILURE');}
    return Object.defineProperty(validateDecision(raw),'__usage',{value:r.usage,enumerable:false});
  }catch(e) {
    if(controller.signal.aborted||e.name==='AbortError')throw failure('AI_TIMEOUT');
    if(e.safe||['SCHEMA_FAILURE','DIRECTION_MISMATCH','INVALID_THESIS','ACTION_STATE_MISMATCH'].includes(e.message))throw e;
    throw failure('AI_ERROR');
  }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}

export function callStrategyModel(args){const provider=providerForKey(args.key);assertProviderModel(provider,args.model);return provider==='anthropic'?callAnthropicDecision(args):callOpenAI(args);}

// Deep research thesis: slower, high-effort analysis of a DEVELOPING setup. It is
// conditional ("sell if X happens, invalid if Y") and never an order by itself.
export const THESIS_SCHEMA={type:'object',additionalProperties:false,required:['family','direction','stage','summary','entryCondition','invalidationCondition','invalidationPrice','targetPrices','strengthenedBy','weakenedBy','lateBeyondPrice','confidence'],
  properties:{family:{type:'string',enum:['NONE','V_RECOVERY_FAILURE','SPIKE_REJECTION','BREAK_PAUSE_CONTINUATION','RECOVERY_CONTINUATION','OTHER']},
    direction:{type:'string',enum:['BUY','SELL','NONE']},stage:{type:'string',enum:['NO_SETUP','DEVELOPING','READY','LATE','INVALID']},
    summary:{type:'string'},entryCondition:{type:'string'},invalidationCondition:{type:'string'},invalidationPrice:{type:'number'},
    targetPrices:{type:'array',items:{type:'number'}},strengthenedBy:{type:'string'},weakenedBy:{type:'string'},lateBeyondPrice:{type:'number'},confidence:{type:'number'}}};
const THESIS_PROMPT='\n\nRESEARCH THESIS MODE: take your time and investigate the developing setup in depth. Return a CONDITIONAL plan for the next minutes: what must happen to enter, what invalidates it, where it becomes late, and targets. Prices must come from the supplied market data. This is research for a later fast decision, not an order.';
const THESIS_TTL_MS=10*60000;

export function createAstraService({dataDir,emit=async()=>{},fetchImpl=fetch,clock=Date.now,timeoutMs=7500}={}) {
  const vault=createAstraVault(dataDir),jobs=new Map(),last=new Map(),running=new Map(),recent=new Map();
  const learning=createLearning(dataDir,{clock}),chats=createConversations(dataDir,{clock});
  const lab=createLab(dataDir,{clock,learning,modelPredict:async(license,e)=>{
    const settings=await vault.settings(license);
    const model=e.requestedModel||settings.researchModel||settings.model,info=modelInfo(model),provider=info?.provider||(model.startsWith('claude-')?'anthropic':'openai');
    if(!settings.availableProviders.includes(provider))throw failure('NO_API_KEY');
    if(budgetReached((await usageToday(license)).research||0,settings.researchDailyLimit))throw failure('RESEARCH_BUDGET_REACHED');
    const ctx={campaign:{positions:[],direction:'NONE'},structure:{},patternEngine:e.engine};
    const {instructions,brain,examples}=await knowledge(ctx,{depth:'deep'});
    // Do not give a benchmark model retrospective video outcomes or validation/held-out aggregate results.
    // Training-only analogues are allowed; model pretraining and human reference selection are still possible contamination.
    const blindBrain={brainVersion:brain.brainVersion,families:brain.families,similarHistory:brain.similarHistory};
    await countRequest(license,{kind:'research'});
    const reply=await vault.withKey(license,key=>callModel({key,model,effort:settings.researchEffort,
      system:instructions+'\nBLIND RESEARCH ONLY. Output the lab schema, not an execution decision. The chart is rebased and historical. Assess only the prefix; no future information. Use exact rebased levels and admit uncertainty.',
      text:JSON.stringify({prefix:e.prefix,quote:e.quote,atr:e.atr,engine:e.engine,apexBrain:blindBrain}),image:e.image,schema:LAB_SCHEMA,fetchImpl,signal:AbortSignal.timeout(180000),maxTokens:16000}),provider);
    await countRequest(license,{kind:'researchDone',tokens:reply.usage});
    if((await vault.settings(license)).revision!==settings.revision)throw failure('SETTINGS_CHANGED');
    return {prediction:JSON.parse(reply.text),model,latencyMs:reply.latencyMs};
  }});
  // Research chat has no executable job identifiers or order commands.
  const snapshots=new Map(),chatRunning=new Set(),theses=new Map(),thesisRunning=new Set(),engineSeen=new Map(),lastScreen=new Map();
  // Persisted per-license request counts per UTC day (hashed identity, no license text).
  const usageFile=path.join(dataDir,'astra-usage.json');let usage=null,usageChain=Promise.resolve();
  const day=()=>new Date(clock()).toISOString().slice(0,10);
  const uid=license=>crypto.createHash('sha256').update(String(license)).digest('hex').slice(0,32);
  async function loadUsage(){if(usage)return usage;try{usage=JSON.parse(await fs.readFile(usageFile,'utf8'));}catch{usage={};}
    if(!usage||typeof usage!=='object'||Array.isArray(usage))usage={};return usage;}
  async function usageToday(license){const u=await loadUsage(),r=u[uid(license)];return r&&r.day===day()?r:{day:day(),count:0};}
  async function usedToday(license){return (await usageToday(license)).count;}
  function countRequest(license,{kind='decision',tokens=null}={}){usageChain=usageChain.then(async()=>{const u=await loadUsage(),id=uid(license),today=day();
    const r=u[id]?.day===today?u[id]:{day:today,count:0};
    if(kind==='decision')r.count=(r.count||0)+1;else r[kind]=(r[kind]||0)+1;
    if(tokens){r.inputTokens=(r.inputTokens||0)+(tokens.inputTokens||0);r.outputTokens=(r.outputTokens||0)+(tokens.outputTokens||0);}
    u[id]=r;const tmp=usageFile+'.tmp-'+crypto.randomUUID();await fs.writeFile(tmp,JSON.stringify(u),{mode:0o600});await fs.rename(tmp,usageFile);}).catch(()=>{});
    return usageChain;}
  async function event(license,type,fields={}) {
    // Callers pass only this service's validated DTOs, never an API response/body/key.
    await emit({license,type,strategyVersion:KNOWLEDGE_VERSION,...fields}).catch(()=>{});
  }
  function prune() {
    const now=clock();for(const [id,job]of jobs)if(now-job.started>180000){job.controller.abort();jobs.delete(id);}
    for(const [id,value]of recent)if(now-value.at>180000)recent.delete(id);
    for(const [id,value]of snapshots)if(now-value.observedAtMs>600000)snapshots.delete(id);
    for(const [id,t]of theses)if(now-t.createdAtMs>THESIS_TTL_MS*3)theses.delete(id);
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
    const today=await usageToday(license),requestsToday=today.count||0;
    return {...settings,requestsToday,researchToday:today.research||0,tokensToday:{input:today.inputTokens||0,output:today.outputTokens||0},
      status:!settings.enabled?'DISABLED':!settings.hasKey?'NO_API_KEY':
      budgetReached(requestsToday,settings.dailyRequestLimit)?'DAILY_BUDGET_REACHED':'ASTRA_READY',strategyVersion:KNOWLEDGE_VERSION,brainVersion:BRAIN_VERSION};
  }
  const mid=c=>(c.quote.bid+c.quote.ask)/2;
  const atrOf=c=>c.patternEngine?.atrM3||c.structure.atr*Math.sqrt(3);
  function freshThesis(license,context){
    const t=theses.get(license);if(!t||t.status!=='READY')return null;
    const age=clock()-t.createdAtMs,drift=Math.abs(mid(context)-t.mid);
    // A slower answer is never current once the market has materially changed.
    const stillThere=(context.patternEngine?.candidates||[]).some(c=>c.family===t.thesis.family&&c.direction===t.thesis.direction);
    if(age>THESIS_TTL_MS||drift>1.5*t.atr||!stillThere)return null;
    return {...t.thesis,ageSec:Math.round(age/1000),madeAtPrice:+t.mid.toFixed(3),model:t.model,note:'Made earlier by deep research; verify its conditions against the live candles.'};
  }
  async function maybeResearch(license,context,settings){
    const top=(context.patternEngine?.candidates||[])[0];
    if(!top||!settings.researchEnabled||thesisRunning.has(license))return;
    const cur=theses.get(license);
    if(cur&&cur.eventKey===top.eventKey&&clock()-cur.createdAtMs<THESIS_TTL_MS)return;
    const today=await usageToday(license);if(budgetReached(today.research||0,settings.researchDailyLimit))return;
    const researchModel=settings.researchModel||settings.model,researchProvider=providerForModel(researchModel);
    if(!settings.availableProviders.includes(researchProvider))return;
    thesisRunning.add(license);await countRequest(license,{kind:'research'});
    (async()=>{
      const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),180000);
      try{
        const lessons=await learning.lessons(license,{family:top.family,direction:top.direction});
        const {instructions,examples,brain}=await knowledge(context,{lessons,depth:'deep'});
        const r=await vault.withKey(license,key=>callModel({key,model:researchModel,effort:settings.researchEffort,system:instructions+THESIS_PROMPT,
          text:JSON.stringify({apexBrain:brain,referenceExamples:examples,market:context}),schema:THESIS_SCHEMA,maxTokens:32000,fetchImpl,signal:ctrl.signal}),researchProvider);
        const thesis=JSON.parse(r.text);
        if((await vault.settings(license)).revision!==settings.revision)return;
        theses.set(license,{status:'READY',eventKey:top.eventKey,createdAtMs:clock(),mid:mid(context),atr:atrOf(context),thesis,model:researchModel,latencyMs:r.latencyMs});
        await countRequest(license,{kind:'researchDone',tokens:r.usage});
        if(thesis.direction!=='NONE')await learning.predict(license,{source:'RESEARCH_THESIS',model:researchModel,family:thesis.family,direction:thesis.direction,stage:thesis.stage,
          entry:thesis.direction==='SELL'?context.quote.bid:context.quote.ask,atr:atrOf(context),thesis:thesis.summary?.slice(0,300),eventKey:top.eventKey});
        await event(license,'ASTRA_RESEARCH_THESIS',{family:thesis.family,direction:thesis.direction,stage:thesis.stage,model:researchModel,latencyMs:r.latencyMs});
      }catch(e){if((await vault.settings(license)).revision===settings.revision)theses.set(license,{status:'FAILED',eventKey:top.eventKey,createdAtMs:clock(),reason:e.safe?e.message:'AI_ERROR'});}
      finally{clearTimeout(timer);thesisRunning.delete(license);}
    })();
  }
  async function recordEngine(license,context){
    // Free, deterministic predictions: the engine's READY calls are tracked live so
    // native, engine and AI can be compared on the same market.
    const seen=engineSeen.get(license)||new Set();engineSeen.set(license,seen);
    for(const c of context.patternEngine?.candidates||[])if(c.stage==='READY'&&!seen.has(c.eventKey)){
      seen.add(c.eventKey);if(seen.size>500)seen.delete(seen.values().next().value);
      await learning.predict(license,{source:'ENGINE',family:c.family,direction:c.direction,stage:c.stage,entry:c.entry,atr:context.patternEngine.atrM3,eventKey:c.eventKey});
    }
  }
  const service={
    models:MODELS,
    async settings(license) {return service.status(license);},
    async configure(license,patch) {cancel(license);await vault.update(license,patch);last.delete(license);recent.delete(license);theses.delete(license);return service.status(license);},
    async remove(license) {cancel(license);snapshots.delete(license);theses.delete(license);await vault.remove(license);last.delete(license);recent.delete(license);return service.status(license);},
    async status(license) {
      const base=await available(license),record=last.get(license),t=theses.get(license),snap=snapshots.get(license);
      return {...base,status:base.status==='ASTRA_READY'?(record?.status||'ASTRA_READY'):base.status,
        lastDecision:record?.decision||null,latencyMs:record?.latencyMs??null,
        lastFallbackReason:record?.fallbackReason||null,knowledgeVersion:KNOWLEDGE_VERSION,modelInfo:modelInfo(base.model),
        research:t?{status:t.status,ageSec:Math.round((clock()-t.createdAtMs)/1000),thesis:t.thesis||null,reason:t.reason||null,latencyMs:t.latencyMs??null,running:thesisRunning.has(license)}:{status:thesisRunning.has(license)?'RUNNING':'NONE'},
        investigation:snap?{observedAt:new Date(snap.observedAtMs).toISOString(),ageMs:Math.max(0,clock()-snap.observedAtMs),freshness:clock()-snap.observedAtMs<=8000&&clock()-snap.observedAtMs+snap.quote.ageMs<=8000?'RECENT':clock()-snap.observedAtMs<=600000?'HISTORICAL':'STALE',bid:snap.quote.bid,ask:snap.quote.ask,atrM3:snap.patternEngine?.atrM3??null,
          candles:(snap.candles?.m1||[]).slice(-60).map(({time,open,high,low,close})=>({time,open,high,low,close})),
          candidates:(snap.patternEngine?.candidates||[]).map(({family,direction,stage,entry,invalidation,target,extensionAtr,evidence,fvg})=>({family,direction,stage,entry,invalidation,target,extensionAtr,evidence,fvg}))}:null,
        screenedAt:lastScreen.get(license)||null};
    },
    async learningStats(license){return {...await learning.stats(license),lessons:await learning.lessons(license,{limit:12})};},
    async chat(license,input,{onDelta=null}={}) {
      prune();validateChatInput(input);
      if(chatRunning.has(license))throw failure('CHAT_ALREADY_RUNNING');
      chatRunning.add(license);
      try {
        const settings=await vault.settings(license);
        if(!settings.hasKey)throw failure('NO_API_KEY');
        const conv=input.conversationId?await chats.get(license,input.conversationId):null;
        const history=conv?conv.messages.slice(-24).map(({role,text})=>({role,text:text.slice(0,6000)})):(input.history||[]);
        const researchModel=settings.researchModel||settings.model,researchProvider=providerForModel(researchModel);
        if(!settings.availableProviders.includes(researchProvider))throw failure('NO_API_KEY');
        const result=await vault.withKey(license,key=>callAstraChat({key,model:researchModel,effort:settings.researchModel?settings.researchEffort:settings.reasoningEffort,
          input:{message:input.message,image:input.image??null,history},context:snapshots.get(license),fetchImpl,now:clock(),onDelta}),researchProvider);
        const after=await vault.settings(license);
        if(after.revision!==settings.revision||!after.hasKey)throw failure('SETTINGS_CHANGED');
        await countRequest(license,{kind:'chat',tokens:result.usage});
        const saved=await chats.append(license,input.conversationId||null,[{role:'user',text:input.message,image:!!input.image},{role:'assistant',text:result.answer}]);
        return {...result,conversationId:saved.id};
      }finally{chatRunning.delete(license);}
    },
    conversations:chats,
    lab,
    async observeMarket(license,snapshot) {
      prune();
      const context=buildContext(snapshot,{now:clock()});
      const previous=snapshots.get(license);
      if(!previous||context.observedAtMs>=previous.observedAtMs){
        snapshots.delete(license);snapshots.set(license,context);
        while(snapshots.size>256)snapshots.delete(snapshots.keys().next().value);
      }
      return {status:'OBSERVED',observedAt:new Date(context.observedAtMs).toISOString()};
    },
    async submit(license,snapshot) {
      prune();
      const settings=await available(license);
      const context=buildContext(snapshot,{now:clock()});
      snapshots.delete(license);snapshots.set(license,context);
      while(snapshots.size>256)snapshots.delete(snapshots.keys().next().value);
      if(settings.status!=='ASTRA_READY')return {status:settings.status,fallbackReason:settings.status};
      await learning.observe(license,{bid:context.quote.bid,ask:context.quote.ask,atMs:context.observedAtMs});
      await recordEngine(license,context);
      if(context.campaign.positions.length&&context.campaign.owner!=='ASTRA')return {status:'NATIVE_LIFESTYLE',fallbackReason:'CAMPAIGN_OWNED_BY_NATIVE'};
      // Bridge v2 sends every closed bar while flat. The deterministic engine screens
      // them for free; only developing reference setups reach the paid model.
      if(context.bridgeVersion>=2&&!context.campaign.positions.length&&!(context.patternEngine?.candidates||[]).length){
        lastScreen.set(license,new Date(clock()).toISOString());
        return {status:'SCREENED',fallbackReason:null,snapshotId:context.snapshotId};
      }
      maybeResearch(license,context,settings).catch(()=>{});
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
      const thesis=freshThesis(license,context);if(thesis)context.researchThesis=thesis;
      const top=(context.patternEngine?.candidates||[])[0];
      const lessons=await learning.lessons(license,{family:top?.family,direction:top?.direction});
      const loadKnowledge=ctx=>knowledge(ctx,{lessons,depth:settings.contextDepth});
      const deadline=Math.min(timeoutMs,settings.executionTimeoutMs||timeoutMs);
      job.promise=(async()=>{
        try {
          const raw=await vault.withKey(license,key=>callStrategyModel({key,model:settings.model,effort:settings.reasoningEffort,context,fetchImpl,timeoutMs:deadline,signal:job.controller.signal,loadKnowledge}));
          if(raw.__usage)await countRequest(license,{kind:'tokensOnly',tokens:raw.__usage});
          const current=await vault.settings(license);
          if(current.revision!==settings.revision||!current.enabled||job.controller.signal.aborted)return;
          const decision=bindDecision(raw,context,{now:clock(),requestId:id});
          if(clock()>decision.expiresAtMs)throw failure('STALE_DECISION');
          const latencyMs=clock()-job.started;
          job.status='ACTIVE';job.result={...decision,model:settings.model,latencyMs};
          last.set(license,{status:'ASTRA_ACTIVE',decision:{...decision,model:settings.model,latencyMs,usedThesis:!!thesis},latencyMs});
          if(decision.direction!=='NONE'&&['ENTER_BUY','ENTER_SELL','ADD','WAIT'].includes(decision.action)&&decision.setupFamily!=='NONE')
            await learning.predict(license,{source:'AI_DECISION',model:settings.model,family:decision.setupFamily,direction:decision.direction,stage:decision.state,action:decision.action,
              entry:decision.direction==='SELL'?context.quote.bid:context.quote.ask,atr:atrOf(context),reasonCodes:decision.reasonCodes,usedThesis:!!thesis});
          await event(license,'ASTRA_DECISION',{...decision,model:settings.model,latencyMs});
          if(decision.state==='INVALID')await event(license,'ASTRA_INVALID',{decisionId:id,state:decision.state,action:decision.action});
          // Recommendations are not fills; only the EA emits ASTRA_ENTRY/ADD/EXIT.
          await event(license,EVENT_ACTION[decision.action]==='ASTRA_SETUP_WATCH'?'ASTRA_SETUP_WATCH':'ASTRA_RECOMMENDATION',
            {decisionId:id,state:decision.state,action:decision.action,direction:decision.direction});
        }catch(e) {
          if(job.controller.signal.aborted&&job.status==='DISABLED')return;
          const reason=SAFE_REASONS.includes(e.message)?e.message:'AI_ERROR';
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
    // Capability tests. CONNECTION/TEXT/VISION/STRATEGY each incur user API cost.
    // None of them proves trading performance.
    async test(license,contexts,{scope='STRATEGY'}={}) {
      const settings=await available(license);
      if(!settings.hasKey)return {ok:false,status:'NO_API_KEY',scope,results:[]};
      if(scope==='TEXT'||scope==='VISION'){
        const started=clock();
        try{
          const v=scope==='VISION'?visionTestChart():null;
          const schema={type:'object',additionalProperties:false,required:['priorTrend','lastMoveDirection','note'],properties:{priorTrend:{type:'string',enum:['UP','DOWN','SIDEWAYS']},lastMoveDirection:{type:'string',enum:['UP','DOWN','SIDEWAYS']},note:{type:'string'}}};
          const r=await vault.withKey(license,key=>callModel({key,model:settings.model,effort:'low',system:'You read price charts. Answer from what you can actually see.',
            text:scope==='VISION'?'Look at the candlestick chart image. What was the prior trend over most of the chart, and the direction of the final move?':'A price fell steadily for 26 candles, then rose sharply for the last 8 candles. Classify the prior trend and the final move.',
            image:v?.image||null,schema,maxTokens:4000,fetchImpl,signal:AbortSignal.timeout(60000)}));
          const a=JSON.parse(r.text),passed=a.priorTrend==='DOWN'&&a.lastMoveDirection==='UP';
          await countRequest(license,{kind:'test',tokens:r.usage});
          return {ok:passed,status:passed?(scope==='VISION'?'VISION_PASSED':'TEXT_PASSED'):'ANSWER_INCORRECT',scope,model:settings.model,
            results:[{name:scope,passed,answer:a,latencyMs:r.latencyMs,usage:r.usage}]};
        }catch(e){return {ok:false,status:'TEST_FAILED',scope,model:settings.model,results:[{name:scope,passed:false,latencyMs:clock()-started,error:e.safe?e.message:(e instanceof SyntaxError?'SCHEMA_FAILURE':'AI_ERROR')}]};}
      }
      const results=[];
      for(const item of contexts) {
        const started=clock();
        try {
          // Synthetic diagnostics use recorded observation time, not execution wall clock.
          const context=buildContext(item.snapshot,{now:item.snapshot.observedAtMs});
          const raw=await vault.withKey(license,key=>callStrategyModel({key,model:settings.model,effort:settings.reasoningEffort,context,fetchImpl,timeoutMs:60000}));
          await countRequest(license,{kind:'test',tokens:raw.__usage});
          // Also apply executable contract rules; tests do not submit to MT5.
          bindDecision(raw,context,{now:context.observedAtMs,requestId:crypto.randomUUID()});
          const latencyMs=clock()-started;
          const matched=item.expected.includes(raw.action)&&(!item.expectedStates||item.expectedStates.includes(raw.state));
          results.push({name:item.name,passed:scope==='CONNECTION'?true:matched,matchedFixture:matched,action:raw.action,state:raw.state,expected:item.expected,reasonCodes:raw.reasonCodes,latencyMs,
            withinDecisionBudget:latencyMs<=(settings.executionTimeoutMs||timeoutMs)});
        }catch(e){results.push({name:item.name,passed:false,latencyMs:clock()-started,
          error:[...SAFE_REASONS,'INVALID_MARKET_CONTEXT','PROVIDER_MODEL_MISMATCH'].includes(e.message)?e.message:'AI_ERROR'});}
      }
      const ok=results.length>0&&results.every(x=>x.passed);
      return {ok,status:scope==='CONNECTION'?(ok?'CONNECTED':'CONNECTION_FAILED'):(ok?'TEST_PASSED':'TEST_FAILED'),
        model:settings.model,reasoningEffort:settings.reasoningEffort,strategyVersion:KNOWLEDGE_VERSION,scope,
        note:scope==='CONNECTION'?'KEY_MODEL_AND_SCHEMA_REACHABLE_ONLY':'SYNTHETIC_FIXTURES_ONLY_NOT_PERFORMANCE_EVIDENCE',results};
    },
    // In-process test harness waits on actual async lifecycle. Never exposed as HTTP.
    async drain(){await Promise.allSettled([...jobs.values()].map(x=>x.promise));},
    close(){for(const job of jobs.values())job.controller.abort();},
    vault,learning
  };
  return service;
}
