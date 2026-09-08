// Behavioural regression tests for the EA.
//
// These do NOT re-implement Apex logic. tests/native/build_and_run.mjs extracts the
// sizing and entry-gate functions VERBATIM from the CANONICAL ea/XauCloud-Apex.mq5 (and
// the v3.7.1 originals from ea/archive/), compiles them against a mock broker, and runs
// them. Each test therefore fails if the real .mq5 regresses.
//
// v3.8.2: the harness used to read a pinned ea/XauCloud-Apex-v3.8.0.mq5, so it certified
// a file that was NOT the release being promoted, and its expectations below still
// encoded the SYMBOL_VOLUME_MAX sizing defect as if it were correct.  Both are fixed.
//
// NOT a substitute for native MT5/broker validation -- see APEX_FIX_VALIDATION.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAndRun, findCxx } from './native/build_and_run.mjs';

const run=buildAndRun();
const has=Boolean(!run.skipped);
const R=run.byName||{};
const skip=has?false:`no C++ toolchain (${run.skipped})`;

test('CAPACITY-TRUTH: a NORMAL L1 15% request is 15% of MONEY, never 15% of SYMBOL_VOLUME_MAX',{skip},()=>{
  const r=R.live_exness_zero_margin_normal_L1;
  // v3.7.1 reproduction: the exact 200.00-lot request rejected on demo 476885386
  assert.equal(r.v371Volume,200,'v3.7.1 must reproduce the live 200-lot request');
  assert.equal(r.volMax,200);
  // The client margin model reports ZERO margin for gold, so OrderCalcMargin alone is
  // useless. The 1:500 leverage cross-check gives 100oz * 4401.10 / 500 = 880.22/lot,
  // so $1,000 of free margin is 1.13 lots of real capacity and 15% of that is 0.16.
  assert.equal(r.v380Volume,0.16);
  assert.equal(r.capacityByMargin,1.13,'capacity must come from money, not from volMax');
  // The number that must NEVER come back: 15% of the 200-lot symbol ceiling.
  assert.notEqual(r.v380Volume,30,'SYMBOL_VOLUME_MAX must not be the economic denominator');
});

test('CAPACITY-TRUTH: the NORMAL 15/50/100 ladder is a ladder of real capacity',{skip},()=>{
  const l1=R.live_exness_zero_margin_normal_L1,l2=R.live_exness_zero_margin_normal_L2,l3=R.live_exness_zero_margin_normal_L3;
  // v3.7.1: 15%, 50% and 100% all produced the identical volume -- the ladder was inert
  assert.equal(l1.v371Volume,l2.v371Volume);
  assert.equal(l2.v371Volume,l3.v371Volume);
  // v3.8.2: 15% / 50% / 100% of the SAME 1.13-lot monetary capacity.
  assert.equal(l1.v380Volume,0.16);
  assert.equal(l2.v380Volume,0.56);
  assert.equal(l3.v380Volume,1.13);
  // The old 30 / 100 / 200 expectation was the defect, and must stay dead.
  for(const [r,bad] of [[l1,30],[l2,100],[l3,200]]) assert.notEqual(r.v380Volume,bad);
  // Each tier is the stated percentage of the L3 (100%) capacity, on the volume grid.
  assert.equal(l1.v380Volume,Math.floor(l3.v380Volume*0.15*100+1e-9)/100);
  assert.equal(l2.v380Volume,Math.floor(l3.v380Volume*0.50*100+1e-9)/100);
});

