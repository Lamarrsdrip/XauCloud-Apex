// v3.8.8 UnlimitedFromL3 -- UNLIMITED sizing state machine.
//
//   L1  = 15% x SIMULATED 1:200 capacity
//   L2  = 50% x SIMULATED 1:200 capacity (re-derived fresh)
//   L3  = 100% x actual UNLIMITED executable capacity
//   L4+ = 100% x actual UNLIMITED executable capacity (profit-fed)
//
// Every figure below comes from the REAL PlanLayerSizing / ComputeLayerVolume /
// ComputeSimulated1200Volume / ComputeVolume / RederiveAfterSizeRejection, extracted
// verbatim from ea/XauCloud-Apex.mq5 and run against the mock broker in tests/native.
// The expected values are computed here independently from the scenario inputs
// (contract 100 oz, "1:200" = margin is notional/200), not read back from the EA.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildAndRun, findCxx } from './native/build_and_run.mjs';

const run=buildAndRun();
const has=Boolean(!run.skipped);
const R=run.byName||{};
const skip=has?false:`no C++ toolchain (${run.skipped})`;
const ea=fs.readFileSync(new URL('../ea/XauCloud-Apex.mq5',import.meta.url),'utf8');

const CONTRACT=100;
const floor=(v,step=0.01)=>Math.round(Math.floor((v+1e-9)/step)*step*1e8)/1e8;
const m200=(price,rate=1)=>CONTRACT*price*rate/200;               // margin/lot at 1:200
const near=(a,b,eps=1e-6)=>Math.abs(a-b)<=eps;

function section(start,end){
  const a=ea.indexOf(start);
  assert.ok(a>=0,`missing section start: ${start}`);
  const b=end?ea.indexOf(end,a+start.length):ea.length;
  assert.ok(b>a,`missing section end: ${end}`);
  return ea.slice(a,b);
}

//------------------------------------------------------------------------------
test('CRITICAL $1,000 REGRESSION: L1 can NOT be 15% of the Unlimited capacity (the 30-lot bug)',{skip},()=>{
  const r=R.unl1000_L1;
  assert.equal(r.equity,1000);
  assert.equal(r.profile,'UNLIMITED');
  // The erroneous Unlimited capacity is forced to 200 lots: the Exness client model
  // reports 0.00 margin/lot, so OrderCalcMargin and OrderCheck both approve VOLUME_MAX.
  assert.equal(r.unlimitedCapacityNow,200,'harness must force the old Unlimited capacity to 200');
  // The pre-3.8.8 engine at the same 15% reproduces the bug...
  assert.equal(r.oldEngineSamePctFinal,30,'the v3.8.7 path must still reproduce 15% x 200 = 30');
  // ...and the shipped L1 path does not.
  assert.notEqual(r.final,30,'L1 must NEVER be 30 lots on a $1,000 account');
  const cap=floor(1000/m200(4400));                                  // 0.45 lots
  assert.equal(cap,0.45);
  assert.equal(r.capacity,cap,'L1 capacity must be the simulated 1:200 capacity');
  assert.equal(r.final,floor(cap*0.15),'L1 must be 15% of the simulated 1:200 capacity');
  assert.equal(r.final,0.06);
  assert.ok(r.final/r.unlimitedCapacityNow<0.001,'L1 must be a tiny fraction of the Unlimited ceiling');
});

