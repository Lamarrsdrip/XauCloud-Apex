import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeNativeEvidence, canonicalSourceCommit, canonicalSourceSha256 } from '../apex4-canonical-evidence.mjs';
import { resolveHourlyBias } from '../xaucloud/marketOutlookSignal.ts';

const now = Date.parse('2026-11-26T10:00:12Z');
const quote = { bid: 3640.02, ask: 3640.21, at: new Date(now).toISOString() };
const context = { account: '426001', brokerServer: 'Exness-MT5Trial9', quote, now };
const native = {
  schema: 'XAUCLOUD_CANONICAL_M10_EVIDENCE_V1', environment: 'DEMO', account: context.account,
  sourceCommit: canonicalSourceCommit, sourceSha256: canonicalSourceSha256,
  symbol: 'XAUUSD', brokerSymbol: 'XAUUSDm', brokerServer: context.brokerServer,
  quote: { bid: quote.bid, ask: quote.ask, atMs: now }, observedAt: now, htfComplete: true,
  m10Signal: {
    primary_timeframe: 'M10', freshness_state: 'FRESH', evidence_id: 42, symbol: 'XAUUSDm', account: context.account,
    build_hash: 'xaucloud-v6291-signal-plan-execution-20261127', bar_time: '2026.11.26 09:50',
    preferred_direction: 'BUY', decision: 'BUY_CANDIDATE', confidence: 81, buy_pressure: 75, sell_pressure: 40,
  },
  entryReadiness: { candidate_id: 'first-candidate', final_decision: 'BLOCKED', blocked_by: 'PERM_BLOCK_ASIA_NON_A_PLUS' },
  thesis: { structure: 'STRUCTURE_SUPPORTS', buy_pressure: 78, sell_pressure: 38 },
};

test('native evidence preserves original M10 direction, confidence and hard blocker', () => {
  const evidence = normalizeNativeEvidence(native, context)!;
  assert.ok(evidence);
  assert.equal(evidence.canonicalM10.direction, 'BUY');
  assert.equal(evidence.canonicalM10.blocker_code, 'PERM_BLOCK_ASIA_NON_A_PLUS');
  assert.equal(evidence.canonicalM10.actionable, false);
  assert.equal(evidence.thesis.buy_pressure, 78);
  assert.equal(resolveHourlyBias(evidence.canonicalM10, evidence.thesis).confidence, 81);
});

test('native reader rejects foreign, stale and simulated packets on the demo trading path', () => {
  for (const override of [{ sourceSha256: 'bad' }, { brokerServer: 'DifferentBroker' }, { htfComplete: false },
    { environment: 'TESTER' }, { account: '426002' }, { quote: { ...native.quote, ask: 3640.29 } },
    { m10Signal: { ...native.m10Signal, freshness_state: 'DEGRADED' } }]) {
    assert.equal(normalizeNativeEvidence({ ...native, ...override }, context), undefined);
  }
  assert.equal(normalizeNativeEvidence(native, { ...context, now: now + 3001 }), undefined);
  assert.equal(normalizeNativeEvidence(native, { ...context, brokerServer: undefined }), undefined);
  assert.equal(normalizeNativeEvidence(native, { ...context, now: Number.NaN }), undefined);
  assert.equal(normalizeNativeEvidence(native, { ...context, quote: { ...quote, ask: Number.NaN } }), undefined);
  assert.ok(normalizeNativeEvidence({ ...native, environment: 'TESTER' }, { ...context, environment: 'TESTER' }));
});