test('INCIDENT 476885386 (2026-09-08 01:24): the 30/100-lot demo wipe cannot recur',{skip},()=>{
  // Pinned to the terminal's own telemetry and broker Journal, not to a theory:
  //   APEX SIZING profile=NORMAL L1 pct=15.00 leverage=1:2000000000 freeMargin=1000.00
  //   volMax=200 marginAt1Lot=0.00 capacityByMargin=200 byCapacityPct=30 FINAL=30
  //   Journal: "market sell 30 XAUUSDm", then 4s later "market sell 100 XAUUSDm".
  // Owner decision: this account is NORMAL with reference leverage 1:500.
  const l1=R.incident_476885386_L1_15pct, l2=R.incident_476885386_L2_50pct;
  assert.equal(l1.marginPerLot,0,'the incident account reported zero margin per lot');
  assert.equal(l1.brokerReportedLeverage,2000000000);
  assert.equal(l1.brokerMarginModelTrusted,false,'the broker model must be rejected');
  assert.equal(l1.capacitySource,'NORMAL_REFERENCE_LEVERAGE');
  assert.equal(l1.effectiveSizingLeverage,500);
  // 100oz * 4421.564 / 500 = 884.31/lot -> $1,000 is 1.13 lots -> 15% = 0.16
  assert.equal(l1.v380Volume,0.16);
  assert.notEqual(l1.v380Volume,30,'must never send the 30 lots again');
  assert.notEqual(l2.v380Volume,100,'must never send the 100 lots again');
  // L2 re-reads CURRENT free margin ($3,318.99 after L1), not the starting balance.
  assert.equal(l2.freeMargin,3318.99);
  assert.equal(l2.v380Volume,1.87);
});

test('OWNER RULE: NORMAL refuses rather than guessing when AUTO meets a pathological broker',{skip},()=>{
  for(const k of ['pathological_auto_without_reference_blocks','degenerate_leverage_normal_refuses']){
    const r=R[k];
    assert.equal(r.v380Volume,0,`${k}: must not size`);
    assert.equal(r.capacitySource,'NONE');
    assert.match(r.block,/^NORMAL_REFERENCE_LEVERAGE_REQUIRED/,`${k}: must name the missing setting`);
  }
});

test('OWNER RULE: the $1,200 NORMAL account at 1:500 sizes 15 / 50 / 100 of real capacity',{skip},()=>{
  const l1=R.acct1200_ref500_L1,l2=R.acct1200_ref500_L2,l3=R.acct1200_ref500_L3;
  // margin/lot = 100oz * 4421.564 / 500 = 884.3128 -> 1200 / 884.3128 = 1.3569 lots
  for(const r of [l1,l2,l3]){
    assert.equal(r.capacitySource,'NORMAL_REFERENCE_LEVERAGE');
    assert.equal(r.effectiveSizingLeverage,500);
    assert.ok(Math.abs(r.moneyCapacity-1.35699)<1e-4,'capacity must be money/refLeverage');
  }
  assert.equal(l1.v380Volume,0.20);
  assert.equal(l2.v380Volume,0.67);
  assert.equal(l3.v380Volume,1.35);
  // Each tier is exactly its percentage of the SAME capacity, floored to the grid.
  const cap=l3.moneyCapacity, floor=(v)=>Math.floor((v+1e-12)/0.01)*0.01;
  assert.ok(Math.abs(l1.v380Volume-floor(cap*0.15))<1e-9);
  assert.ok(Math.abs(l2.v380Volume-floor(cap*0.50))<1e-9);
  assert.ok(Math.abs(l3.v380Volume-floor(cap*1.00))<1e-9);
});

test('OWNER RULE: NORMAL capacity scales with the configured reference leverage (1:100 / 1:200 / 1:500)',{skip},()=>{
  const c100=R.ref_lev_100_L3.moneyCapacity, c200=R.ref_lev_200_L3.moneyCapacity, c500=R.ref_lev_500_L3.moneyCapacity;
  assert.equal(R.ref_lev_100_L1.effectiveSizingLeverage,100);
  assert.equal(R.ref_lev_200_L1.effectiveSizingLeverage,200);
  assert.equal(R.ref_lev_500_L1.effectiveSizingLeverage,500);
  // Capacity is money*leverage/notional, so it is linear in the leverage.
  assert.ok(Math.abs(c200/c100-2)<1e-4,'1:200 must be exactly twice 1:100');
  assert.ok(Math.abs(c500/c100-5)<1e-4,'1:500 must be exactly five times 1:100');
  // And each L1 is 15% of its own capacity.
  const floor=(v)=>Math.floor((v+1e-12)/0.01)*0.01;
  assert.ok(Math.abs(R.ref_lev_100_L1.v380Volume-floor(c100*0.15))<1e-9);
  assert.ok(Math.abs(R.ref_lev_200_L1.v380Volume-floor(c200*0.15))<1e-9);
  assert.ok(Math.abs(R.ref_lev_500_L1.v380Volume-floor(c500*0.15))<1e-9);
});