test('TEST 1 -- $1,000 UNLIMITED: L1 uses SIMULATED 1:200 capacity and NOT Unlimited capacity',{skip},()=>{
  const r=R.unl1000_L1;
  assert.equal(r.mode,'SIMULATED_1_200');
  assert.equal(r.sizingMode,'SIMULATED_1_200');
  assert.equal(r.sizingModel,'UNLIMITED_SIMULATED_1_200');
  assert.equal(r.capacitySource,'SIMULATED_1_200_MARGIN');
  assert.equal(r.planSimLeverage,200);
  assert.equal(r.simulatedLeverage,200);
  assert.equal(r.effectiveSizingLeverage,200);
  // 1:200 margin is built from the contract spec: 100oz * 4400 / 200 = 2200/lot, while
  // the broker's own (degenerate) model says 0.
  assert.equal(r.simMarginPerLot,m200(4400));
  assert.equal(r.simBrokerMarginPerLot,0);
  assert.notEqual(r.capacity,r.unlimitedCapacityNow,'L1 capacity must not be the Unlimited capacity');
  assert.equal(r.configuredNormalReferenceLeverage,0,'NORMAL reference leverage is never consulted');
  // Proof by invariance: raise the Unlimited capacity 200 -> 500. L1 must not move.
  const big=R.unl1000_L1_volmax500;
  assert.equal(big.unlimitedCapacityNow,500);
  assert.equal(big.oldEngineSamePctFinal,75,'the old engine would have followed it to 75 lots');
  assert.equal(big.final,r.final,'L1 is independent of the Unlimited capacity');
  assert.equal(big.capacity,r.capacity);
  // SELL is priced at the bid through the same engine.
  const s=R.unl1000_L1_sell;
  assert.equal(s.dir,-1);
  assert.equal(s.mode,'SIMULATED_1_200');
  assert.equal(s.final,0.06);
  // Same state machine on a money-bound broker (real margin 1:2000): L1 is still 1:200.
  const sane=R.sane_L1;
  assert.equal(sane.unlimitedCapacityNow,4.54,'actual capacity at 1:2000 is 4.54 lots');
  assert.equal(sane.simMarginPerLot,2200,'1:200 margin wins over the 220/lot broker margin');
  assert.equal(sane.final,0.06);
  assert.notEqual(sane.final,floor(sane.unlimitedCapacityNow*0.15),'not 15% of Unlimited (0.68)');
});

test('TEST 2 -- L1 = 15% x simulated 1:200 capacity',{skip},()=>{
  for(const k of ['unl1000_L1','unl1000_L1_sell','sane_L1']){
    const r=R[k];
    assert.equal(r.pct,15,`${k}: L1 percentage`);
    assert.ok(near(r.simMoneyCapacity,r.simFreeMargin/r.simMarginPerLot),`${k}: money capacity = free/margin200`);
    assert.equal(r.capacity,floor(r.simMoneyCapacity),`${k}: capacity is the grid-floored 1:200 capacity`);
    assert.ok(near(r.targetVolume,r.capacity*0.15),`${k}: target = 15% of capacity`);
    assert.equal(r.final,floor(r.capacity*0.15),`${k}: final = floor(15% of capacity)`);
  }
});

test('TEST 3 -- L2 = 50% x FRESHLY re-derived simulated 1:200 capacity',{skip},()=>{
  const l1=R.unl1000_L1,l2=R.unl1000_L2;
  assert.equal(l2.filledLayers,1);
  assert.equal(l2.layerIndex,2);
  assert.equal(l2.mode,'SIMULATED_1_200','L2 must still be 1:200, not Unlimited');
  assert.equal(l2.pct,50);
  // Price moved 4400 -> 4410: equity 1000 + 0.06*100*10 = 1060. The L1 position is
  // re-priced at 1:200 (0.06 * 2205 = 132.30) exactly as a real 1:200 account would.
  assert.equal(l2.equity,1060);
  assert.ok(near(l2.simUsedMargin,0.06*m200(4410)),'existing exposure is charged at 1:200');
  assert.ok(near(l2.simFreeMargin,1060-0.06*m200(4410)));
  const fresh=floor((1060-0.06*m200(4410))/m200(4410));            // 0.42
  assert.equal(l2.capacity,fresh);
  assert.notEqual(l2.capacity,l1.capacity,'the L1 capacity (0.45) must not be reused');
  assert.equal(l2.final,floor(fresh*0.5));
  assert.equal(l2.final,0.21);
  assert.notEqual(l2.final,floor(l1.capacity*0.5),'50% of the STALE capacity (0.22) must not be used');
  assert.equal(l2.oldEngineSamePctFinal,100,'the old engine would have sent 50% of 200 = 100 lots');
  // Same on the money-bound broker (its real used margin is subtracted as ACCOUNT_MARGIN).
  const s=R.sane_L2;
  assert.equal(s.mode,'SIMULATED_1_200');
  assert.equal(s.capacity,0.42);
  assert.equal(s.final,0.21);
});

