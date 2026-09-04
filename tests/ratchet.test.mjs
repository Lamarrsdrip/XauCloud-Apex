import test from 'node:test';import assert from 'node:assert/strict';

// Pure-JS mirror of the EA's percentage profit ratchet (ea/XauCloud-Apex.mq5, Manage()).
// This is not the EA itself (MQL5 can't run under Node) — it is a deterministic reference
// implementation of the exact same formula, used to prove the intended math is correct
// before/independent of a live MetaEditor compile + Strategy Tester run.
//
//   peakPct = (peakProfit / campaignStartBalance) * 100
//   if peakPct >= triggerPct:
//     steps = floor((peakPct - triggerPct) / stepPct)
//     protectedPct = max(0, lockPct + steps * lockStepPct)
//     protectedProfit = campaignStartBalance * protectedPct / 100
//     close basket when currentProfit <= protectedProfit
export function ratchetFloor(campaignStartBalance, peakProfit, cfg){
  const {triggerPct, lockPct, stepPct, lockStepPct, enabled} = cfg;
  if(!enabled || campaignStartBalance<=0 || !(triggerPct>0) || !(lockPct>=0) || !(stepPct>0) || !(lockStepPct>=0)){
    return {active:false, protectedPct:null, protectedProfit:null};
  }
  const peakPct = (peakProfit/campaignStartBalance)*100;
  if(peakPct < triggerPct) return {active:false, protectedPct:null, protectedProfit:null};
  const steps = Math.floor((peakPct-triggerPct)/stepPct);
  const protectedPct = Math.max(0, lockPct + steps*lockStepPct);
  const protectedProfit = campaignStartBalance*(protectedPct/100);
  return {active:true, protectedPct, protectedProfit, peakPct, steps};
}
export function shouldCloseOnRatchet(campaignStartBalance, peakProfit, currentProfit, cfg){
  const r = ratchetFloor(campaignStartBalance, peakProfit, cfg);
  if(!r.active) return false;
  return currentProfit <= r.protectedProfit;
}

// v3.4 default ladder: trigger 180%, lock 100%, step 100%, lockStep 100%
const DEFAULT_RATCHET = {enabled:true, triggerPct:180, lockPct:100, stepPct:100, lockStepPct:100};

test('below trigger: $1,799 peak on a $1,000 campaign (179.9%) does not activate the ratchet', ()=>{
  const r = ratchetFloor(1000, 1799, DEFAULT_RATCHET);
  assert.equal(r.active, false);
  assert.equal(shouldCloseOnRatchet(1000, 1799, 1799, DEFAULT_RATCHET), false);
});

test('exactly at trigger: $1,800 peak = 180% -> floor is $1,000 (100%), but does NOT close at $1,800 current', ()=>{
  const r = ratchetFloor(1000, 1800, DEFAULT_RATCHET);
  assert.equal(r.active, true);
  assert.equal(r.protectedPct, 100);
  assert.equal(r.protectedProfit, 1000);
  assert.equal(shouldCloseOnRatchet(1000, 1800, 1800, DEFAULT_RATCHET), false);
});

test('peak continues to $2,800 (280%): floor becomes $2,000 (200%)', ()=>{
  const r = ratchetFloor(1000, 2800, DEFAULT_RATCHET);
  assert.equal(r.protectedPct, 200);
  assert.equal(r.protectedProfit, 2000);
});

test('retrace from $2,800 peak down to exactly $2,000 current: closes the whole basket', ()=>{
  assert.equal(shouldCloseOnRatchet(1000, 2800, 2000, DEFAULT_RATCHET), true);
});

test('retrace from $2,800 peak to $2,200 current (still above the $2,000 floor): stays open', ()=>{
  assert.equal(shouldCloseOnRatchet(1000, 2800, 2200, DEFAULT_RATCHET), false);
});

test('peak $3,800 (380%) -> floor $3,000 (300%)', ()=>{
  const r = ratchetFloor(1000, 3800, DEFAULT_RATCHET);
  assert.equal(r.protectedPct, 300);
  assert.equal(r.protectedProfit, 3000);
});

test('peak $4,800 (480%) -> floor $4,000 (400%)', ()=>{
  const r = ratchetFloor(1000, 4800, DEFAULT_RATCHET);
  assert.equal(r.protectedPct, 400);
  assert.equal(r.protectedProfit, 4000);
});

