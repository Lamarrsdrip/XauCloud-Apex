import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const s=await fs.readFile(new URL('../ea/XauCloud-Apex.mq5',import.meta.url),'utf8');
test('EA uses canonical XauCloud routes with one normalized license value',()=>{
 assert.match(s,/InpCloudURL="https:\/\/xaucloud\.io"/);
 assert.match(s,/\/api\/cloud\/monitor\/heartbeat/);
 assert.match(s,/\/api\/cloud\/apex\/config\?license_key=/);
 assert.match(s,/\/api\/cloud\/apex\/event/);
 assert.match(s,/StringToUpper\(s\);StringReplace\(s," ",""\)/);
 assert.doesNotMatch(s,/https:\/\/apex\.xaucloud\.io/);
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

// ---------- Basket Take Profit + Profit Ratchet: prove the EA actually consumes the
// remote/dashboard config values (C.*), not the locally-compiled EA Inputs (InpXxx).
// A pure-JS mirror of the formula (tests/ratchet.test.mjs) can prove the MATH is right
// while the real .mq5 silently reads a different variable -- these tests read the actual
// source text to prove the wiring itself, which the math-only mirror cannot.
const configFields=['normalTargetProfitPct','profitRatchetEnabled','ratchetTriggerPct','ratchetLockPct','ratchetStepPct','ratchetLockStepPct'];

test('Config struct carries all six basket profit-exit fields',()=>{
 const structDecl=s.match(/struct Config\{[^}]*\};/)[0];
 for(const f of configFields)assert.ok(structDecl.includes(f),`Config struct missing ${f}`);
});

test('ApplyRemoteConfig() parses all six fields from the backend JSON response into C.*',()=>{
 const body=s.slice(s.indexOf('void ApplyRemoteConfig'),s.indexOf('bool CloudSync()'));
 for(const f of configFields){
   const re=new RegExp(`C\\.${f}=j[bd]\\(r,"${f}",C\\.${f}\\)`);
   assert.match(body,re,`ApplyRemoteConfig does not parse ${f} into C.${f}`);
 }
});

test('Start() computes the hard basket TP target from C.normalTargetProfitPct, not the local Input',()=>{
 const body=s.slice(s.indexOf('void Start(Snap'),s.indexOf('void Finish('));
 assert.match(body,/C\.normalTargetProfitPct>0\?cycleStart\*\(1\.0\+C\.normalTargetProfitPct\/100\.0\)/);
 assert.doesNotMatch(body,/InpNormalTakeProfitPct/);
});

test('Manage() ratchet block reads C.profitRatchetEnabled / C.ratchet* exclusively, never the Inputs',()=>{
 const body=s.slice(s.indexOf('Default Apex percentage profit ratchet'),s.indexOf('if(targetEq>0&&campEq>=targetEq)'));
 assert.match(body,/C\.profitRatchetEnabled/);
 assert.match(body,/C\.ratchetTriggerPct/);
 assert.match(body,/C\.ratchetLockPct/);
 assert.match(body,/C\.ratchetStepPct/);
 assert.match(body,/C\.ratchetLockStepPct/);
 assert.doesNotMatch(body,/InpProfitRatchetEnabled|InpRatchetTriggerPct|InpRatchetLockPct|InpRatchetStepPct|InpRatchetLockStepPct/);
});

test('InpNormalTakeProfitPct appears exactly twice in the whole file: the input declaration and the Defaults() seed -- every runtime consumer (Start(), both OnTimer() restart-recovery targetEq recomputations) uses C.normalTargetProfitPct instead',()=>{
 const count=(s.match(/InpNormalTakeProfitPct/g)||[]).length;
 assert.equal(count,2,`expected exactly 2 references (declaration + Defaults() seed), found ${count}`);
 const onTimerBody=s.slice(s.indexOf('void OnTimer()'));
 assert.doesNotMatch(onTimerBody,/InpNormalTakeProfitPct/);
 assert.match(onTimerBody,/C\.normalTargetProfitPct>0\?cycleStart\*\(1\.0\+C\.normalTargetProfitPct\/100\.0\)/);
});

test('InpNormalTakeProfitPct and the five InpRatchet* inputs are still declared (compat) and seed Defaults() only',()=>{
 assert.match(s,/input double InpNormalTakeProfitPct=0\.0;/);
 assert.match(s,/input bool {3}InpProfitRatchetEnabled=true;/);
 const defaultsBody=s.slice(s.indexOf('void Defaults()'),s.indexOf('bool ConfigPoll()'));
 assert.match(defaultsBody,/C\.normalTargetProfitPct=InpNormalTakeProfitPct;/);
 assert.match(defaultsBody,/C\.profitRatchetEnabled=InpProfitRatchetEnabled;/);
 assert.match(defaultsBody,/C\.ratchetTriggerPct=InpRatchetTriggerPct;/);
 assert.match(defaultsBody,/C\.ratchetLockPct=InpRatchetLockPct;/);
 assert.match(defaultsBody,/C\.ratchetStepPct=InpRatchetStepPct;/);
 assert.match(defaultsBody,/C\.ratchetLockStepPct=InpRatchetLockStepPct;/);
});

test('SaveCloudCache/LoadCloudCache round-trip the ratchet config so a restart before the first fresh poll keeps the dashboard-saved ratchet, not the compiled default',()=>{
 const save=s.slice(s.indexOf('void SaveCloudCache()'),s.indexOf('bool LoadCloudCache()'));
 const load=s.slice(s.indexOf('bool LoadCloudCache()'),s.indexOf('string trim('));
 for(const key of ['RTE','RTT','RTL','RTS','RTK']){
   assert.match(save,new RegExp(`CacheSet\\("${key}"`),`SaveCloudCache does not cache ${key}`);
   assert.match(load,new RegExp(`CacheGet\\("${key}"`),`LoadCloudCache does not restore ${key}`);
 }
});

test('exit ordering: the ratchet check runs before the Basket TP check, so a tick where both would fire is decided deterministically (ratchet wins, matching "protects profit and exits" semantics)',()=>{
 const iRatchet=s.indexOf('Default Apex percentage profit ratchet');
 const iTP=s.indexOf('if(targetEq>0&&campEq>=targetEq)');
 assert.ok(iRatchet>0&&iTP>0&&iRatchet<iTP);
});

// server.mjs (Apex backend) is the other end of the wire: the field names it accepts/serves via
// clean()/DEFAULT must exactly match what the EA parses above, or the dashboard could silently
// save a field the EA never asked for (or vice versa).
test('server.mjs config schema uses the exact same six field names the EA parses',async()=>{
 const server=await fs.readFile(new URL('../server.mjs',import.meta.url),'utf8');
 for(const f of configFields)assert.ok(server.includes(f),`server.mjs DEFAULT/clean() missing ${f}`);
});