test('TEST 4 -- after L2, L3 switches to 100% of actual UNLIMITED executable capacity',{skip},()=>{
  const r=R.unl1000_L3;
  assert.equal(r.filledLayers,2);
  assert.equal(r.layerIndex,3);
  assert.equal(r.mode,'UNLIMITED');
  assert.equal(r.pct,100);
  assert.equal(r.sizingModel,'UNLIMITED_BROKER_CAPACITY');
  assert.equal(r.capacitySource,'UNLIMITED_SERVER_CAPACITY');
  assert.equal(r.simulatedLeverage,0,'no simulated leverage from L3 on');
  assert.equal(r.capacity,r.unlimitedCapacityNow);
  assert.equal(r.final,r.unlimited100Final,'L3 = the Unlimited engine at 100%');
  assert.equal(r.final,200,'L3 = 100% of 200 lots, subject to broker/execution constraints');
  // Money-bound broker: 100% of what free margin can really carry right now.
  const s=R.sane_L3;
  assert.equal(s.mode,'UNLIMITED');
  const cap=floor(s.freeMargin/(4420*CONTRACT/2000));                // 1270.33/221 = 5.74
  assert.equal(s.capacity,cap);
  assert.equal(s.final,cap);
  assert.equal(s.final,5.74);
  assert.ok(s.final>R.sane_L2.capacity*10,'L3 is far beyond anything the 1:200 engine would allow');
});

test('TEST 5 -- after L3, L4 stays UNLIMITED: 100% of CURRENT executable capacity',{skip},()=>{
  const r=R.sane_L4_after_profit;
  assert.equal(r.filledLayers,3);
  assert.equal(r.layerIndex,4);
  assert.equal(r.mode,'UNLIMITED_PROFIT_FED');
  assert.equal(r.pct,100);
  assert.equal(r.sizingModel,'UNLIMITED_BROKER_CAPACITY');
  assert.equal(r.final,floor(r.freeMargin/(4425*CONTRACT/2000)));
  assert.equal(r.final,r.unlimitedCapacityNow);
  // The ladder never returns to 15%/50% for any later layer.
  const p=R.plan_unlimited;
  assert.deepEqual(p.modes,['SIMULATED_1_200','SIMULATED_1_200','UNLIMITED',
    'UNLIMITED_PROFIT_FED','UNLIMITED_PROFIT_FED','UNLIMITED_PROFIT_FED','UNLIMITED_PROFIT_FED','UNLIMITED_PROFIT_FED']);
  assert.deepEqual(p.pcts,[15,50,100,100,100,100,100,100]);
});

test('TEST 6 -- profit/free margin growth is consumed by L4+ without a new campaign',{skip},()=>{
  const seq=[['sane_L4_after_profit',4,4425],['sane_L5_after_profit',5,4432],['sane_L6_after_profit',6,4440]];
  let prev=0;
  for(const [k,layer,price] of seq){
    const r=R[k];
    assert.equal(r.layerIndex,layer,`${k}: layer count continues -- no reset to L1`);
    assert.equal(r.mode,'UNLIMITED_PROFIT_FED',`${k}: never back to the 1:200 ladder`);
    assert.equal(r.pct,100);
    assert.equal(r.final,floor(r.freeMargin/(price*CONTRACT/2000)),`${k}: capacity re-derived NOW`);
    assert.ok(r.final>prev,`${k}: newly available capacity is used (${r.final} > ${prev})`);
    prev=r.final;
  }
  assert.deepEqual(seq.map(([k])=>R[k].final),[13.58,61.85,191.22]);
});