test('OWNER RULE: L4+ keeps adding at 100% of CURRENT capacity, and is never blocked for being past L3',{skip},()=>{
  const l3=R.layer_ladder_L3_100pct,l4=R.layer_ladder_L4_100pct,l5=R.layer_ladder_L5_100pct;
  for(const r of [l3,l4,l5]) assert.equal(r.block,'','a 100% add must not be blocked by layer index');
  // Free margin falls 1200 -> 800 -> 400 as layers open; each add re-reads it.
  assert.equal(l3.v380Volume,1.35);
  assert.equal(l4.v380Volume,0.90);
  assert.equal(l5.v380Volume,0.45);
  assert.ok(l4.v380Volume<l3.v380Volume&&l5.v380Volume<l4.v380Volume,
    'each later add reflects the CURRENT capacity, not the original balance');
  const floor=(v)=>Math.floor((v+1e-12)/0.01)*0.01;
  for(const r of [l3,l4,l5]) assert.ok(Math.abs(r.v380Volume-floor(r.moneyCapacity))<1e-9);
});

test('OWNER RULE: a trustworthy broker margin model is used, and the reference leverage ignored',{skip},()=>{
  const r=R.sane_broker_ignores_reference_leverage;
  assert.equal(r.capacitySource,'BROKER_MARGIN','a sane 1:500 broker must use its own economics');
  assert.equal(r.brokerMarginModelTrusted,true);
  assert.equal(r.configuredNormalReferenceLeverage,100,'the setting is present');
  assert.equal(r.effectiveSizingLeverage,500,'but it must NOT override a trustworthy broker');
  assert.equal(r.v380Volume,1.70);
});

test('CAPACITY-TRUTH: the profile that selects the sizing model is not decided by casing',{skip},()=>{
  const r=R.lowercase_profile_still_normal;
  assert.equal(r.v380Volume,0.16,'a lowercase "normal" must use the NORMAL model');
  assert.notEqual(r.v380Volume,200,'it must not fall through to the aggressive path');
});

test('UNLIMITED profile keeps its aggressive full allocation (not neutered by the NORMAL repair)',{skip},()=>{
  assert.equal(R.unlimited_profile_full_allocation.v380Volume,200);
  // The NORMAL capacity gate is NORMAL-only: UNLIMITED on the same degenerate $20
  // account still asks for everything the broker will accept.
  assert.equal(R.unlimited_degenerate_leverage_stays_aggressive.v380Volume,200);
  assert.equal(R.unlimited_degenerate_leverage_stays_aggressive.block,'');
});

test('an ordinary linear-margin 1:500 account sizes IDENTICALLY to v3.7.1 (no behaviour change)',{skip},()=>{
  for(const k of ['linear_margin_1to500_L1_unchanged','linear_margin_1to500_L2_unchanged','linear_margin_1to500_L3_unchanged']){
    const r=R[k];
    assert.equal(r.v380Volume,r.v371Volume,`${k}: v3.8.0 changed an ordinary account's size`);
  }
  assert.equal(R.linear_margin_1to500_L1_unchanged.v380Volume,1.7);
  assert.equal(R.linear_margin_1to500_L2_unchanged.v380Volume,5.68);
  assert.equal(R.linear_margin_1to500_L3_unchanged.v380Volume,11.36);
});

test('APEX-AUDIT-009: minimum lot is never rounded up to when it exceeds the budget',{skip},()=>{
  const r=R.min_lot_margin_exceeds_budget;
  assert.equal(r.v371Volume,0.1,'v3.7.1 must reproduce the audit evidence (0.1 lots needing 10 on a 1.5 budget)');
  assert.equal(r.v380Volume,0);
  // v3.8.2 prices the minimum lot with the TRUSTED margin (880.22/lot here), so the
  // refusal is stated against the margin actually required, not the understated one.
  assert.match(r.block,/MIN_LOT_TRUSTED_MARGIN_88\.02_EXCEEDS_BUDGET_1\.50/);
});

