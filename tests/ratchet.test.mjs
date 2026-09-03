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

const DEFAULT_RATCHET = {enabled:true, triggerPct:200, lockPct:100, stepPct:100, lockStepPct:100};

test('below trigger: $1,999 peak on a $1,000 campaign (199.9%) does not activate the ratchet', ()=>{
  const r = ratchetFloor(1000, 1999, DEFAULT_RATCHET);
  assert.equal(r.active, false);
  assert.equal(shouldCloseOnRatchet(1000, 1999, 1999, DEFAULT_RATCHET), false);
});

test('exactly at trigger: $2,000 peak = 200% -> floor is $1,000 (100%), but does NOT close at $2,000 current', ()=>{
  const r = ratchetFloor(1000, 2000, DEFAULT_RATCHET);
  assert.equal(r.active, true);
  assert.equal(r.protectedPct, 100);
  assert.equal(r.protectedProfit, 1000);
  assert.equal(shouldCloseOnRatchet(1000, 2000, 2000, DEFAULT_RATCHET), false);
});

test('peak continues to $3,000 (300%): floor becomes $2,000 (200%)', ()=>{
  const r = ratchetFloor(1000, 3000, DEFAULT_RATCHET);
  assert.equal(r.protectedPct, 200);
  assert.equal(r.protectedProfit, 2000);
});

test('retrace from $3,000 peak down to exactly $2,000 current: closes the whole basket', ()=>{
  assert.equal(shouldCloseOnRatchet(1000, 3000, 2000, DEFAULT_RATCHET), true);
});

test('retrace from $3,000 peak to $2,500 current (still above the $2,000 floor): stays open', ()=>{
  assert.equal(shouldCloseOnRatchet(1000, 3000, 2500, DEFAULT_RATCHET), false);
});

test('peak $4,000 (400%) -> floor $3,000 (300%)', ()=>{
  const r = ratchetFloor(1000, 4000, DEFAULT_RATCHET);
  assert.equal(r.protectedPct, 300);
  assert.equal(r.protectedProfit, 3000);
});

test('ratchet only ratchets forward: floor computed from peak, not current, and never decreases as current retraces short of the floor', ()=>{
  const peak = 6000; // 600%
  const floorAt600 = ratchetFloor(1000, peak, DEFAULT_RATCHET);
  assert.equal(floorAt600.protectedProfit, 5000); // 500%
  // retrace to 5600 (peak unchanged since caller always passes the historical max)
  const stillOpen = shouldCloseOnRatchet(1000, peak, 5600, DEFAULT_RATCHET);
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