test('TEST 7 -- Unlimited capacity 0: L4+ WAITS, then uses capacity once it appears',{skip},()=>{
  for(const [wait,after,layer] of [['sane_L4_wait','sane_L4_after_profit',4],['sane_L5_wait','sane_L5_after_profit',5]]){
    const w=R[wait],a=R[after];
    assert.equal(w.layerIndex,layer);
    assert.equal(w.mode,'UNLIMITED_PROFIT_FED');
    assert.equal(w.capacity,0,`${wait}: 100% was already used`);
    assert.equal(w.final,0,`${wait}: nothing is sent`);
    assert.notEqual(w.block,'',`${wait}: the wait is explicit`);
    assert.equal(a.layerIndex,layer,`${after}: SAME layer, same campaign`);
    assert.equal(a.mode,'UNLIMITED_PROFIT_FED');
    assert.ok(a.final>0,`${after}: recalculated capacity is attempted`);
  }
  // In the EA a sizing block leaves the trigger unconsumed and the state unchanged.
  const open=section('bool OpenLayer(','string execExtra=StringFormat(');
  assert.match(open,/APEX SIZING WAIT/);
  assert.match(open,/if\(sizingBlocked\)[\s\S]*?return false;/);
  const manage=section('void Manage()','//====================== restart reconciliation');
  assert.match(manage,/if\(OpenLayer\([^)]*\)\)\s*\{\s*ConsumeTrigger\(a\.triggerId\)/,
    'a trigger is consumed ONLY when the layer actually opened');
});

test('TEST 8 -- a rejected L1 retries as 15% of 1:200 -- never 50%, never Unlimited',{skip},()=>{
  const r=R.retry_L1_rejected;
  assert.equal(r.mode,'SIMULATED_1_200');
  assert.equal(r.pct,15);
  // $20,000: 1:200 capacity 9.09 lots -> L1 = 15% = 1.36. The server refuses > 1.00.
  assert.equal(r.initialCapacity,floor(20000/m200(4400)));
  assert.equal(r.initial,floor(r.initialCapacity*0.15));
  assert.equal(r.tried[0],1.36);
  // The refusal proves capacity < 1.36, so the 1:200 capacity is re-derived below it
  // (1.35) and the SAME 15% is re-applied.
  assert.deepEqual(r.reDerivedCapacities,[1.35]);
  assert.equal(r.filled,floor(1.35*0.15));
  assert.equal(r.filled,0.20);
  assert.notEqual(r.filled,floor(1.35*0.5),'must not become 50%');
  assert.ok(r.filled<=r.initialCapacity*0.15+1e-9,'must stay within 15% of the 1:200 capacity');
  assert.ok(r.filled<=r.initial,'a retry never grows the request');
  assert.equal(r.modeAfter,'SIMULATED_1_200','the retry cannot switch L1 to Unlimited');
  assert.equal(r.pctAfter,15);
  assert.equal(r.gaveUp,false);
});

test('TEST 9 -- a rejected L2 retries as 50% of 1:200 -- never Unlimited',{skip},()=>{
  const r=R.retry_L2_rejected;
  assert.equal(r.mode,'SIMULATED_1_200');
  assert.equal(r.pct,50);
  // L1 1.36 lots open, priced at 1:200: (20000 - 1.36*2200)/2200 = 7.73 lots -> 50% = 3.86.
  assert.equal(r.initialCapacity,floor((20000-1.36*m200(4400))/m200(4400)));
  assert.equal(r.initial,3.86);
  assert.deepEqual(r.reDerivedCapacities,[3.85]);
  assert.equal(r.filled,floor(3.85*0.5));
  assert.equal(r.filled,1.92);
  assert.ok(r.filled<=r.initialCapacity*0.5+1e-9);
  assert.equal(r.modeAfter,'SIMULATED_1_200','L2 must not transition to Unlimited on a retry');
  assert.equal(r.pctAfter,50);
  assert.equal(r.gaveUp,false);
});

