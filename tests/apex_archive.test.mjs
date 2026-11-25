import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {ARCHIVE_DIR,coverage} from '../research/archive.mjs';
import {referenceCheck} from '../research/reference-check.mjs';
test('real historical archive matches 60-file SHA-256 manifest',()=>{
 const m=coverage();assert.equal(m.months,60);assert.equal(m.files.length,60);
 assert.equal(m.files.reduce((a,f)=>a+f.rows,0),1765848);
 for(const f of m.files){const data=fs.readFileSync(path.join(ARCHIVE_DIR,f.file));assert.equal(crypto.createHash('sha256').update(data).digest('hex'),f.sha256,f.file);}
});
test('anchored reference replay runs against actual archive; missed setups remain visible',()=>{
 const result=referenceCheck();
 assert.equal(result.length,4);
 for(const id of ['V1','V7','V9'])assert.ok(result.find(e=>e.id===id).fires.some(f=>f.src==='ENGINE'&&f.stage==='READY'&&f.dir==='SELL'&&f.minRel<0),id);
 assert.ok(!result.find(e=>e.id==='V4').fires.some(f=>f.src==='ENGINE'&&f.stage==='READY'&&f.dir==='SELL'&&f.minRel<=0));
 assert.ok(result.every(e=>!e.fires.some(f=>f.src==='NATIVE')));
});