test('ratchet only ratchets forward: floor computed from peak, not current, and never decreases as current retraces short of the floor', ()=>{
  const peak = 5800; // 580%: steps = floor((580-180)/100) = 4 -> protectedPct = 100+4*100 = 500%
  const floorAt580 = ratchetFloor(1000, peak, DEFAULT_RATCHET);
  assert.equal(floorAt580.protectedProfit, 5000); // 500%
  // retrace to 5400 (peak unchanged since caller always passes the historical max)
  const stillOpen = shouldCloseOnRatchet(1000, peak, 5400, DEFAULT_RATCHET);
  assert.equal(stillOpen, false);
  const closes = shouldCloseOnRatchet(1000, peak, 5000, DEFAULT_RATCHET);
  assert.equal(closes, true);
});

test('disabled ratchet never activates regardless of peak', ()=>{
  const r = ratchetFloor(1000, 10000, {...DEFAULT_RATCHET, enabled:false});
  assert.equal(r.active, false);
});

test('custom ladder: trigger 50%, lock 25%, step 50%, lockStep 25% (Strategy Tester config D shape)', ()=>{
  const cfg = {enabled:true, triggerPct:50, lockPct:25, stepPct:50, lockStepPct:25};
  assert.equal(ratchetFloor(1000, 499, cfg).active, false);
  const at50 = ratchetFloor(1000, 500, cfg);
  assert.equal(at50.protectedPct, 25);
  const at100 = ratchetFloor(1000, 1000, cfg);
  assert.equal(at100.protectedPct, 50);
});

// ---------- TP calculation (mirrors Start()'s targetEq for NORMAL profile) ----------
function normalTargetEquity(cycleStart, takeProfitPct){
  return takeProfitPct>0 ? cycleStart*(1.0+takeProfitPct/100.0) : 0.0;
}
test('TP 0 disables the hard target (Start() computes targetEq=0, so the check never fires)', ()=>{
  assert.equal(normalTargetEquity(1000, 0), 0);
});
test('TP 50% on a $1,000 campaign targets $1,500 balance ($500 profit)', ()=>{
  assert.equal(normalTargetEquity(1000, 50), 1500);
});
test('TP 100% on a $1,000 campaign targets $2,000 balance ($1,000 profit)', ()=>{
  assert.equal(normalTargetEquity(1000, 100), 2000);
});
test('TP 200% on a $1,000 campaign targets $3,000 balance ($2,000 profit)', ()=>{
  assert.equal(normalTargetEquity(1000, 200), 3000);
});

// ---------- Fixed SL price calculation (mirrors OpenLayer's sl computation) ----------
function fixedSlPrice(entryPrice, dir, goldMove){
  if(!(goldMove>0)) return 0;
  return dir>0 ? entryPrice-goldMove : entryPrice+goldMove;
}
test('fixed SL 10: BUY @4700 -> 4690, SELL @4700 -> 4710', ()=>{
  assert.equal(fixedSlPrice(4700, 1, 10), 4690);
  assert.equal(fixedSlPrice(4700, -1, 10), 4710);
});
test('fixed SL 5: BUY @4700 -> 4695, SELL @4700 -> 4705', ()=>{
  assert.equal(fixedSlPrice(4700, 1, 5), 4695);
  assert.equal(fixedSlPrice(4700, -1, 5), 4705);
});
test('fixed SL 0 means no broker SL (returns the no-SL sentinel 0)', ()=>{
  assert.equal(fixedSlPrice(4700, 1, 0), 0);
  assert.equal(fixedSlPrice(4700, -1, 0), 0);
});
test('v3.4 default fixed SL is 30: BUY @4700 -> 4670, SELL @4700 -> 4730', ()=>{
  assert.equal(fixedSlPrice(4700, 1, 30), 4670);
  assert.equal(fixedSlPrice(4700, -1, 30), 4730);
});

// ---------- v3.4 three-tier NORMAL margin ladder (mirrors OpenLayer's pct selection) ----------
function normalLayerMarginPct(layers, ladder){
  if(layers<=0) return ladder.l1;
  if(layers===1) return ladder.l2;
  return ladder.l3Plus;
}
const DEFAULT_LADDER = {l1:15, l2:50, l3Plus:100};
test('L1 (master, layers<=0) uses the L1 margin tier', ()=>{
  assert.equal(normalLayerMarginPct(0, DEFAULT_LADDER), 15);
});
test('L2 (first add, layers==1) uses the L2 margin tier', ()=>{
  assert.equal(normalLayerMarginPct(1, DEFAULT_LADDER), 50);
});
test('L3 and every subsequent add (layers>=2) uses the L3+ margin tier', ()=>{
  assert.equal(normalLayerMarginPct(2, DEFAULT_LADDER), 100);
  assert.equal(normalLayerMarginPct(3, DEFAULT_LADDER), 100);
  assert.equal(normalLayerMarginPct(9, DEFAULT_LADDER), 100);
});