test('TEST 10 -- NORMAL accounts are unchanged',{skip},()=>{
  const expect={normal_incident_L1:0.16,normal_incident_L2:1.87,normal_1200_L3:1.35,normal_1200_L4:0.90,
                normal_linear_L1:1.70,normal_linear_L2:5.68,normal_linear_L3:11.36,normal_auto_pathological_blocks:0};
  for(const [k,v] of Object.entries(expect)){
    const r=R[k];
    assert.equal(r.mode,'NORMAL',`${k}: NORMAL never enters the UNLIMITED state machine`);
    assert.equal(r.simulatedLeverage,0,`${k}: NORMAL never uses the 1:200 engine`);
    assert.equal(r.identical,true,`${k}: new entry point must equal the untouched ComputeVolume() field by field`);
    assert.equal(r.final,v,`${k}: NORMAL size changed`);
  }
  assert.match(R.normal_auto_pathological_blocks.block,/^NORMAL_REFERENCE_LEVERAGE_REQUIRED/);
  assert.deepEqual(R.plan_normal.modes,Array(8).fill('NORMAL'));
  assert.deepEqual(R.plan_normal.pcts,[15,50,100,100,100,100,100,100]);
  // Source proof: the NORMAL branch of ComputeVolume is byte-identical to v3.8.2.
  const v382=fs.readFileSync(new URL('../ea/archive/XauCloud-Apex-v3.8.2-CapacityTruth.mq5',import.meta.url),'utf8');
  const branch=src=>{
    const a=src.indexOf('   if(ExecutionProfile()=="NORMAL")\n     {\n      double calcM=0');
    const b=src.indexOf('   // UNLIMITED: preserve the owner\'s aggressive semantics.',a);
    assert.ok(a>0&&b>a,'NORMAL branch not found');
    return src.slice(a,b);
  };
  assert.equal(branch(ea),branch(v382),'the NORMAL sizing branch must be byte-identical to v3.8.2');
});

//------------------------------------------------------------------------------
test('L3 (100%) still converges when the server refuses what the preflight approved',{skip},()=>{
  const r=R.retry_L3_pct100_converges;
  assert.equal(r.mode,'UNLIMITED');
  assert.equal(r.pct,100);
  assert.deepEqual(r.tried,[200,99.99,49.99,24.99],'capacity bound contracts geometrically');
  assert.equal(r.filled,24.99,'lands at ~the true 25-lot capacity');
  assert.equal(r.modeAfter,'UNLIMITED');
  assert.equal(r.gaveUp,false);
});

test('server-proven capacity evidence bounds L3, and cannot inflate L1',{skip},()=>{
  assert.equal(R.evidence_cold_L3.final,200);
  assert.equal(R.evidence_warm_L3.final,29.99,'a proven 30-lot refusal caps the next L3 at 29.99');
  const l1=R.evidence_warm_L1;
  assert.equal(l1.mode,'SIMULATED_1_200');
  assert.equal(l1.final,floor(floor(2500/m200(4400))*0.15),'L1 is still 15% of 1:200 (0.16)');
  assert.equal(l1.oldEngineSamePctFinal,4.49,'the old engine would have sent 15% of the 29.99 evidence');
});

test('1:200 margin model: calc mode, margin rate, currency conversion, stricter broker',{skip},()=>{
  // FOREX (leverage-scaled) mode: the broker's initial margin rate 1.5 applies.
  const fx=R.calc_forex_rate_1_5;
  assert.equal(fx.simMarginRate,1.5);
  assert.equal(fx.simMarginPerLot,m200(4400,1.5));
  assert.equal(fx.final,floor(floor(10000/m200(4400,1.5))*0.15));
  // CFD mode: the broker rate (0.005) already IS the broker leverage; it is not applied
  // on top of 1:200 (that would under-charge by 200x).
  const cfd=R.calc_cfd_rate_ignored;
  assert.equal(cfd.simMarginRate,1);
  assert.equal(cfd.simMarginPerLot,m200(4400));
  // EUR account, USD-quoted gold: notional = price * TICK_VALUE / TICK_SIZE.
  const eur=R.eur_account_tick_value;
  assert.ok(near(eur.simMarginPerLot,4400*0.085/0.001/200),'440,000 USD = 374,000 EUR -> 1,870 EUR/lot');
  // A broker stricter than 1:200 (real 1:100): a 1:200 account is never charged less.
  const strict=R.broker_stricter_than_200;
  assert.equal(strict.simFormulaMarginPerLot,2200);
  assert.equal(strict.simBrokerMarginPerLot,4400);
  assert.equal(strict.simMarginPerLot,4400);
  // No way to price the notional: refuse, never guess, never fall through to Unlimited.
  const none=R.sim_margin_unavailable_blocks;
  assert.equal(none.final,0);
  assert.equal(none.block,'SIMULATED_1_200_MARGIN_UNAVAILABLE');
  assert.equal(none.mode,'SIMULATED_1_200');
});

