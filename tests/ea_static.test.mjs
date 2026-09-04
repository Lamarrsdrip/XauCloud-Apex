import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const s=await fs.readFile(new URL('../ea/XauCloud-Apex.mq5',import.meta.url),'utf8');
test('EA uses site origin and new heartbeat',()=>{
 assert.match(s,/InpCloudURL="https:\/\/apex\.xaucloud\.io"/);
 assert.match(s,/\/api\/apex\/heartbeat/);
 assert.doesNotMatch(s,/api\.apex\.xaucloud\.io/);
 assert.doesNotMatch(s,/InpEaToken/);
});
test('cloud failure explicitly preserves local trading state',()=>{
 assert.match(s,/communication failure does not alter C\.armed or trading state/);
 assert.match(s,/MONITOR\/CONTROL ONLY; trading uses last validated local config/);
});
test('tester stays independent',()=>assert.match(s,/if\(IsTester\(\)\)\{C\.armed=true;return true;\}/));
test('active campaign management occurs before armed gate',()=>{
 const iManage=s.indexOf('Manage();return;}if(!C.armed)return;');
 assert.ok(iManage>0);
});
