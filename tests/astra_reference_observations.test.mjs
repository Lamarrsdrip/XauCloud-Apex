import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {selectReferenceObservations} from '../astra/reference-observations.mjs';
import {knowledge} from '../astra/retrieval.mjs';
const rows=(await fs.readFile(new URL('../data/astra/reference-observations-2026-11-25.jsonl',import.meta.url),'utf8')).trim().split('\n').map(JSON.parse);
test('six distinct reference videos have provenance and no performance or execution labels',()=>{
 assert.equal(rows.length,6);assert.equal(new Set(rows.map(r=>r.sha256)).size,6);
 for(const r of rows){assert.match(r.sha256,/^[a-f0-9]{64}$/);assert.equal(r.labelOrigin,'OBSERVATION_NOT_TRADE_LABEL');assert.equal(r.desiredDecision,undefined);assert.ok(r.unknown);assert.ok(r.prefix[0]<r.prefix[1]);}
});
test('flat market retrieval includes both directions rather than equating impulse with reversal',()=>{
 const result=selectReferenceObservations(rows,{structure:{upperFailedAcceptance:true,bosSell:true},campaign:{positions:[]}});
 assert.deepEqual(new Set(result.map(r=>r.direction)),new Set(['BUY','SELL']));
 assert.equal(result.find(r=>r.direction==='SELL').id,'nov25-sell-spike');
 assert.ok(result.every(r=>r.desiredDecision===undefined));
});
test('active sell campaign retrieval stays same-side; integrated knowledge includes new observations',async()=>{
 const c={structure:{failedBullishRecovery:true,approach:{impulseAtr:-2}},campaign:{direction:'SELL',positions:[{}]}};
 assert.ok(selectReferenceObservations(rows,c).every(r=>r.direction==='SELL'));
 const pack=await knowledge(c);assert.ok(pack.examples.some(r=>r.sourceFile==='reference-observations-2026-11-25.jsonl'));
});
