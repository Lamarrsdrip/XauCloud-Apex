import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { brainScope, createApexTradeBrain } from '../apex4-trade-brain.mjs';
import { buildLearningCandidate, evaluateLearningCandidate } from '../apex4-learning.mjs';

const key = 'APEX-SYNTHETIC-TEST-KEY';
const account = '42';
const scope = brainScope(key, account);
const minute = 60_000;
const epoch = Date.UTC(2025, 0, 1);
const quote = (at: number, bid = 100, ask = bid + .1) => ({ at: new Date(at).toISOString(), bid, ask });
const plan = (at: number, n = 1, group = 'pullback') => ({
  id: n.toString(16).padStart(24, '0'), kind: 'PULLBACK', side: 'BUY', entry: 100.1, sl: 99,
  tp1: 101, tp2: 102, expires: at + 12_000, group
});

function fixture(t: any, clock = () => epoch) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'apex4-brain-test-'));
  let brain = createApexTradeBrain(dir, { clock, slippage: .05, commission: .02 });
  t.after(() => { brain.close(); rmSync(dir, { recursive: true, force: true }); });
  return {
    get brain() { return brain; },
    restart() { brain.close(); brain = createApexTradeBrain(dir, { clock, slippage: .05, commission: .02 }); }
  };
}

test('committed observations, immutable completed bars and decision identity survive restart', (t) => {
  const f = fixture(t);
  const closed = { t: epoch - minute, o: 100, h: 101, l: 99, c: 100.5 };
  const open = { ...closed, t: epoch };
  const observation = f.brain.capture(key, account, { quote: quote(epoch), bars: [closed, open], metadata: { broker: 'Demo-9', leverage: 500 } });
  assert.deepEqual(observation.added, [closed]);
  f.brain.recordDecision(observation, { status: 'DEVELOPING', plan: null, researchPlan: plan(epoch), local: { confidence: 67 } });
  f.restart();
  const duplicate = f.brain.capture(key, account, { quote: quote(epoch), bars: [closed, open], metadata: { broker: 'Demo-9', leverage: 500 } });
  assert.equal(duplicate.id, observation.id);
  assert.equal(duplicate.duplicate, true);
  const second = f.brain.capture(key, account, { quote: quote(epoch + 1000), bars: [{ ...closed, c: 999 }], now: epoch + 1000 });
  assert.equal(second.added.length, 0);
  assert.equal(f.brain.recentBars(scope, epoch, observation.id)[0].c, closed.c);
  assert.equal(f.brain.decisionAt(observation).researchPlan.id, plan(epoch).id);
  assert.equal(f.brain.summary(scope).decisions, 1);
  assert.deepEqual(f.brain.latestMarket(key, account).quote, quote(epoch + 1000));
  assert.equal(f.brain.latestMarket('OTHER-KEY', account), null);
});

test('skipped research enters on a later executable quote and records TP1, TP2 and costs across restart', (t) => {
  const f = fixture(t);
  const capture = (at: number, bid?: number) => f.brain.capture(key, account, { quote: quote(at, bid), bars: [], now: at });
  const observation = capture(epoch);
  f.brain.recordDecision(observation, { status: 'PULLBACK_UNCALIBRATED', plan: null, researchPlan: plan(epoch) });
  assert.equal(f.brain.summary(scope).simulatedCases, 0);
  capture(epoch + 1000);
  capture(epoch + 4000, 100.05);
  capture(epoch + 7000, 101.2);
  f.restart();
  capture(epoch + 10_000, 102.5);
  const [lesson] = f.brain.recentLessons(scope);
  assert.equal(lesson.result, 'TP2');
  assert.equal(lesson.selected, false);
  assert.equal(lesson.source, 'SIMULATED_OBSERVED_QUOTES');
  assert.ok(lesson.mfeR > 0 && lesson.maeR > 0);
  assert.ok(lesson.r > 0);
  assert.equal(f.brain.summary(scope).brokerDeals, 0);
  capture(epoch + 11_000, 103);
  assert.equal(f.brain.summary(scope).simulatedCases, 1);
});

test('a long quote gap is recorded as missing coverage even when the first later quote is through TP2', (t) => {
  const f = fixture(t);
  const capture = (at: number, bid?: number) => f.brain.capture(key, account, { quote: quote(at, bid), bars: [], now: at });
  const first = capture(epoch);
  f.brain.recordDecision(first, { status: 'QUALIFIED', plan: plan(epoch), local: null });
  capture(epoch + 1000);
  f.restart();
  capture(epoch + 18_000, 104);
  assert.equal(f.brain.recentLessons(scope)[0].result, 'INSUFFICIENT_OBSERVATION');
  assert.equal(f.brain.recentLessons(scope)[0].r, null);
});

