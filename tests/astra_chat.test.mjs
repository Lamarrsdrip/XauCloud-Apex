import test from 'node:test';
import assert from 'node:assert/strict';
import {callAstraChat,validateChatInput,researchSnapshot} from '../astra/chat.mjs';
import {buildContext} from '../astra/context.mjs';
import {strategyFixtures} from '../astra/fixtures.mjs';
const now=Date.now(),context=buildContext(strategyFixtures(now)[0].snapshot,{now});
test('research snapshots never call stale market data live or expose account tickets',()=>{
 assert.equal(researchSnapshot(context,now).status,'RECENT_SNAPSHOT');
 assert.equal(researchSnapshot(context,now+15000).status,'HISTORICAL_SNAPSHOT');
 assert.equal(researchSnapshot(context,now+700000).market,null);
 assert.equal(researchSnapshot(context,now).market.account,undefined);
});
test('chat accepts only bounded messages and PNG/JPEG data, not arbitrary URLs or execution actions',()=>{
 assert.throws(()=>validateChatInput({message:'hello',action:'ENTER_BUY'}),/INVALID_CHAT_INPUT/);
 assert.throws(()=>validateChatInput({message:'hello',image:'https://evil.example/chart.png'}),/INVALID_CHAT_IMAGE/);
 assert.throws(()=>validateChatInput({message:'hello',image:'data:image/png;base64,AAAA'}),/INVALID_CHAT_IMAGE/);
});
test('read-only chat uses the reference pack and never returns an executable order envelope',async()=>{
 let request;
 const result=await callAstraChat({key:'test-key',model:'test-model',context,now,input:{message:'Identify this setup'},
 fetchImpl:async(url,opt)=>{request={url,body:JSON.parse(opt.body)};return new Response(JSON.stringify({status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:'Review upper rejection.'}]}]}));}});
 assert.equal(request.url,'https://api.openai.com/v1/responses');
 assert.equal(request.body.store,false);
 assert.match(request.body.instructions,/RESEARCH CHAT/);
 const payload=JSON.parse(request.body.input[0].content[0].text);
 assert.ok(payload.referenceExamples.some(r=>r.sourceFile==='reference-observations-2026-11-25.jsonl'));
 assert.equal(result.answer,'Review upper rejection.');
 assert.equal(result.decisionId,undefined);assert.equal(result.action,undefined);
});
