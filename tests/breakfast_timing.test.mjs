// v3.8.9 BreakfastTiming — proves the detector change that live demo needed.
// Score reduction is NOT the fix: once rejection+BOS+M3 pass, the floor is already
// above 76. The miss was the rejection predicate and the M3 wait.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const ea = fs.readFileSync(new URL('../ea/XauCloud-Apex.mq5', import.meta.url), 'utf8');
const server = fs.readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');

function breakfastReject({ dir, extreme, prior, zone, bars }) {
  // Mirror of Observe() rejection: tagged AND (failedHold OR closedThroughPrior).
  let tagged = false, failedHold = false, closedThroughPrior = false;
  for (const b of bars) {
    if (dir < 0) {
      if (b.high >= extreme - zone) tagged = true;
      if (b.close < extreme && b.close < b.open) failedHold = true;
      if (b.close < prior) closedThroughPrior = true;
    } else {
      if (b.low <= extreme + zone) tagged = true;
      if (b.close > extreme && b.close > b.open) failedHold = true;
      if (b.close > prior) closedThroughPrior = true;
    }
  }
  const oldSameBar = bars.some((b) => dir < 0
    ? (b.high >= extreme - zone && b.close < prior)
    : (b.low <= extreme + zone && b.close > prior));
  return {
    old: oldSameBar,
    neu: tagged && (failedHold || closedThroughPrior),
    tagged, failedHold, closedThroughPrior
  };
}

test('v3.8.9 keeps confirmation-is-entry and does not resurrect MODEL C wait', () => {
  assert.match(ea, /if\(s\.valid\) Start\(s\);/);
  assert.doesNotMatch(ea, /if\(s\.valid&&s\.inLocation\) Start\(s\)/);
  assert.doesNotMatch(ea, /RETEST_EXECUTABLE/);
  assert.match(ea, /XauCloud-Apex_v3\.8\.9-BreakfastTiming/);
});

test('v3.8.9 did NOT lower entryScore — the score was never the delay', () => {
  assert.match(ea, /C\.entryScore=76/);
  assert.match(server, /entryScore:\{t:'num',d:76,min:40,max:100\}/);
});

test('SELL breakfast: failed hold at the high confirms without a full-impulse V-bar', () => {
  // Impulse ran 4340 -> 4354. Old prior is the pre-impulse high (4340).
  // Breakfast rejection is a bearish close back through 4354, still tagging the zone.
  const r = breakfastReject({
    dir: -1, extreme: 4354, prior: 4340, zone: 0.5,
    bars: [{ open: 4353.8, close: 4352.4, high: 4354.1, low: 4352.2 }]
  });
  assert.equal(r.old, false, 'old rule missed this — close did not retrace to 4340');
  assert.equal(r.neu, true, 'new rule takes the failed hold at the swept high');
});

test('BUY breakfast: bounce at swept lows confirms without a V-reversal through old prior', () => {
  const r = breakfastReject({
    dir: 1, extreme: 3677, prior: 3695, zone: 0.5,
    bars: [{ open: 3678.2, close: 3680.4, high: 3680.8, low: 3677.1 }]
  });
  assert.equal(r.old, false, 'old rule needed close > 3695 on a bar that still tagged 3677');
  assert.equal(r.neu, true, 'new rule takes the demand bounce the chart circled');
});

test('late dump 2 ATR away still structurally rejects as extended in source', () => {
  assert.match(ea, /s\.valid=s\.rejected&&s\.microBreak&&m3Gate&&m5Gate&&s\.score>=threshold&&!s\.extended/);
  assert.match(ea, /CONFIRMED_BUT_EXTENDED_FROM_EXTREME/);
  assert.match(ea, /InpMaxEntryExtensionAtr/);
});

test('M3 colour may be bypassed by a strong M1 displacement, not by a weak one', () => {
  assert.match(ea, /s\.m3Bypass=C\.requireM3Confirm && m1Displacement && !m3StronglyAgainst/);
  assert.match(ea, /bool m3Gate=\(!C\.requireM3Confirm\)\|\|\(s\.m3Color&&\(!InpRequireFreshM3\|\|s\.m3Fresh\)\)\|\|s\.m3Bypass/);
  assert.match(ea, /m1Displacement=rej && bos && \(bestW>=0\.8 \|\| s\.impulseMult>=C\.impulseAtr\)/);
});

test('liquidity is a nearby swing with rolling 9-40 fallback, not max of bars 9-79', () => {
  assert.match(ea, /void LiquidityRefs\(MqlRates &m1\[\],double &ph,double &pl\)/);
  assert.match(ea, /int last=MathMin\(n-3,40\)/);
  assert.doesNotMatch(ea, /for\(int i=9;i<80;i\+\+\)\{ph=MathMax/);
});