test('APEX-AUDIT-009: volume precision follows the real step, including .25 and non-decimal steps',{skip},()=>{
  const q=R.quarter_volume_step, n=R.nondecimal_volume_step;
  assert.equal(R.vol_digits_quarter_step.v371Digits,1,'v3.7.1 derived 1 decimal for a .25 step');
  assert.equal(R.vol_digits_quarter_step.v380Digits,2);
  // v3.7.1 produced 9.80, which is not on the 0.25 grid at all
  assert.ok(Math.abs(q.v371Volume/0.25-Math.round(q.v371Volume/0.25))>1e-9,'v3.7.1 must produce an off-grid volume');
  assert.ok(Math.abs(q.v380Volume/0.25-Math.round(q.v380Volume/0.25))<1e-9,'v3.8.0 volume must sit on the 0.25 grid');
  assert.equal(R.vol_digits_nondecimal_step.v371Digits,3);
  assert.equal(R.vol_digits_nondecimal_step.v380Digits,5);
  assert.ok(Math.abs(n.v380Volume/0.00125-Math.round(n.v380Volume/0.00125))<1e-9,'v3.8.0 volume must sit on the 0.00125 grid');
});

test('APEX-AUDIT-014: owner exposure controls are opt-in and disabled by default',{skip},()=>{
  const r=R.owner_caps_opt_in;
  assert.equal(r.defaultVolume,11.36,'default config must not cap anything');
  assert.equal(r.cappedVolume,2,'a cap only applies once the owner sets one');
});

test('POST-AUDIT-LIVE-001 Case B: a size-only broker rejection is stepped down, not discarded',{skip},()=>{
  const r=R.broker_rejects_client_approved_size;
  assert.equal(r.v371Volume,200,'v3.7.1 would still send 200 lots');
  // v3.8.2 asks for 15% of real capacity up front, so the request is already executable.
  assert.equal(r.v380InitialVolume,0.16);
  assert.equal(r.gaveUp,false,'the still-valid setup must not be thrown away');
  assert.ok(r.filledVolume>0);
  assert.ok(r.filledVolume<=r.serverAffordable,'the filled size must be genuinely executable');
  // THE POINT: a NORMAL 15% request must not become ~100% of capacity by halving down.
  // v3.7.1 needed 9 probes to land on 0.78 -- 69% of the 1.136-lot true capacity while
  // the policy only ever asked for 15%. v3.8.2 sends one correct size.
  assert.equal(r.attempts,1,'no semantic step-down: the intended tier is sent once');
  assert.ok(r.filledVolume/r.serverAffordable<0.25,
    'the executed size must still represent the requested percentage, not near-full capacity');
  assert.ok(r.v371Filled/r.serverAffordable>0.5,'v3.7.1 must reproduce the runaway allocation');
});

test('APEX-AUDIT-001: identical closed bars, three live quotes -> only the in-zone quote may execute',{skip},()=>{
  assert.equal(R.gate_in_zone_quote.ok,true);
  assert.equal(R.gate_reclaimed_extreme.ok,false);
  assert.equal(R.gate_reclaimed_extreme.reclaimed,true);
  assert.match(R.gate_reclaimed_extreme.reason,/RECLAIMED_INVALIDATION_LEVEL/);
});

test('APEX-AUDIT-001: the extension threshold is measured always and enforced only when the owner opts in',{skip},()=>{
  const shadow=R.gate_extended_chase_shadow, enforced=R.gate_extended_chase_enforced;
  assert.equal(shadow.extended,true,'the distance must always be measured');
  assert.equal(shadow.ok,true,'SHADOW must never block -- it is an unvalidated threshold');
  assert.equal(enforced.ok,false,'GATE_ENFORCE must block the same quote');
  assert.equal(shadow.extensionAtr,5);
});

test('APEX-AUDIT-001: a stored valid candle pattern cannot authorise an entry after a newer bar closed',{skip},()=>{
  assert.equal(R.gate_stale_trigger_bar.ok,false);
  assert.equal(R.gate_stale_trigger_bar.triggerStale,true);
});

test('APEX-AUDIT-001: stale-quote rejection is off by default and works when enabled',{skip},()=>{
  assert.equal(R.gate_stale_quote.ok,false);
  assert.equal(R.gate_stale_quote.quoteStale,true);
  assert.equal(R.gate_in_zone_quote.quoteStale,false,'default config must not reject on quote age');
});

test('native harness availability is reported honestly',()=>{
  if(!has)console.warn('NATIVE HARNESS SKIPPED:',run.skipped);
  assert.ok(has||findCxx()===null,'harness must only skip when no C++ toolchain exists');
});
