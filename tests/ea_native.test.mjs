// Behavioural regression tests for the EA.
//
// These do NOT re-implement Apex logic. tests/native/build_and_run.mjs extracts the
// sizing and entry-gate functions VERBATIM from ea/XauCloud-Apex-v3.8.0.mq5 (and the
// v3.7.1 originals from ea/archive/), compiles them against a mock broker, and runs
// them. Each test therefore fails if the real .mq5 regresses.
//
// NOT a substitute for native MT5/broker validation -- see APEX_FIX_VALIDATION.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAndRun, findCxx } from './native/build_and_run.mjs';

const run=buildAndRun();
const has=Boolean(!run.skipped);
const R=run.byName||{};
const skip=has?false:`no C++ toolchain (${run.skipped})`;

test('POST-AUDIT-LIVE-001 / APEX-AUDIT-009: a NORMAL L1 15% request no longer collapses to SYMBOL_VOLUME_MAX',{skip},()=>{
  const r=R.live_exness_zero_margin_normal_L1;
  // v3.7.1 reproduction: the exact 200.00-lot request rejected on demo 476885386
  assert.equal(r.v371Volume,200,'v3.7.1 must reproduce the live 200-lot request');
  assert.equal(r.volMax,200);
  // v3.8.0: 15% of real capacity, not the broker-wide symbol maximum
  assert.equal(r.v380Volume,30);
  assert.ok(r.v380Volume<r.v371Volume);
});

test('POST-AUDIT-LIVE-001: the whole NORMAL ladder was collapsed to one value, and is restored',{skip},()=>{
  const l1=R.live_exness_zero_margin_normal_L1,l2=R.live_exness_zero_margin_normal_L2,l3=R.live_exness_zero_margin_normal_L3;
  // v3.7.1: 15%, 50% and 100% all produced the identical volume -- the ladder was inert
  assert.equal(l1.v371Volume,l2.v371Volume);
  assert.equal(l2.v371Volume,l3.v371Volume);
  // v3.8.0: the configured ladder is visible again
  assert.equal(l1.v380Volume,30);
  assert.equal(l2.v380Volume,100);
  assert.equal(l3.v380Volume,200);
});

test('UNLIMITED profile keeps its aggressive full allocation (not neutered by the NORMAL repair)',{skip},()=>{
  assert.equal(R.unlimited_profile_full_allocation.v380Volume,200);
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
  assert.match(r.block,/MIN_LOT_MARGIN_10\.00_EXCEEDS_BUDGET_1\.50/);
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
  assert.equal(r.v380InitialVolume,30);
  assert.equal(r.gaveUp,false,'the still-valid setup must not be thrown away');
  assert.ok(r.filledVolume>0);
  assert.ok(r.filledVolume<=r.serverAffordable,'the filled size must be genuinely executable');
  assert.ok(r.attempts<=10);
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