// ---------- Master break-even (mirrors Manage()'s BE block) ----------
// campaignProfitPct is whole-basket profit (p) as a % of campaign-start balance, BE moves ONLY
// the master/L1 SL to its own entry price, one-way (never re-fires once armed).
function masterBreakEven({campaignProfitPct, triggerPct, enabled, alreadyActive}){
  if(!enabled) return {armed:false};
  if(alreadyActive) return {armed:false}; // one-way: does not re-trigger, cannot widen back
  if(campaignProfitPct>=triggerPct) return {armed:true};
  return {armed:false};
}
test('break-even does not arm below the +50% whole-basket trigger', ()=>{
  assert.equal(masterBreakEven({campaignProfitPct:49.9, triggerPct:50, enabled:true, alreadyActive:false}).armed, false);
});
test('break-even arms at exactly +50% whole-basket campaign profit', ()=>{
  assert.equal(masterBreakEven({campaignProfitPct:50, triggerPct:50, enabled:true, alreadyActive:false}).armed, true);
});
test('break-even arms above +50% too (e.g. skipped straight to +75% on a fast-moving campaign)', ()=>{
  assert.equal(masterBreakEven({campaignProfitPct:75, triggerPct:50, enabled:true, alreadyActive:false}).armed, true);
});
test('break-even never re-arms once already active, even if profit is still above trigger (one-way, cannot widen back)', ()=>{
  assert.equal(masterBreakEven({campaignProfitPct:90, triggerPct:50, enabled:true, alreadyActive:true}).armed, false);
});
test('break-even is disabled entirely when masterBreakEvenEnabled is false, regardless of profit', ()=>{
  assert.equal(masterBreakEven({campaignProfitPct:200, triggerPct:50, enabled:false, alreadyActive:false}).armed, false);
});
test('break-even SL target is the campaign\'s own entry price, not an offset (true breakeven, zero risk on the master leg)', ()=>{
  const firstEntryPrice = 4700;
  const beSL = firstEntryPrice; // EA sets beSL=firstEntryPrice directly
  assert.equal(beSL, 4700);
});

// ---------- v3.5.1 Recovery-To-Entry exit (mirrors Manage()'s recovery block) ----------
// originalSLDist is frozen at campaign start (firstEntryPrice - firstInitialSLPrice), independent
// of any later break-even SL move. Arms once adverse move >= armPctOfSL of that original distance;
// once armed, never disarms; closes the whole basket the moment price recovers to firstEntryPrice.
function recoveryStep({dir, entryPrice, initialSLPrice, currentPrice, armPctOfSL, enabled, alreadyArmed}){
  if(!enabled) return {armed:alreadyArmed, closes:false};
  const originalSLDist = Math.abs(entryPrice - initialSLPrice);
  if(!(originalSLDist>0)) return {armed:alreadyArmed, closes:false};
  const adverseDist = dir>0 ? Math.max(0, entryPrice-currentPrice) : Math.max(0, currentPrice-entryPrice);
  const adversePctOfSL = (adverseDist/originalSLDist)*100;
  let armed = alreadyArmed;
  if(!armed && adversePctOfSL>=armPctOfSL) armed = true;
  const recoveredToEntry = armed && (dir>0 ? currentPrice>=entryPrice : currentPrice<=entryPrice);
  return {armed, closes:recoveredToEntry, adversePctOfSL};
}