test('real reported deals recover from out-of-order delivery and deduplicate without counting research', (t) => {
  const f = fixture(t, () => epoch + 12_000);
  const first = f.brain.capture(key, account, { quote: quote(epoch), bars: [], now: epoch });
  f.brain.recordDecision(first, { status: 'QUALIFIED', plan: plan(epoch) }, { now: epoch });
  const core = { kind: 'DEAL', positionId: '9223372036854775810', direction: 'BUY',
    volume: .02, commission: -.10, swap: 0, profit: 0, fee: 0, reason: 'EXPERT' };
  const closing = { ...core, dealId: '9223372036854775812', entry: 'OUT', volume: .01, price: 101.2, atMs: epoch + 11_000, profit: 1, reason: 'TP' };
  const opening = { ...core, dealId: '9223372036854775811', planId: plan(epoch).id, entry: 'IN', price: 100.1, atMs: epoch + 1000 };
  assert.deepEqual(f.brain.recordBrokerEvents(key, account, [closing]), { accepted: 1, stored: 1 });
  assert.equal(f.brain.latestExecution(scope), null);
  f.restart();
  assert.deepEqual(f.brain.recordBrokerEvents(key, account, [opening, closing]), { accepted: 2, stored: 1 });
  f.brain.capture(key, account, { quote: quote(epoch + 2000, 99.8), bars: [], now: epoch + 2000 });
  f.brain.capture(key, account, { quote: quote(epoch + 5000, 101), bars: [], now: epoch + 5000 });
  const latest = f.brain.latestExecution(scope);
  assert.equal(latest.planId, plan(epoch).id);
  assert.equal(latest.closed, false);
  assert.equal(latest.sampledMarketQuotes, 2);
  assert.equal(latest.positionNet, .8);
  assert.ok(latest.mae > 0 && latest.mfe > 0);
  assert.equal(f.brain.summary(scope).brokerDeals, 2);
  assert.equal(f.brain.summary(scope).simulatedCases, 0);
  assert.throws(() => f.brain.recordBrokerEvents(key, account, [opening, { ...closing, price: 'forged' }]), /INVALID_DEAL/);
});

function learningRow(at: number, group: string, id: string, r: number, accepted: boolean) {
  return { id, at, until: at + minute, group, r, accepted, maeR: .5, mfeR: 1.2, tp1At: at, tp2At: r > 0 ? at : null };
}

test('learning fixes its unseen time window and compares policies including drawdown', () => {
  const interval = 2 * minute;
  const history = Array.from({ length: 80 }, (_, i) => learningRow(epoch + i * interval, 'learned', 'h'+i, 1, i % 2 === 0));
  const cutoff = epoch + 80 * interval, created = cutoff + 60 * minute;
  const candidate = buildLearningCandidate(history, cutoff, 'test-policy', created)!;
  assert.equal(candidate.holdoutStart, created);
  assert.deepEqual(candidate.selectedGroups, ['learned']);
  const outOfWindow = learningRow(candidate.holdoutEnd, 'learned', 'excluded', 500, false);
  const forward = Array.from({ length: 50 }, (_, i) => learningRow(created + i * interval, 'learned', 'o'+i, 1, i % 2 === 0));
  const result = evaluateLearningCandidate(candidate, [outOfWindow, ...forward, history[0]]);
  assert.equal(result.verdict, 'FORWARD_VALIDATED');
  assert.equal(result.opportunities, 50);
  assert.equal(result.candidate.totalR, 50);
  assert.equal(evaluateLearningCandidate(candidate, forward.slice(0, 8)).verdict, 'FORWARD_INSUFFICIENT');
  const worsening = forward.map(row => ({ ...row, r: row.accepted ? 1 : -1.5 }));
  assert.equal(evaluateLearningCandidate(candidate, worsening).verdict, 'FORWARD_REJECTED');
});

test('the scheduled cycle and promotion survive restart, rollback restores the previous knowledge pointer', (t) => {
  const day = 24 * 60 * minute, f = fixture(t);
  let n = 0;
  function caseAt(at: number, accepted: boolean, knowledgeDigest: string|null = null) {
    const p = plan(at, ++n, 'learned');
    const capture = (delay: number, bid: number) => f.brain.capture(key, account, {
      quote: quote(at + delay, bid), bars: [], now: at + delay
    });
    const first = capture(0, 100);
    f.brain.recordDecision(first, { status: 'STUDY', plan: accepted ? p : null, researchPlan: p }, { now: at, knowledgeDigest });
    capture(1000, 100);
    capture(2000, 103);
  }
  for (let i = 0; i < 80; i++) caseAt(epoch + i * 21 * minute, i % 2 === 0);
  const trained = epoch + 2 * day;
  assert.equal(f.brain.cycle(trained).processed, 1);
  assert.equal(f.brain.summary(scope).research.pullback.count, 80);
  assert.equal(f.brain.cycle(trained + 100).processed, 0);
  const candidateId = f.brain.summary(scope).candidateVersion;
  assert.ok(candidateId);
  assert.throws(() => f.brain.changeKnowledge(scope, { action: 'PROMOTE', versionId: candidateId }), /VERSION_NOT_VALIDATED/);
  for (let i = 0; i < 50; i++) caseAt(trained + i * 21 * minute, i % 2 === 0);
  for (let i = 50; i < 55; i++) caseAt(trained + i * 21 * minute, true, 'different-baseline');
  f.restart();
  assert.equal(f.brain.summary(scope).candidateVersion, candidateId);
  f.brain.cycle(trained + 31 * day);
  assert.equal(f.brain.summary(scope).forwardEvaluation.verdict, 'FORWARD_VALIDATED');
  assert.equal(f.brain.summary(scope).forwardEvaluation.opportunities, 50);
  assert.equal(f.brain.changeKnowledge(scope, { action: 'PROMOTE', versionId: candidateId, now: trained + 31 * day }).activeVersion, candidateId);
  f.restart();
  assert.equal(f.brain.summary(scope).activeVersion, candidateId);
  assert.equal(f.brain.changeKnowledge(scope, { action: 'ROLLBACK', now: trained + 32 * day }).activeVersion, null);
});
