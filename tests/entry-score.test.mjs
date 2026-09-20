import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const ea=fs.readFileSync(new URL('../ea/XauCloud-Apex.mq5',import.meta.url),'utf8');
const server=fs.readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
const ui=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');

test('v3.9.1 entry requires direction authority + context + live ignition + candle quality + configured score',()=>{
  assert.match(ea,/s\.valid=ctx&&ign&&stillAllowed&&s\.candleQuality>=58&&s\.score>=threshold;/);
  assert.match(ea,/double threshold=C\.entryScore\+\(C\.learningEnabled\?C\.learnEntryAdj:0\);/);
  assert.doesNotMatch(ea,/CONFIRMED_EXHAUSTION_REVERSAL|SELL_UPSIDE_LIQUIDITY_EXHAUST|BUY_DOWNSIDE_LIQUIDITY_EXHAUST/);
});

test('v3.9 has only the requested opportunity families',()=>{
  assert.match(ea,/BREAKOUT_UP/);
  assert.match(ea,/BREAKOUT_DOWN/);
  assert.match(ea,/TREND_UP_CONTINUATION/);
  assert.match(ea,/TREND_DOWN_CONTINUATION/);
  assert.match(ea,/FamilyFromSig/);
});

test('pressure is broker-feed evidence, not a fabricated order-book claim',()=>{
  assert.match(ea,/void CalculatePressure\(/);
  assert.match(ea,/g_tickUp/);
  assert.match(ea,/tick_volume/);
  assert.match(ea,/velocity=MathAbs\(live\)\*60\.0/);
  assert.match(ui,/not a centralized institutional order book/i);
});

test('breakout and trend controls travel end to end',()=>{
  const fields=[
    'breakoutLookbackBars','breakoutMinTouches','breakoutBufferAtr','breakoutArmDistanceAtr',
    'breakoutMaxExtensionAtr','breakoutPressureMin','trendPressureMin','trendSlopeMinAtr',
    'trendPullbackBars','trendMaxPullbackAtr','ignitionBodyAtr','ignitionCloseLocation'
  ];
  for(const f of fields){
    assert.ok(server.includes(f),`server missing ${f}`);
    assert.ok(ea.includes(`CfgNum("${f}"`)||ea.includes(`CfgNum("${f}"`),`EA parser missing ${f}`);
    assert.ok(ui.includes('f-'+f),`UI missing ${f}`);
  }
});

test('entry scan runs locally from OnTick and before cloud work in OnTimer',()=>{
  assert.match(ea,/void OnTick\(\)\{UpdateTickPressure\(\);ServiceEntryScan\(\);\}/);
  const timer=ea.slice(ea.indexOf('void OnTimer()'));
  const scan=timer.indexOf('ServiceEntryScan();');
  const cloud=timer.indexOf('CloudSync();');
  assert.ok(scan>=0&&cloud>scan,'signal scan must happen before CloudSync');
});

test('L2/L3 use fresh closed-bar evidence and one shared bar trigger identity',()=>{
  const add=ea.slice(ea.indexOf('AddCandidate BuildAddCandidate()'),ea.indexOf('//====================== basket management'));
  assert.match(add,/bar<=campStart/);
  assert.match(add,/L2_CONFIRMATION/);
  assert.match(add,/L3_EXPANSION/);
  assert.match(add,/CONFIRM\|%s\|%I64d/);
  const manage=ea.slice(ea.indexOf('void Manage()'),ea.indexOf('//====================== restart reconciliation'));
  assert.match(manage,/TRIGGER_ALREADY_CONSUMED/);
  assert.match(manage,/if\(p<=0\) return;/);
});

test('composite score is explicitly not a probability',()=>{
  assert.match(ea,/COMPOSITE_RANKING_NOT_PROBABILITY/);
});
