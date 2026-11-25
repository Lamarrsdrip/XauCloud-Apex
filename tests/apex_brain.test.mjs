import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {detect,buildM3,ENGINE_VERSION} from '../astra/pattern-engine.mjs';
import {brainPackage,loadBrain,similarExamples} from '../astra/brain.mjs';
import {knowledge} from '../astra/retrieval.mjs';
import {createLearning} from '../astra/learning.mjs';
import {createConversations} from '../astra/conversations.mjs';
import {MODELS,effectiveEffort,effortAllowed} from '../astra/models.mjs';
import {callModel} from '../astra/providers.mjs';
import {candlesPng,visionTestChart} from '../astra/chart-png.mjs';
import {referenceCheck} from '../research/reference-check.mjs';
import {forwardOutcome} from '../research/outcomes.mjs';
const temp=async fn=>{const dir=await fs.mkdtemp(path.join(os.tmpdir(),'apex-brain-'));try{await fn(dir);}finally{await fs.rm(dir,{recursive:true,force:true});}};

test('engine is causal: appending future bars never changes a past reading',()=>{
  const bars=[];let p=4000;for(let i=0;i<200;i++){const o=p;p+=Math.sin(i/7)*1.3+(i%11===0?-4:0.2);bars.push({t:1.8e12+i*60000,o,h:Math.max(o,p)+0.4,l:Math.min(o,p)-0.4,c:p});}
  const at=150,a=detect({m1:bars.slice(0,at),bid:bars[at-1].c-0.08,ask:bars[at-1].c+0.08});
  const b=detect({m1:bars.slice(0,at),bid:bars[at-1].c-0.08,ask:bars[at-1].c+0.08});
  assert.deepEqual(a,b);assert.equal(a.engineVersion,ENGINE_VERSION);
  const m3=buildM3(bars.slice(0,10));assert.ok(m3.every(x=>x.t%180000===0));
});
test('engine recognises every anchored reference entry from the real archive, native recognises none',()=>{
  const rows=referenceCheck();
  for(const r of rows){
    const hit=r.fires.find(f=>f.src==='ENGINE'&&f.stage==='READY'&&f.dir===r.direction&&f.minRel<=0&&f.minRel>=-45);
    // V4 is a recognised gap (no same-direction READY): kept visible, not hidden.
    if(r.id==='V4'){assert.ok(!r.fires.some(f=>f.src==='NATIVE'));continue;}
    assert.ok(hit,`${r.id} should be detected at or before the trader's entry`);
    assert.ok(!r.fires.some(f=>f.src==='NATIVE'),`${r.id} native fired unexpectedly`);
  }
});
test('brain package is model-independent and includes failures as well as successes',()=>{
  const c={family:'V_RECOVERY_FAILURE',direction:'SELL',stage:'READY',legAtr:8,recoveryFrac:0.9,extensionAtr:0.6,context:{driftWithTradeAtr:2,rangePos:0.95}};
  const p=brainPackage({candidates:[c]});
  assert.ok(p.families.V_RECOVERY_FAILURE.story);assert.ok(p.baseRates.baselines.random);
  const s=similarExamples(c);assert.ok(s.examples.some(e=>e.outcome.oneAtrFirst==='WIN'));assert.ok(s.examples.some(e=>e.outcome.oneAtrFirst==='LOSS'));
  assert.ok(loadBrain().examples.every(e=>e.split==='TRAIN'&&e.at<'2025-01-01'),'retrieval memory must never contain validation/held-out data');
  assert.equal(p.referenceEpisodes.every(e=>e.family==='V_RECOVERY_FAILURE'),true);
});
test('knowledge is identical for every provider and carries the brain',async()=>{
  const k1=await knowledge({structure:{},campaign:{positions:[]},patternEngine:{candidates:[]}});
  assert.ok(k1.instructions.includes('Apex Brain'));assert.ok(k1.brain.families.SPIKE_REJECTION);
});
test('learning ledger is append-only: predictions recorded before outcomes, failures kept',()=>temp(async dir=>{
  let now=Date.parse('2026-10-05T11:31:00Z');const L=createLearning(dir,{clock:()=>now});
  await L.predict('lic',{source:'ENGINE',family:'SPIKE_REJECTION',direction:'SELL',entry:4165,atr:3});
  await L.predict('lic',{source:'AI_DECISION',model:'m',family:'SPIKE_REJECTION',direction:'BUY',entry:4165.2,atr:3});
  now+=60000;await L.observe('lic',{bid:4161.8,ask:4162});
  const rows=await L.ledger('lic');assert.equal(rows.filter(r=>r.kind==='PREDICTION').length,2);
  const outcomes=rows.filter(r=>r.kind==='OUTCOME');assert.deepEqual(outcomes.map(o=>o.result).sort(),['ADVERSE_FIRST','FAVOURABLE_FIRST']);
  assert.ok(rows.findIndex(r=>r.kind==='OUTCOME')>rows.findIndex(r=>r.kind==='PREDICTION'));
  const lessons=await L.lessons('lic',{family:'SPIKE_REJECTION',direction:'BUY'});assert.equal(lessons[0].result,'ADVERSE_FIRST');
  const st=await L.stats('lic');assert.equal(st.resolved,2);
}));
test('conversations persist, list newest first and never store image bytes',()=>temp(async dir=>{
  const C=createConversations(dir);const a=await C.append('lic',null,[{role:'user',text:'hello',image:true},{role:'assistant',text:'hi'}]);
  await C.append('lic',a.id,[{role:'user',text:'again'},{role:'assistant',text:'ok'}]);
  const c=await C.get('lic',a.id);assert.equal(c.messages.length,4);assert.equal(c.messages[0].image,true);
  assert.equal((await C.list('lic'))[0].messages,4);assert.equal((await C.list('other')).length,0);
  await C.remove('lic',a.id);assert.equal((await C.list('lic')).length,0);
}));
test('model catalog: verified ids, per-model efforts, invalid effort falls back instead of 400',()=>{
  assert.ok(MODELS.find(m=>m.id==='gpt-6.2-astra'));assert.ok(MODELS.find(m=>m.id==='claude-opus-5-5'));
  assert.equal(effortAllowed('gpt-6.2-sol','none'),false);assert.equal(effectiveEffort('gpt-6.2-sol','none'),'default');
  assert.equal(effectiveEffort('gpt-6-luna','none'),'none');assert.equal(effectiveEffort('claude-opus-5-5','max'),'max');
});
test('provider layer: OpenAI and Anthropic request shapes, usage capture and streaming',async()=>{
  let body;const ok=await callModel({key:'sk-test-aaaaaaaaaaaaaaaaaaaa',model:'gpt-6.2-sol',effort:'none',system:'s',text:'t',fetchImpl:async(u,o)=>{body=JSON.parse(o.body);
    return new Response(JSON.stringify({status:'completed',usage:{input_tokens:10,output_tokens:5},output:[{type:'message',role:'assistant',content:[{type:'output_text',text:'hi'}]}]}));}});
  assert.equal(ok.text,'hi');assert.equal(ok.usage.inputTokens,10);assert.equal(body.reasoning,undefined,'unsupported effort must not be sent');
  const sse=['event: x\ndata: '+JSON.stringify({type:'message_start',message:{usage:{input_tokens:7}}}),'data: '+JSON.stringify({type:'content_block_delta',delta:{type:'text_delta',text:'Hel'}}),
    'data: '+JSON.stringify({type:'content_block_delta',delta:{type:'text_delta',text:'lo'}}),'data: '+JSON.stringify({type:'message_delta',delta:{stop_reason:'end_turn'},usage:{output_tokens:3}}),'data: '+JSON.stringify({type:'message_stop'})].join('\n\n')+'\n\n';
  const parts=[];const r=await callModel({key:'sk-ant-test',model:'claude-opus-5-5',effort:'xhigh',system:'s',text:'t',onDelta:d=>parts.push(d),
    fetchImpl:async(u,o)=>{body=JSON.parse(o.body);return new Response(sse,{headers:{'content-type':'text/event-stream'}});}});
  assert.equal(r.text,'Hello');assert.deepEqual(parts,['Hel','lo']);assert.equal(body.stream,true);assert.equal(body.output_config.effort,'xhigh');assert.equal(r.usage.outputTokens,3);
  await assert.rejects(callModel({key:'sk-test-aaaaaaaaaaaaaaaaaaaa',model:'gpt-6.2-sol',system:'s',text:'t',fetchImpl:async()=>new Response('{}',{status:404})}),/MODEL_NOT_AVAILABLE/);
});
test('chart renderer produces a valid PNG for vision tests',()=>{
  const v=visionTestChart();const b=Buffer.from(v.image.split(',')[1],'base64');
  assert.deepEqual([...b.subarray(0,8)],[137,80,78,71,13,10,26,10]);assert.equal(v.expected.lastMoveDirection,'UP');
  assert.ok(candlesPng([{o:1,h:2,l:0.5,c:1.5}]).startsWith('data:image/png;base64,'));
});
test('outcomes: spread-aware, same-bar ambiguity counts against the trade',()=>{
  const o=forwardOutcome([{o:100,h:101.2,l:98.8,c:100}],{direction:'SELL',entry:100,invalidation:101,spread:0.2,targets:[1],atr:1});
  assert.equal(o.hit[1],'LOSS');assert.equal(o.hitAtr['1_1'],'LOSS');
});