test('SYMBOL_VOLUME_LIMIT is respected by both engines (positions + pending, one direction)',{skip},()=>{
  const l3=R.volume_limit_L3;
  assert.equal(l3.volumeLimitRoom,0.2,'5.00 limit - 4.70 open - 0.10 pending buy');
  assert.equal(l3.final,0.2);
  assert.equal(R.volume_limit_reached_L3.final,0);
  assert.equal(R.volume_limit_reached_L3.block,'SYMBOL_VOLUME_LIMIT_REACHED');
  const l2=R.volume_limit_L2;
  assert.equal(l2.mode,'SIMULATED_1_200');
  assert.equal(l2.volumeLimitRoom,0.34,'0.50 - 0.06 open - 0.10 pending buy; the sell order is ignored');
  assert.equal(l2.capacity,0.34);
  assert.equal(l2.final,0.17,'50% of the executable 1:200 capacity');
});

test('small accounts: 1:200 minimum-lot economics are honoured, never rounded up blindly',{skip},()=>{
  const r20=R.unl20_L1;
  assert.equal(r20.final,0,'$20 cannot carry 0.01 lot at 1:200 ($22 margin)');
  assert.equal(r20.block,'SIMULATED_1_200_CAPACITY_ZERO');
  assert.equal(r20.oldEngineSamePctFinal,30,'the old engine sent 30 lots even here');
  const r150=R.unl150_L1_min_lot;
  // 15% of $150 = $22.50 >= the $22.00 1:200 margin of one minimum lot, so 0.01 is legal.
  assert.equal(r150.final,0.01);
});

test('broker volume steps never round the 15% L1 UP past its budget',{skip},()=>{
  for(const [k,step] of [['sim_step_0.01',0.01],['sim_step_0.10',0.1],['sim_step_0.25',0.25]]){
    const r=R[k];
    assert.ok(r.final<=r.simMoneyCapacity*0.15+1e-9,`${k}: over the 15% budget`);
    assert.ok(near(r.final/step,Math.round(r.final/step)),`${k}: off the broker grid`);
  }
  assert.deepEqual(['sim_step_0.01','sim_step_0.10','sim_step_0.25'].map(k=>R[k].final),[1.7,1.6,1.5]);
});

test('any non-NORMAL profile takes the safe 1:200-first ladder, never the raw Unlimited engine at L1',{skip},()=>{
  assert.deepEqual(R.plan_unknown_profile_takes_safe_ladder.modes,R.plan_unlimited.modes);
  assert.deepEqual(R.plan_unknown_profile_takes_safe_ladder.pcts,R.plan_unlimited.pcts);
});

