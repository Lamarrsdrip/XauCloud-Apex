import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createAstraVault} from '../astra/vault.mjs';
import {buildContext} from '../astra/context.mjs';
import {strategyFixtures} from '../astra/fixtures.mjs';
import {DECISION_SCHEMA,KNOWLEDGE_VERSION,validateDecision,bindDecision} from '../astra/contract.mjs';
import {callOpenAI,createAstraService} from '../astra/service.mjs';

const fakeKey='sk-test-ONLY_SYNTHETIC_CREDENTIAL_0123456789';
function decision(action='WAIT') {
  return {strategyVersion:KNOWLEDGE_VERSION,state:action==='ADD'?'ADD_READY':action.startsWith('ENTER')?'ENTRY_READY':'NO_SETUP',action,
    direction:action==='ENTER_BUY'?'BUY':action==='WAIT'?'NONE':'SELL',setupFamily:'UPPER_SWEEP_REJECTION',
    confidence:.8,setupQuality:.8,locationQuality:.8,freshness:.8,extensionRisk:.1,continuationQuality:.8,
    thesisValid:true,invalidationPrice:4396.8,reasonCodes:['FRESH_BEARISH_RESPONSE']};
}
function completed(value) {return new Response(JSON.stringify({status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:JSON.stringify(value)}]}]}),{status:200});}
async function temp(fn) {const dir=await fs.mkdtemp(path.join(os.tmpdir(),'astra-test-'));try{await fn(dir);}finally{await fs.rm(dir,{force:true,recursive:true});}}
function fixture(name='GOOD_SELL',now=Date.now()){return strategyFixtures(now).find(f=>f.name===name).snapshot;}