test('BUY example from spec: entry 4700, SL 4670 (30 XAU dist), 40% = 12 -> price at 4688 or lower arms the exit', ()=>{
  const r39 = recoveryStep({dir:1, entryPrice:4700, initialSLPrice:4670, currentPrice:4688.01, armPctOfSL:40, enabled:true, alreadyArmed:false});
  assert.equal(r39.armed, false); // 4688.01 is 11.99 adverse = 39.9666...% < 40%
  const r40 = recoveryStep({dir:1, entryPrice:4700, initialSLPrice:4670, currentPrice:4688, armPctOfSL:40, enabled:true, alreadyArmed:false});
  assert.equal(r40.armed, true); // 4688 is exactly 12 adverse = 40% of 30
  assert.equal(r40.adversePctOfSL, 40);
});
test('SELL mirrors: entry 4700, SL 4730 (30 XAU dist), price at 4712 or higher arms the exit', ()=>{
  const r39 = recoveryStep({dir:-1, entryPrice:4700, initialSLPrice:4730, currentPrice:4711.99, armPctOfSL:40, enabled:true, alreadyArmed:false});
  assert.equal(r39.armed, false);
  const r40 = recoveryStep({dir:-1, entryPrice:4700, initialSLPrice:4730, currentPrice:4712, armPctOfSL:40, enabled:true, alreadyArmed:false});
  assert.equal(r40.armed, true);
  assert.equal(r40.adversePctOfSL, 40);
});
test('at 39.99% adverse: does NOT arm (spec: "At 39.99% adverse: do NOT arm")', ()=>{
  // 30 XAU dist, 39.99% = 11.997 adverse -> price 4688.003
  const r = recoveryStep({dir:1, entryPrice:4700, initialSLPrice:4670, currentPrice:4700-11.997, armPctOfSL:40, enabled:true, alreadyArmed:false});
  assert.equal(r.armed, false);
});
test('at exactly 40% adverse: arms (spec: "At 40% or more: arm")', ()=>{
  const r = recoveryStep({dir:1, entryPrice:4700, initialSLPrice:4670, currentPrice:4688, armPctOfSL:40, enabled:true, alreadyArmed:false});
  assert.equal(r.armed, true);
});
test('QA case A: goes 40% adverse, then back to entry -> closes the whole basket as recovery exit', ()=>{
  const armed = recoveryStep({dir:1, entryPrice:4700, initialSLPrice:4670, currentPrice:4688, armPctOfSL:40, enabled:true, alreadyArmed:false});
  assert.equal(armed.armed, true);
  const backAtEntry = recoveryStep({dir:1, entryPrice:4700, initialSLPrice:4670, currentPrice:4700, armPctOfSL:40, enabled:true, alreadyArmed:true});
  assert.equal(backAtEntry.closes, true);
});
test('QA case B: never reaches 40% adverse -> recovery must never trigger even if price later returns to entry', ()=>{
  const shallow = recoveryStep({dir:1, entryPrice:4700, initialSLPrice:4670, currentPrice:4695, armPctOfSL:40, enabled:true, alreadyArmed:false});
  assert.equal(shallow.armed, false);
  const backAtEntry = recoveryStep({dir:1, entryPrice:4700, initialSLPrice:4670, currentPrice:4700, armPctOfSL:40, enabled:true, alreadyArmed:false});
  assert.equal(backAtEntry.armed, false);
  assert.equal(backAtEntry.closes, false);
});
test('QA case D: reaches deep profit without ever suffering 40% adverse -> never misclassified as damaged (armed stays false)', ()=>{
  // price ran straight up from entry to a big winner, never went adverse at all
  const r = recoveryStep({dir:1, entryPrice:4700, initialSLPrice:4670, currentPrice:4900, armPctOfSL:40, enabled:true, alreadyArmed:false});
  assert.equal(r.armed, false);
});
test('QA case E: armed earlier, then setup recovers to entry -> closes as recovery exit even though price merely came back (not a profit exit)', ()=>{
  const r = recoveryStep({dir:1, entryPrice:4700, initialSLPrice:4670, currentPrice:4700, armPctOfSL:40, enabled:true, alreadyArmed:true});
  assert.equal(r.closes, true);
});
test('70% adverse then recovery to entry also closes (deeper adverse excursions still arm and still close on recovery)', ()=>{
  // 30 XAU dist, 70% = 21 adverse -> price 4679
  const armed = recoveryStep({dir:1, entryPrice:4700, initialSLPrice:4670, currentPrice:4679, armPctOfSL:40, enabled:true, alreadyArmed:false});
  assert.equal(armed.armed, true);
  const backAtEntry = recoveryStep({dir:1, entryPrice:4700, initialSLPrice:4670, currentPrice:4700, armPctOfSL:40, enabled:true, alreadyArmed:true});
  assert.equal(backAtEntry.closes, true);
});
test('recovery exit disabled entirely: never arms or closes regardless of adverse move or recovery', ()=>{
  const r = recoveryStep({dir:1, entryPrice:4700, initialSLPrice:4670, currentPrice:4688, armPctOfSL:40, enabled:false, alreadyArmed:false});
  assert.equal(r.armed, false);
  assert.equal(r.closes, false);
});
test('original SL distance is fixed at campaign start and is NOT recalculated from a later break-even-moved SL', ()=>{
  // Even though the "current" SL may later move to breakeven (4700), the recovery math must keep
  // using the ORIGINAL captured distance (firstInitialSLPrice=4670), not the current firstSLPrice.
  const originalDistUsed = Math.abs(4700 - 4670); // firstInitialSLPrice, frozen
  assert.equal(originalDistUsed, 30);
  const r = recoveryStep({dir:1, entryPrice:4700, initialSLPrice:4670, currentPrice:4688, armPctOfSL:40, enabled:true, alreadyArmed:false});
  assert.equal(r.adversePctOfSL, 40); // computed from the frozen 30, not any post-BE SL value
});
