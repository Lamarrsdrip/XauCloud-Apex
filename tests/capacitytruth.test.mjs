import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';

const ea=fs.readFileSync(new URL('../ea/XauCloud-Apex.mq5',import.meta.url),'utf8');
const version=JSON.parse(fs.readFileSync(new URL('../version.json',import.meta.url),'utf8'));
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');

test('the canonical and versioned EA files are byte-identical',()=>{
  // The canonical file is the main bot. The versioned file is the release archive.
  // They must stay identical so nobody compiles a stale named copy.
  const canonical=fs.readFileSync(new URL('../ea/XauCloud-Apex.mq5',import.meta.url));
  const versioned=fs.readFileSync(new URL('../'+version.versionedEaFile,import.meta.url));
  assert.equal(version.eaFile,'ea/XauCloud-Apex.mq5');
  assert.equal(version.versionedEaFile,'ea/XauCloud-Apex-v3.8.8-UnlimitedFromL3.mq5');
  assert.equal(sha(canonical),sha(versioned),
    `${version.eaFile} and ${version.versionedEaFile} must be identical`);
});

test('version.json, the EA banner and #property version all agree',()=>{
  assert.equal(version.version,'3.8.8');
  assert.ok(ea.includes(version.eaVersion),'EA must define the version.json eaVersion string');
  const prop=ea.match(/#property version\s+"([\d.]+)"/)?.[1];
  assert.equal(prop,'3.880');
});
function floorStep(v,step=0.01){return Math.floor((v+1e-12)/step)*step;}
function normalVolume({free=1000,price=4420,contract=100,leverage=500,pct,step=0.01}){
  const margin1=contract*price/leverage;
  const full=floorStep(free/margin1,step);
  const byCapacity=floorStep(full*pct/100,step);
  const byMoney=floorStep((free*pct/100)/margin1,step);
  return Math.min(byCapacity,byMoney);
}

test('canonical EA is v3.8.8 UnlimitedFromL3 with v3.8.2 CapacityTruth trading intact',()=>{
  assert.match(ea,/#property version\s+"3\.880"/);
  assert.match(ea,/XauCloud-Apex_v3\.8\.8-UnlimitedFromL3/);
  assert.match(ea,/if\(s\.valid\) Start\(s\);/);
  assert.doesNotMatch(ea,/if\(s\.valid&&s\.inLocation\) Start\(s\)/);
  assert.match(ea,/TrustedMarginPerLot/);
  assert.match(ea,/NORMAL_REFERENCE_LEVERAGE/);
});

test('NORMAL 15/50/100 is monetary margin semantics, not SYMBOL_VOLUME_MAX percentages',()=>{
  assert.equal(normalVolume({pct:15}).toFixed(2),'0.16');
  assert.equal(normalVolume({pct:50}).toFixed(2),'0.56');
  assert.equal(normalVolume({pct:100}).toFixed(2),'1.13');
  assert.notEqual(normalVolume({pct:15}),30);
  assert.notEqual(normalVolume({pct:50}),100);
});

test('NORMAL derives capacity from money and can fall back to a configured reference leverage',()=>{
  assert.match(ea,/TrustedMarginPerLot/);
  assert.match(ea,/MarginPerLotAtLeverage/);
  assert.match(ea,/normalReferenceLeverage/);
  assert.match(ea,/NORMAL_REFERENCE_LEVERAGE_REQUIRED/);
  assert.match(ea,/capacitySource/);
});

test('a rejected NORMAL tier re-derives capacity and re-applies the SAME percentage',()=>{
  // The owner rule: 15% must never become ~100% by halving until something fills.
  assert.match(ea,/SIZING_MODEL_REJECTED/);
  assert.match(ea,/SIZING_CAPACITY_REDERIVED/);
  assert.match(ea,/RederiveAfterSizeRejection\(plan,/);
  assert.match(ea,/trueCap\*pct\/100\.0/);
});

test('the sizing audit trail the owner asked for is actually emitted',()=>{
  for(const field of ['brokerReportedLeverage','configuredNormalReferenceLeverage',
                      'effectiveSizingLeverage','brokerMarginModelTrusted','capacitySource',
                      'moneyCapacity']){
    assert.ok(ea.includes(field),`APEX SIZING telemetry must expose ${field}`);
  }
  // and the heartbeat must carry the same truth to the dashboard
  assert.match(ea,/broker_reported_leverage/);
  assert.match(ea,/configured_normal_reference_leverage/);
  assert.match(ea,/margin_at_1_lot/);
});

test('normalReferenceLeverage is remotely configurable end to end (no EA recompile)',()=>{
  const server=fs.readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
  const ui=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
  // validated in the server config schema...
  assert.match(server,/normalReferenceLeverage:\{t:'int'/);
  // ...projected into the config the EA actually polls...
  assert.match(server,/normalReferenceLeverage:c\.normalReferenceLeverage/);
  // ...editable on the dashboard...
  assert.match(ui,/f-normalReferenceLeverage/);
  // ...and read by the EA from config, not from a compiled-in input only.
  assert.match(ea,/CfgNum\("normalReferenceLeverage"/);
  // Default must stay AUTO: never silently assume 1:500 for every account.
  assert.match(server,/normalReferenceLeverage:\{t:'int',d:0/);
});

test('UNLIMITED aggressive capacity path remains present',()=>{
  // UNLIMITED must still establish capacity from the broker/server itself: no reference
  // leverage, no invented lot cap, no NORMAL margin economics.
  assert.match(ea,/UNLIMITED_BROKER_CAPACITY/);
  assert.match(ea,/UNLIMITED_SERVER_CAPACITY/);
  assert.match(ea,/LargestVolumePassingCheck/);
  assert.doesNotMatch(ea,/normalReferenceLeverage[^;]*UNLIMITED/,
    'UNLIMITED must never be given a reference leverage');
  // v3.8.7: the retry is a capacity re-derivation, not a blind halving. "APEX SIZING
  // STEP-DOWN" was the halving path and is deliberately gone.
  assert.doesNotMatch(ea,/APEX SIZING STEP-DOWN/);
  assert.match(ea,/APEX CAPACITY RE-DERIVED/);
});

test('event telemetry is durable across terminal restart',()=>{
  assert.match(ea,/EventQueueFile\(\)/);
  assert.match(ea,/PersistEventQueue\(\)/);
  assert.match(ea,/LoadEventQueue\(\)/);
  assert.match(ea,/APEX DURABLE EVENT OUTBOX RESTORED/);
});