test('all nine synthetic context fixtures validate without leaking labels into model context',()=>{
  for(const row of strategyFixtures()) {
    const c=buildContext(row.snapshot);assert.ok(c.structure.atr>0);assert.ok(c.higherContext.m3);
    assert.equal(c.expected,undefined);assert.equal(c.name,undefined);assert.ok(c.candles.m1.every(x=>x.upperWick>=0));
  }
});
test('context rejects stale/future/unordered/unfinished bars and untrusted numeric types',()=>{
  for(const mutate of [s=>s.observedAtMs-=9000,s=>s.quote.ageMs=4000,s=>s.quote.bid='4391',
    s=>s.candles.m1.reverse(),s=>s.candles.m1.at(-1).time=Date.now(),s=>s.candles.m1[2].high=0]) {
    const s=fixture();mutate(s);assert.throws(()=>buildContext(s),/INVALID_MARKET_CONTEXT/);
  }
});
test('market features do not change with leverage or account balance',()=>{
  const s=fixture(),original=buildContext(s).structure;
  for(const [balance,leverage,profile]of [[50,200,'NORMAL'],[50,500,'NORMAL'],[50,2000000000,'UNLIMITED'],[100,500,'NORMAL'],[1000,200,'NORMAL']]){
    s.account={...s.account,balance,equity:balance,freeMargin:balance,leverage,profile};
    assert.deepEqual(buildContext(s).structure,original);
  }
});
test('decision rejects unknown fields, missing fields, NaN, wrong enums and command inconsistency',()=>{
  for(const bad of [{...decision(),rawKey:fakeKey},{...decision(),confidence:NaN},{...decision(),action:'SELL'},
    {...decision('ENTER_SELL'),state:'WATCHING'},{...decision('ENTER_SELL'),direction:'BUY'}])assert.throws(()=>validateDecision(bad));
  const missing=decision();delete missing.reasonCodes;assert.throws(()=>validateDecision(missing));
  assert.equal(DECISION_SCHEMA.additionalProperties,false);
});
test('bind snapshots server identities and enforces owner, direction, invalidation and no rescue',()=>{
  const c=buildContext(fixture()),bound=bindDecision(decision('ENTER_SELL'),c);
  assert.equal(bound.snapshotId,c.snapshotId);assert.equal(bound.expectedLayers,0);assert.ok(bound.expiresAtMs<=c.observedAtMs+8000);
  const active=buildContext(fixture('EARLY_WINNER_ADD'));
  assert.equal(bindDecision(decision('ADD'),active).expectedLayers,1);
  active.campaign.basketProfit=-.01;assert.throws(()=>bindDecision(decision('ADD'),active),/NO_WINNER_PROOF/);
  active.campaign.basketProfit=1;active.campaign.owner='LIFESTYLE_NATIVE';assert.throws(()=>bindDecision(decision('ADD'),active),/NATIVE_CAMPAIGN/);
  active.campaign.owner='ASTRA';active.campaign.direction='BUY';assert.throws(()=>bindDecision(decision('ADD'),active),/DIRECTION_CONFLICT/);
  assert.throws(()=>bindDecision({...decision('ENTER_SELL'),invalidationPrice:4390},c),/WRONG_SIDE/);
});
test('newest leg can be red in a green reference campaign; no arbitrary monotonic-fill gate',()=>{
  const s=fixture('EARLY_WINNER_ADD');s.campaign.lastAddPrice=4391.2;s.campaign.layers=2;
  s.campaign.positions.push({ticket:'2',price:4391.2,volume:.01});s.campaign.basketProfit=.25;
  const c=buildContext(s);assert.ok(c.structure.favorableSinceLastAdd<0);
  assert.equal(bindDecision(decision('ADD'),c).action,'ADD');
});
test('trigger identity does not change merely because another order fills or request uuid changes',()=>{
  const c=buildContext(fixture('EARLY_WINNER_ADD')),a=bindDecision(decision('ADD'),c);
  c.campaign.layers++;c.campaign.positions.push({ticket:'2',price:4391.4,volume:.01});
  const b=bindDecision(decision('ADD'),c);assert.equal(a.triggerId,b.triggerId);assert.notEqual(a.decisionId,b.decisionId);
});
test('vault encrypts per-user keys, masks responses, keeps file private, supports restart and removal',()=>temp(async dir=>{
  const vault=createAstraVault(dir),saved=await vault.update('user-a',{apiKey:fakeKey,enabled:true,model:'gpt-6-astra'});
  assert.equal(saved.hasKey,true);assert.ok(saved.maskedKey.endsWith('6789'));assert.ok(!JSON.stringify(saved).includes(fakeKey));
  const raw=await fs.readFile(path.join(dir,'astra-vault.json'),'utf8');assert.ok(!raw.includes(fakeKey));assert.ok(!raw.includes('user-a'));
  assert.equal((await fs.stat(path.join(dir,'astra-master.key'))).mode&0o777,0o600);
  await vault.update('user-b',{apiKey:fakeKey.replace('6789','7890')});
  assert.equal(await createAstraVault(dir).withKey('user-a',async key=>key===fakeKey),true);
  assert.equal((await vault.settings('user-b')).maskedKey.endsWith('7890'),true);
  await vault.remove('user-a');assert.equal((await vault.settings('user-a')).hasKey,false);
  await assert.rejects(vault.withKey('user-a',async()=>{}),/NO_API_KEY/);
}));
test('missing encryption master never silently regenerates and destroys other user ciphertext',()=>temp(async dir=>{
  const vault=createAstraVault(dir);await vault.update('a',{apiKey:fakeKey});await fs.rm(path.join(dir,'astra-master.key'));
  await assert.rejects(vault.update('b',{apiKey:fakeKey}),/ENCRYPTION_UNAVAILABLE/);
  await assert.rejects(fs.access(path.join(dir,'astra-master.key')));
}));
test('ciphertext cannot be swapped between licenses (GCM associated data)',()=>temp(async dir=>{
  const vault=createAstraVault(dir);await vault.update('a',{apiKey:fakeKey});await vault.update('b',{apiKey:fakeKey});
  const file=path.join(dir,'astra-vault.json'),rows=JSON.parse(await fs.readFile(file));
  const keys=Object.keys(rows);rows[keys[0]]=rows[keys[1]];await fs.writeFile(file,JSON.stringify(rows));
  await assert.rejects(vault.withKey('a',async()=>{}),/ENCRYPTION_UNAVAILABLE/);
}));
test('OpenAI request uses fixed HTTPS Responses endpoint and strict schema, never stores provider response',async()=>{
  let request;
  await callOpenAI({key:fakeKey,model:'gpt-6-astra',context:buildContext(fixture()),fetchImpl:async(url,opt)=>{request={url,opt};return completed(decision());}});
  assert.equal(request.url,'https://api.openai.com/v1/responses');assert.equal(request.opt.headers.authorization,'Bearer '+fakeKey);
  const b=JSON.parse(request.opt.body);assert.equal(b.store,false);assert.equal(b.text.format.strict,true);assert.deepEqual(b.text.format.schema,DECISION_SCHEMA);
  assert.ok(!b.input.includes(fakeKey));assert.ok(b.instructions.includes('confirmed'));
});
test('401, credit, rate limit, refusal, truncation and invalid JSON become explicit safe failure codes',async()=>{
  const cases=[
    [new Response('secret provider body '+fakeKey,{status:401}),'AUTH_ERROR'],
    [new Response(JSON.stringify({error:{code:'insufficient_quota',message:fakeKey}}),{status:429}),'NO_CREDIT'],
    [new Response('{}',{status:429}),'RATE_LIMITED'],
    [new Response(JSON.stringify({status:'completed',output:[{type:'message',role:'assistant',content:[{type:'refusal',refusal:fakeKey}]}]})),'AI_REFUSAL'],
    [new Response(JSON.stringify({status:'incomplete'})),'AI_INCOMPLETE'],
    [completed({...decision(),extra:fakeKey}),'SCHEMA_FAILURE']
  ];
  for(const [response,expected]of cases)await assert.rejects(callOpenAI({key:fakeKey,model:'gpt-6-astra',context:buildContext(fixture()),fetchImpl:async()=>response}),new RegExp(expected));
});
test('provider timeout is aborted and bounded',async()=>{
  await assert.rejects(callOpenAI({key:fakeKey,model:'gpt-6-astra',context:buildContext(fixture()),timeoutMs:20,
    fetchImpl:async(url,{signal})=>new Promise((resolve,reject)=>{const stop=()=>reject(new DOMException('aborted','AbortError'));if(signal.aborted)stop();else signal.addEventListener('abort',stop);})}),/AI_TIMEOUT/);
  // Deadline expiring during knowledge load must not start a provider request.
  let called=false;
  await assert.rejects(callOpenAI({key:fakeKey,model:'gpt-6-astra',context:buildContext(fixture()),timeoutMs:5,
    loadKnowledge:async()=>{await new Promise(r=>setTimeout(r,30));return {instructions:'',examples:[]};},fetchImpl:async()=>{called=true;}}),/AI_TIMEOUT/);
  assert.equal(called,false);
});
test('async service returns pending immediately, binds completion, isolates license and expires old authority',()=>temp(async dir=>{
  let now=Date.now();const events=[];
  const service=createAstraService({dataDir:dir,clock:()=>now,emit:async e=>events.push(e),fetchImpl:async()=>completed(decision('ENTER_SELL'))});
  assert.equal((await service.submit('a',{})).status,'DISABLED');
  await service.configure('a',{enabled:true});assert.equal((await service.submit('a',{})).status,'NO_API_KEY');
  await service.configure('a',{apiKey:fakeKey});
  const p=await service.submit('a',fixture('GOOD_SELL',now));assert.equal(p.status,'PENDING');
  assert.equal((await service.decision('b',p.requestId)).fallbackReason,'UNKNOWN_REQUEST');
  await service.drain();assert.equal((await service.decision('a',p.requestId)).action,'ENTER_SELL');
  assert.ok(!JSON.stringify(events).includes(fakeKey));assert.ok(!events.some(x=>x.type==='ASTRA_ENTRY'));
  now+=9000;assert.equal((await service.decision('a',p.requestId)).fallbackReason,'STALE_DECISION');service.close();
}));
test('disabling/removing key during in-flight inference revokes result and never publishes it',()=>temp(async dir=>{
  let resolve;const events=[];
  const service=createAstraService({dataDir:dir,emit:async e=>events.push(e),fetchImpl:async()=>new Promise(r=>resolve=r)});
  await service.configure('a',{enabled:true,apiKey:fakeKey});const p=await service.submit('a',fixture());
  while(!resolve)await new Promise(r=>setTimeout(r,1));
  await service.remove('a');resolve(completed(decision('ENTER_SELL')));await service.drain();
  assert.equal((await service.decision('a',p.requestId)).status,'DISABLED');assert.ok(!events.some(e=>e.type==='ASTRA_DECISION'));service.close();
}));
test('native-owned campaigns cannot call the model or get taken over',()=>temp(async dir=>{
  let calls=0;const service=createAstraService({dataDir:dir,fetchImpl:async()=>{calls++;return completed(decision('ADD'));}});
  await service.configure('a',{apiKey:fakeKey,enabled:true});const s=fixture('EARLY_WINNER_ADD');s.campaign.owner='LIFESTYLE_NATIVE';
  assert.equal((await service.submit('a',s)).status,'NATIVE_LIFESTYLE');assert.equal(calls,0);service.close();
}));
test('valid strategy test exercises model schema plus execution contract but never creates a trading job',()=>temp(async dir=>{
  const events=[];const service=createAstraService({dataDir:dir,emit:async e=>events.push(e),fetchImpl:async()=>completed(decision())});
  await service.configure('a',{apiKey:fakeKey});
  const result=await service.test('a',[strategyFixtures().find(x=>x.name==='TOO_EARLY')]);
  assert.equal(result.ok,true);assert.equal(result.scope,'STRATEGY');assert.equal(events.length,0);service.close();
}));

