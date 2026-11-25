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
