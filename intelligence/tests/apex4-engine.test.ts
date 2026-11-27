import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeBars,brokerFrames,outlookFromCanonicalEvidence,localOutlookResearch,pullbackCandidate,replayPullback,trainKnowledge,selectIndependentPlan,wire} from '../apex4-engine.ts';
import {STRATEGY_EVIDENCE,PROVEN_LOSING_STRATEGIES} from '../xaucloud/aiOpportunityEngine.ts';
import {resolveHourlyBias} from '../xaucloud/marketOutlookSignal.ts';
const now=Date.parse('2026-11-27T08:00:05Z'),q={bid:3650,ask:3650.2,at:new Date(now).toISOString()};
const evidence={canonicalM10:{direction:'SELL',actionable:true,confidence:80},thesis:{buy_pressure:25,sell_pressure:75,structure:'STRUCTURE_SUPPORTS',structural_entry:3650,structural_sl:3658,atr_m5:2},quote:q,observedAt:now,htfComplete:true};
test('vendored bias and exact XauCloud Outlook fixed targets',()=>{
 assert.equal(resolveHourlyBias(evidence.canonicalM10,evidence.thesis).direction_label,'SELL');
 const p=outlookFromCanonicalEvidence(evidence,now);assert.ok(p);assert.equal(p.tp1,3645);assert.equal(p.tp2,3640);assert.equal(p.sl,3658);
 assert.equal(wire(p).split('|').length,10);assert.equal(wire(p).split('|').at(-1),'OUTLOOK');
});
test('no stale, contradictory, blocked or incomplete canonical evidence',()=>{
 assert.equal(outlookFromCanonicalEvidence({...evidence,observedAt:now-5000},now),null);
 assert.equal(outlookFromCanonicalEvidence({...evidence,htfComplete:false},now),null);
 assert.equal(outlookFromCanonicalEvidence({...evidence,brainRecommendation:'WAIT'},now),null);
 assert.equal(outlookFromCanonicalEvidence({...evidence,canonicalM10:{...evidence.canonicalM10,blocker_code:'OWNER_LOCATION_LATE_BLOCK'}},now),null);
 assert.equal(outlookFromCanonicalEvidence({...evidence,thesis:{...evidence.thesis,buy_pressure:80,sell_pressure:20,structure:'STRUCTURE_MIXED'}},now),null);
});
test('missing knowledge never creates an order',()=>{
 assert.equal(selectIndependentPlan([],q,now,null).plan,null);
 assert.equal(wire(null),'NONE|ARMED_NO_PLAN');
 assert.equal(localOutlookResearch([],q,now).plan,null);assert.equal(pullbackCandidate([],q,now),null);
});
test('actual XauCloud research warnings preserved',()=>{
 assert.ok(PROVEN_LOSING_STRATEGIES.includes('COUNTERTREND_CORRECTION'));
 assert.ok(STRATEGY_EVIDENCE.COUNTERTREND_CORRECTION.holdout<0);
});
test('normalization rejects corrupt bars and de-duplicates timestamps',()=>{
 const t=Math.floor(now/60000)*60000-60000,b={t,o:3650,h:3651,l:3649,c:3650};
 assert.equal(normalizeBars([b,b]).length,1);
 assert.throws(()=>normalizeBars([{...b,t:t+1}]));
 assert.throws(()=>normalizeBars([{...b,h:3648}]));
 assert.equal(brokerFrames([b],q,now),null);
});
test('TP2-only replay scores stop first when both levels touched',()=>{
 const at=Math.floor(now/60000)*60000;
 const p={id:'x',kind:'PULLBACK',side:'BUY',entry:3650,sl:3648,tp1:3651,tp2:3652,published:at,expires:at+12000,reason:'test',source:'fixture',group:'A'};
 const bars=Array.from({length:20},(_,i)=>({t:at+i*60000,o:3650,h:3653,l:3647,c:3650}));
 const x=replayPullback(p,bars,.2,.1);assert.ok(x);assert.equal(x.tp2,false);assert.ok(x.r<0);
});
test('no fabricated rules or hours from an empty archive',()=>{
 const d=trainKnowledge([],[],now-100*86400000,now-50*86400000,now);
 assert.deepEqual(d.hours,[]);assert.deepEqual(d.pullbacks,[]);assert.equal(d.diagnostics.caseCount,0);
});
test('pullback train/validation cannot be selected using holdout winners',()=>{
 const a=now-90*86400000,b=now-30*86400000;
 const rows=Array.from({length:40},(_,i)=>({at:b+86400000+i*60000,group:'FUTURE_WINNERS',r:9,tp2:true,maeR:0,minutes:1}));
 const k=trainKnowledge([],rows,a,b,now);
 assert.deepEqual(k.pullbacks,[]);
});
