import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const ea = fs.readFileSync(new URL('../ea/XauCloud-Apex.mq5', import.meta.url), 'utf8');
const versioned = fs.readFileSync(new URL('../ea/XauCloud-Apex-v3.8.8-UnlimitedFromL3.mq5', import.meta.url), 'utf8');

function qualifies({ dir, extreme, prior, zone, bar }) {
  const body = Math.max(1e-9, Math.abs(bar.close - bar.open));
  const wick = dir < 0
    ? bar.high - Math.max(bar.open, bar.close)
    : Math.min(bar.open, bar.close) - bar.low;
  const ratio = wick / body;
  const structure = dir < 0
    ? (bar.high >= extreme - zone && bar.close < prior)
    : (bar.low <= extreme + zone && bar.close > prior);
  return structure && ratio >= 0.10;
}

test('canonical strategy is patched v3.8.8 and release copy is identical', () => {
  assert.match(ea, /XauCloud-Apex_v3\.8\.8-UnlimitedFromL3/);
  assert.match(ea, /#property version\s+"3\.880"/);
  assert.equal(ea, versioned);
  assert.doesNotMatch(ea, /BreakfastTiming|FailedBreakout/);
});

test('rejection-quality floor is exactly 0.10 and hard-gated', () => {
  assert.match(ea, /#define APEX_REJECTION_WICK_BODY_MIN 0\.10/);
  assert.match(ea, /rejectionWickRatio>=APEX_REJECTION_WICK_BODY_MIN/);
});

test('0.045 wick-body rejection is blocked', () => {
  assert.equal(qualifies({
    dir: -1, extreme: 4400, prior: 4399, zone: 0.5,
    bar: { open: 4400, close: 4398, high: 4400.09, low: 4397.8 }
  }), false);
});

test('0.172 wick-body rejection remains eligible', () => {
  assert.equal(qualifies({
    dir: -1, extreme: 4400, prior: 4399, zone: 0.5,
    bar: { open: 4400, close: 4398, high: 4400.344, low: 4397.8 }
  }), true);
});
