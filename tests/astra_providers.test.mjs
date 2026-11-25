import test from 'node:test';
import assert from 'node:assert/strict';
import {buildContext} from '../astra/context.mjs';
import {strategyFixtures} from '../astra/fixtures.mjs';
import {providerForKey,assertProviderModel,anthropicText,callAnthropicDecision} from '../astra/providers.mjs';
import {DECISION_SCHEMA,KNOWLEDGE_VERSION} from '../astra/contract.mjs';
const now=Date.now(),c=buildContext(strategyFixtures(now)[0].snapshot,{now});
test('reference research measures both sides using only observed prefix',()=>{
 const p=c.referencePattern;assert.equal(p.kind,'OBSERVED_PREFIX_MEASUREMENTS_NOT_ENTRY_AUTHORITY');assert.deepEqual(p.alternatives.map(x=>x.direction),['BUY','SELL']);assert.ok(p.closedBarSequence.every(x=>x.at+60000<=now));assert.ok(p.alternatives.every(x=>Number.isFinite(x.displacementFromExtremeAtr)));assert.equal(p.action,undefined);
});
test('provider mismatch cannot transmit credential',()=>{assert.equal(providerForKey('sk-ant-sample'),'anthropic');assert.throws(()=>assertProviderModel('anthropic','gpt-example'),/PROVIDER_MODEL_MISMATCH/);assert.throws(()=>assertProviderModel('openai','claude-example'),/PROVIDER_MODEL_MISMATCH/);});
test('Anthropic chart path uses fixed API endpoint and typed image, no order envelope',async()=>{
 let body;
 const answer=await anthropicText({key:'sk-ant-test',model:'claude-opus-5-5',effort:'high',system:'research',text:'chart',image:'data:image/png;base64,AAAA',fetchImpl:async(url,opt)=>{assert.equal(url,'https://api.anthropic.com/v1/messages');body=JSON.parse(opt.body);return new Response(JSON.stringify({stop_reason:'end_turn',content:[{type:'text',text:'Research response'}]}));}});
 assert.equal(answer,'Research response');assert.equal(body.output_config.effort,'high');assert.equal(body.messages[0].content[1].source.media_type,'image/png');
});
test('Anthropic decisions still require original semantic contract',async()=>{
 const raw={strategyVersion:KNOWLEDGE_VERSION,state:'NO_SETUP',action:'WAIT',direction:'NONE',setupFamily:'NONE',confidence:.5,setupQuality:.5,locationQuality:.5,freshness:.5,extensionRisk:.5,continuationQuality:.5,thesisValid:false,invalidationPrice:0,reasonCodes:['TEST']};
 const run=async value=>callAnthropicDecision({key:'sk-ant-test',model:'claude-opus-5-5',context:c,loadKnowledge:async()=>({instructions:'strategy',examples:[]}),fetchImpl:async(url,opt)=>{const body=JSON.parse(opt.body);assert.equal(body.output_config.format.type,'json_schema');assert.deepEqual(body.output_config.format.schema.required,DECISION_SCHEMA.required);return new Response(JSON.stringify({stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify(value)}]}));}});
 assert.equal((await run(raw)).action,'WAIT');await assert.rejects(run({...raw,confidence:1.5}),/SCHEMA_FAILURE/);
});