//------------------------------------------------------------------------------
// Source-level contract (runs without a C++ toolchain).
test('EA: one sizing entry point, two engines that never mix',()=>{
  const plan=section('LayerSizingPlan PlanLayerSizing(','// The ONLY entry point that sizes a layer.');
  assert.match(plan,/p\.filledLayers==0\)\s*\{p\.mode="SIMULATED_1_200";p\.pct=APEX_UNL_L1_SIM200_PCT/);
  assert.match(plan,/p\.filledLayers==1\)\s*\{p\.mode="SIMULATED_1_200";p\.pct=APEX_UNL_L2_SIM200_PCT/);
  assert.match(plan,/p\.mode=\(p\.filledLayers==2\)\?"UNLIMITED":"UNLIMITED_PROFIT_FED"/);
  assert.match(plan,/p\.pct=APEX_UNL_L3PLUS_PCT/);
  assert.match(ea,/#define APEX_SIM_LEVERAGE\s+200\b/);
  assert.match(ea,/#define APEX_UNL_L1_SIM200_PCT\s+15\.0\b/);
  assert.match(ea,/#define APEX_UNL_L2_SIM200_PCT\s+50\.0\b/);
  assert.match(ea,/#define APEX_UNL_L3PLUS_PCT\s+100\.0\b/);
  const disp=section('SizingDecision ComputeLayerVolume(','// After the SERVER refused');
  assert.match(disp,/plan\.mode=="SIMULATED_1_200"[\s\S]*ComputeSimulated1200Volume\(dir,plan\.pct/);
  const sim=section('SizingDecision ComputeSimulated1200Volume(','string SizingJson');
  assert.doesNotMatch(sim,/ComputeVolume\(/,'the 1:200 engine must not call the Unlimited engine');
  assert.doesNotMatch(sim,/normalReferenceLeverage\s*[;,)]/,'the 1:200 engine must not use NORMAL settings');
  assert.match(sim,/BrokerAcceptsVolume\(dir,v,price,sl,d\.checkRetcode\)/,'final OrderCheck on the exact volume');
  assert.match(sim,/LargestVolumePassingCheck\(dir,price,sl,d\.capacityByMargin\)/,'capacity proven by OrderCheck');
  assert.match(sim,/SimUsedMarginAtLeverage\(APEX_SIM_LEVERAGE\)/,'existing exposure re-priced at 1:200');
  assert.match(sim,/VolumeLimitRoom\(dir\)/);
});

test('EA: OpenLayer sizes from the broker-confirmed layer count and retries with the SAME plan',()=>{
  const open=section('bool OpenLayer(','string execExtra=StringFormat(');
  assert.match(open,/LayerSizingPlan plan=PlanLayerSizing\(ExecutionProfile\(\),layers\)/);
  assert.match(open,/ComputeLayerVolume\(plan,dir,g\.price,sl\)/);
  assert.match(open,/RederiveAfterSizeRejection\(plan,dir,g\.price,sl,vol,trueCap\)/);
  assert.doesNotMatch(open,/ComputeVolume\(dir/,'OpenLayer must not bypass the plan');
  assert.doesNotMatch(open,/FloorToStep\(vol\*0\.5\)/,'no halve-until-it-fills');
  assert.doesNotMatch(open,/plan=PlanLayerSizing[\s\S]*plan=PlanLayerSizing/,'the plan is fixed for the whole retry');
  // layers only advances on a broker-confirmed fill, so the transition to Unlimited is
  // driven by FILLED layers, never by attempts.
  const full=section('bool OpenLayer(','//====================== closing');
  assert.ok(full.indexOf('if(e.cls!=EXEC_FILLED&&e.cls!=EXEC_PARTIAL)')<full.indexOf('layers++;'));
  const re=section('double RederiveAfterSizeRejection(','// A blocked UNLIMITED layer WAITS');
  assert.match(re,/ServerCapacityCeiling\(\)/);
  assert.match(re,/ComputeSimulated1200Volume\(dir,plan\.pct,price,sl,capHi\)/,'L1/L2 retry stays in the 1:200 engine');
  assert.match(re,/trueCap\*pct\/100\.0/);
});

test('EA: owner-mandated APEX SIZING telemetry',()=>{
  const pr=section('void PrintLayerSizing(','//====================== broker execution');
  assert.match(pr,/"APEX SIZING \| profile=%s layer=%d mode=%s capacity=%\.2f percentage=%\.0f%% target=%\.2f final=%\.2f"/);
  for(const f of ['simulatedLeverage','freeMargin','capacity','requested','normalized','FINAL','orderCheck','block'])
    assert.ok(pr.includes(f+'='),`detail line must log ${f}`);
  const open=section('bool OpenLayer(','string execExtra=StringFormat(');
  assert.match(open,/APEX SIZING REJECTED \| [^"]*reason=%s/);
  assert.match(open,/APEX CAPACITY RE-DERIVED/);
  assert.match(ea,/APEX SIZING RETRY RESULT/);
  const js=section('string SizingJson(','// Also printed to the terminal Experts log');
  for(const f of ['sizingMode','simulatedLeverage','simFreeMargin','simUsedMargin','simMarginPerLot','targetVolume','volumeLimitRoom'])
    assert.ok(js.includes(`\\"${f}\\"`),`event JSON must carry ${f}`);
});

test('native harness availability is reported honestly (v3.8.8)',()=>{
  if(!has)console.warn('NATIVE HARNESS SKIPPED:',run.skipped);
  assert.ok(has||findCxx()===null);
});