test('provider request carries configured reasoning effort; connection test is not graded as strategy',()=>temp(async dir=>{
  const {createAstraService}=await import('../astra/service.mjs');
  const {strategyFixtures}=await import('../astra/fixtures.mjs');
  const bodies=[];
  const reply={action:'ENTER_SELL',state:'ENTRY_READY',direction:'SELL'};
  const fetchImpl=async(url,init)=>{bodies.push(JSON.parse(init.body));
    const d={strategyVersion:'tradingcartel-breakfast-v1',state:reply.state,action:reply.action,direction:reply.direction,setupFamily:'UPPER_SWEEP_REJECTION',
      confidence:.8,setupQuality:.8,locationQuality:.8,freshness:.8,extensionRisk:.2,continuationQuality:.7,thesisValid:true,invalidationPrice:4400,reasonCodes:['TEST']};
    return {ok:true,status:200,json:async()=>({status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:JSON.stringify(d)}]}]})};};
  const svc=createAstraService({dataDir:dir,fetchImpl});
  await svc.configure('L',{apiKey:'sk-test-SYNTHETIC_ONLY_KEY_0000',enabled:true,reasoningEffort:'medium'});
  const fx=strategyFixtures();
  const conn=await svc.test('L',[fx.find(x=>x.name==='TOO_EARLY')],{scope:'CONNECTION'});
  assert.equal(conn.status,'CONNECTED');assert.equal(conn.results[0].matchedFixture,false);
  assert.equal(bodies[0].reasoning.effort,'medium');assert.equal(bodies[0].store,false);
  const strat=await svc.test('L',[fx.find(x=>x.name==='TOO_EARLY')],{scope:'STRATEGY'});
  assert.equal(strat.status,'TEST_FAILED');
  await svc.configure('L',{reasoningEffort:'default'});
  await svc.test('L',[fx.find(x=>x.name==='TOO_EARLY')],{scope:'CONNECTION'});
  assert.equal(bodies.at(-1).reasoning,undefined);
  await assert.rejects(svc.configure('L',{reasoningEffort:'turbo'}));
  svc.close();
}));

