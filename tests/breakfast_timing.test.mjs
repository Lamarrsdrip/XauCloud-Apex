// v3.9.0 FailedBreakout — 3.8.9 faded every dip in a grind (25 Aug 05:00 tester).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const ea = fs.readFileSync(new URL('../ea/XauCloud-Apex.mq5', import.meta.url), 'utf8');
const server = fs.readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');

function reject({ dir, extreme, prior, zone, bars }) {
  let tagged = false, closedThroughPrior = false, failedHold = false;
  for (const b of bars) {
    if (dir < 0) {
      if (b.high >= extreme - zone) tagged = true;
      if (b.close < extreme && b.close < b.open) failedHold = true;
      if (b.close < prior && b.close < b.open) closedThroughPrior = true;
    } else {
      if (b.low <= extreme + zone) tagged = true;
      if (b.close > extreme && b.close > b.open) failedHold = true;
      if (b.close > prior && b.close > b.open) closedThroughPrior = true;
    }
  }
  const v388SameBar = bars.some((b) => dir < 0
    ? (b.high >= extreme - zone && b.close < prior)
    : (b.low <= extreme + zone && b.close > prior));
  return {
    v388: v388SameBar,
    v389: tagged && (failedHold || closedThroughPrior),
    v390: tagged && closedThroughPrior
  };
}

test('v3.9.0 identity and confirmation-is-entry', () => {
  assert.match(ea, /XauCloud-Apex_v3\.9\.0-FailedBreakout/);
  assert.match(ea, /#property version\s+"3\.900"/);
  assert.match(ea, /if\(s\.valid\) Start\(s\);/);
  assert.doesNotMatch(ea, /if\(s\.valid&&s\.inLocation\) Start\(s\)/);
});

test('score stays 76 — still not the delay', () => {
  assert.match(ea, /C\.entryScore=76/);
  assert.match(server, /entryScore:\{t:'num',d:76,min:40,max:100\}/);
});

test('25 Aug grind: a 1-bar dip below the wick is NOT a SELL', () => {
  // Sweep 4646, nearby pool 4644, tiny red close at 4645.2 — 3.8.9 took this.
  const r = reject({
    dir: -1, extreme: 4646, prior: 4644, zone: 0.5,
    bars: [{ open: 4645.8, close: 4645.2, high: 4646.1, low: 4645.0 }]
  });
  assert.equal(r.v389, true, '3.8.9 failedHold fired on the grind dip');
  assert.equal(r.v390, false, '3.9.0 requires close back through the pool at 4644');
});

test('failed breakout of the nearby pool still confirms without a full-impulse V-bar', () => {
  // Impulse 4340 -> 4354, nearby swing pool 4351, close back through 4351.
  const r = reject({
    dir: -1, extreme: 4354, prior: 4351, zone: 0.5,
    bars: [
      { open: 4353.8, close: 4353.2, high: 4354.1, low: 4353.0 },
      { open: 4353.0, close: 4350.4, high: 4353.2, low: 4350.1 }
    ]
  });
  assert.equal(r.v388, false, '3.8.8 needed one candle to close through 4340');
  assert.equal(r.v390, true, '3.9.0 takes the two-bar close through the 4351 pool');
});

test('BUY bounce through a nearby pool confirms; distant 70-bar prior is not required', () => {
  const r = reject({
    dir: 1, extreme: 3677, prior: 3680, zone: 0.5,
    bars: [{ open: 3678.2, close: 3680.4, high: 3680.8, low: 3677.1 }]
  });
  assert.equal(r.v390, true);
});

test('M3 bypass is gone — colour is a hard gate again', () => {
  assert.match(ea, /bool m3Gate=\(!C\.requireM3Confirm\)\|\|\(s\.m3Color&&\(!InpRequireFreshM3\|\|s\.m3Fresh\)\);/);
  assert.doesNotMatch(ea, /m1Displacement=rej && bos/);
  assert.doesNotMatch(ea, /\|\|s\.m3Bypass/);
});

test('same-run higher high is dead-thesis, not a fresh SELL', () => {
  assert.match(ea, /bool DeadThesisBlocks\(int dir,double newExtreme\)/);
  assert.match(ea, /RememberDeadThesis\(S\.dir,S\.extreme\)/);
  assert.match(ea, /if\(swept && !DeadThesisBlocks\(watchDir,ex\)\)/);
  assert.match(ea, /imp==g_deadDir && s\.impulseMult>=C\.impulseAtr/);
});

test('late confirm still blocked and liquidity stays nearby swing', () => {
  assert.match(ea, /s\.valid=s\.rejected&&s\.microBreak&&m3Gate&&m5Gate&&s\.score>=threshold&&!s\.extended/);
  assert.match(ea, /void LiquidityRefs\(MqlRates &m1\[\],double &ph,double &pl\)/);
  assert.doesNotMatch(ea, /for\(int i=9;i<80;i\+\+\)\{ph=MathMax/);
});
