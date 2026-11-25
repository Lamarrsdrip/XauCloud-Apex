import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createLab,validatePrediction,scorePrediction} from '../research/lab.mjs';
const prediction={direction:'BUY',family:'OTHER',stage:'READY',enterNow:true,entryCondition:'Now',invalidationPrice:998,targetPrice:1002,confidence:60,reasoning:'Test'};
test('lab rejects malformed predictions and incorrect levels',()=>{
 assert.throws(()=>validatePrediction({...prediction,confidence:101},{ask:1000,bid:999}));
 assert.throws(()=>validatePrediction({...prediction,invalidationPrice:1001},{ask:1000,bid:999}));
});
test('lab scores both-touch ambiguity as adverse',()=>{
 const s=scorePrediction(prediction,{quote:{ask:1000,bid:999.9,spread:0.1},atr:1,future:[{h:1002,l:998,c:1000}]});
 assert.equal(s.result,'ADVERSE_FIRST');
 assert.equal(scorePrediction({...prediction,enterNow:false},{atr:1}).result,'ABSTAINED');
});
test('blind lab hides future, persists sealed answers and isolates licenses',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'apex-lab-'));
 try{
 const loadBars=(from,to)=>Array.from({length:Math.floor((to-from)/60000)},(_,i)=>({t:from+i*60000,o:2000+i*.01,h:2000+i*.01+.3,l:2000+i*.01-.2,c:2000+i*.01+.1,spread:.1}));
 const lab=createLab(dir,{loadBars});
 const e=await lab.newEpisode('a',{mode:'random'});
 assert.equal(e.prefix.length,180);assert.equal(e.future,undefined);assert.equal(e.archiveCutoff,undefined);
 await assert.rejects(lab.get('b',e.id),/EPISODE_NOT_FOUND/);
 await assert.rejects(lab.reveal('a',e.id),/PREDICT_BEFORE_REVEAL/);
 const p=await lab.predict('a',e.id,{source:'NATIVE'});
 assert.match(p.predictions[0].hash,/^[a-f0-9]{64}$/);assert.equal(p.future,undefined);
 const restored=createLab(dir,{loadBars});
 const result=await restored.reveal('a',e.id);assert.equal(result.future.length,120);
 await assert.rejects(restored.predict('a',e.id,{source:'ENGINE'}),/EPISODE_ALREADY_REVEALED/);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('benchmark gives each selected model exactly the same masked prefix before reveal',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'apex-bench-')),seen=[];
 try{
  const loadBars=(from,to)=>Array.from({length:Math.floor((to-from)/60000)},(_,i)=>({t:from+i*60000,o:2000+i*.01,h:2000+i*.01+.3,l:2000+i*.01-.2,c:2000+i*.01+.1,spread:.1}));
  const lab=createLab(dir,{loadBars,modelPredict:async(license,e)=>{
    assert.equal(e.future,undefined);assert.equal(e.archiveCutoff,undefined);assert.equal(e.prefix.length,180);
    seen.push({model:e.requestedModel,prefix:JSON.stringify(e.prefix)});
    return {model:e.requestedModel,latencyMs:10,prediction:{...prediction,invalidationPrice:e.quote.ask-1,targetPrice:e.quote.ask+1}};
  }});
  const j=await lab.benchmark('a',{n:2,models:['gpt-6.2-astra','claude-opus-5-5']});
  await assert.rejects(lab.getBenchmark('b',j.id),/BENCHMARK_NOT_FOUND/);
  let result;
  for(let i=0;i<200;i++){result=await lab.getBenchmark('a',j.id);if(result.status!=='RUNNING')break;await new Promise(r=>setTimeout(r,10));}
  assert.equal(result.status,'COMPLETED');assert.equal(result.completed,2);assert.equal(seen.length,4);
  assert.equal(seen[0].prefix,seen[1].prefix);assert.equal(seen[2].prefix,seen[3].prefix);
  assert.equal(result.results['MODEL · gpt-6.2-astra'].predictions,2);assert.equal(result.results['MODEL · claude-opus-5-5'].predictions,2);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