test('daily request budget is enforced, persisted across restart, and never blocks an already-paid decision',()=>temp(async dir=>{
  const {createAstraService}=await import('../astra/service.mjs');
  const {strategyFixtures}=await import('../astra/fixtures.mjs');
  let calls=0;const fetchImpl=async()=>{calls++;return completed(decision());};
  let now=Date.now();const clock=()=>now;
  const svc=createAstraService({dataDir:dir,fetchImpl,clock});
  await svc.configure('L',{apiKey:fakeKey,enabled:true,dailyRequestLimit:10});
  const snap=i=>{const s=strategyFixtures(now).find(x=>x.name==='TOO_EARLY').snapshot;s.snapshotId='budget-'+i;return s;};
  let last;
  for(let i=0;i<10;i++){now+=2500;last=await svc.submit('L',snap(i));await svc.drain();}
  assert.equal(calls,10);
  assert.equal((await svc.decision('L',last.requestId)).status,'ACTIVE');
  now+=2500;assert.equal((await svc.submit('L',snap(99))).status,'DAILY_BUDGET_REACHED');assert.equal(calls,10);
  assert.equal((await svc.status('L')).status,'DAILY_BUDGET_REACHED');
  svc.close();
  const again=createAstraService({dataDir:dir,fetchImpl,clock});
  assert.equal((await again.status('L')).requestsToday,10);
  now+=86400000;assert.equal((await again.status('L')).status,'ASTRA_READY');
  await assert.rejects(again.configure('L',{dailyRequestLimit:999999}));
  again.close();
}));
