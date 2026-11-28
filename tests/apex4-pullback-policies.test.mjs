import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pullbackStop, replayPullbackPolicy, summarizePullbackPolicies } from '../research/apex4-pullback-exits.mjs';

const min = 60_000;
const plan = {
  side: 'BUY', entry: 101, sl: 99, tp1: 103, tp2: 105, published: 0, group: 'FIXTURE',
};
const candle = (i, o, h, l, c) => ({ t: i * min, o, h, l, c });
const replay = (bars, options = {}, setup = plan) => replayPullbackPolicy(setup, bars, {
  spread: 0, slippage: 0, commissionPerOunce: 0, horizonMinutes: bars.length, ...options,
});

test('preserves stop-first semantics and models worse open gap fills', () => {
  const ambiguous = [candle(0, 101, 105, 98, 104)];
  const stop = replay(ambiguous);
  assert.equal(stop.r, -1);
  assert.equal(stop.tp1, false);
  assert.equal(stop.completion, 'SL');
  const path = [candle(0, 101, 102, 100, 101), candle(1, 98.5, 102, 97, 99)];
  assert.equal(replay(path).r, -1.25);
  assert.equal(replay(path, { gapStop: 'STOP_PRICE' }).r, -1);
});

test('closes the full position at TP1 or splits risk across TP1 and TP2', () => {
  const path = [candle(0, 101, 103, 100, 102), candle(1, 102, 105, 100, 105)];
  assert.equal(replay(path, { management: 'TP1' }).r, 1);
  const partial = replay(path, { management: 'PARTIAL' });
  assert.equal(partial.r, 1.5);
  assert.equal(partial.tp1Minutes, 1);
  assert.equal(partial.tp2Minutes, 2);
});

test('moves the remaining stop after the TP1 bar and accounts for costs once', () => {
  const path = [candle(0, 100.9, 103, 100, 102), candle(1, 102, 103, 101, 102)];
  const result = replay(path, {
    management: 'PARTIAL_PROTECTED', spread: .1, slippage: .1, commissionPerOunce: .1,
  });
  assert.equal(result.completion, 'SL');
  assert.equal(result.tp1Minutes, 1);
  assert.ok(Math.abs(result.netPrice - .85) < 1e-10);
  assert.ok(Math.abs(result.stopDistance - 2.1) < 1e-10);
});

test('uses ask to trigger SELL exits and charge fill slippage and commission', () => {
  const short = { ...plan, side: 'SELL', entry: 101, sl: 103, tp1: 99, tp2: 97 };
  const path = [candle(0, 101, 102.85, 99, 100)];
  const touched = replay(path, { spread: .2, slippage: .05, commissionPerOunce: .07 }, short);
  assert.equal(touched.completion, 'SL');
  assert.ok(Math.abs(touched.netPrice - (-2.17)) < 1e-10);
  assert.equal(touched.tp1, false);
});

test('retains opportunities missed through waiting or limit nonfill', () => {
  const wonBeforeEntry = [candle(0, 101, 105, 100, 104), candle(1, 104, 106, 103, 106)];
  const delayed = replay(wonBeforeEntry, { entryDelayMinutes: 1 });
  assert.equal(delayed.status, 'TARGET_BEFORE_ENTRY');
  assert.equal(replay(wonBeforeEntry, { entryLimit: { price: 100, validMinutes: 1 } }).status, 'TARGET_BEFORE_ENTRY');
  const summary = summarizePullbackPolicies([replay(wonBeforeEntry), delayed, { status: 'CENSORED' }]);
  assert.equal(summary.opportunities, 3);
  assert.equal(summary.evaluable, 2);
  assert.equal(summary.n, 1);
  assert.equal(summary.expectancyPerOpportunityR, 1);
  assert.equal(summary.expectancyR, 2);
});

test('an intrabar limit gets no target credit when the order of movements is unknown', () => {
  const ambiguous = [candle(0, 101, 105, 99.9, 102)];
  const filled = replay(ambiguous, { entryLimit: { price: 100, validMinutes: 1 } });
  assert.equal(filled.entry, 100);
  assert.equal(filled.completion, 'TIME');
  assert.equal(filled.tp2, false);
  assert.equal(filled.netPrice, 2);
  const stop = replay([candle(0, 101, 105, 98.9, 102)], { entryLimit: { price: 100, validMinutes: 1 } });
  assert.equal(stop.completion, 'SL');
});

test('requires a genuine session endpoint for open positions', () => {
  const path = [candle(0, 101, 102, 100, 101), candle(1, 101, 102, 100, 102)];
  const capped = replay(path, { horizonMinutes: null, sessionEnd: 2 * min, evaluationEnd: 2 * min });
  assert.equal(capped.completion, 'SESSION_END');
  const incomplete = replay(path, { horizonMinutes: null, sessionEnd: 3 * min, evaluationEnd: 2 * min });
  assert.equal(incomplete.status, 'CENSORED');
});

test('derives candidate stops exclusively from candles closed before publication', () => {
  const bars = Array.from({ length: 35 }, (_, i) => candle(i, 101, 102, i === 25 ? 98 : 100, 101));
  const setup = { ...plan, published: 29 * min };
  const poisonedFuture = bars.map((bar, i) => i >= 29 ? { ...bar, l: 10 } : bar);
  for (const kind of ['STRUCTURAL', 'VOLATILITY']) {
    const stop = pullbackStop(setup, bars, { kind, spread: .3 });
    assert.ok(Number.isFinite(stop) && stop < 100);
    assert.equal(stop, pullbackStop(setup, poisonedFuture, { kind, spread: .3 }));
  }
});

test('momentum deterioration submits at the next open after two completed adverse closes', () => {
  const path = [
    candle(0, 101, 103, 100, 103), candle(1, 103, 103, 102, 102.5),
    candle(2, 102.5, 102.5, 102, 102), candle(3, 101.5, 105, 100, 105),
  ];
  const result = replay(path, { management: 'MOMENTUM' });
  assert.equal(result.completion, 'MOMENTUM');
  assert.equal(result.exit, 101.5);
  assert.equal(result.tp2, false);
});

test('the remaining trailing stop activates after the completed bar', () => {
  const path = [candle(0, 101, 104, 100, 103), candle(1, 103, 104.5, 102, 104)];
  const result = replay(path, { management: 'TRAIL' });
  assert.equal(result.completion, 'SL');
  assert.equal(result.exit, 103);
  assert.equal(result.r, 1);
});
