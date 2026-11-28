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

test('decision evidence enrolls extra pullback lessons once and ignores quotes dated before the decision', (t) => {
  const f = fixture(t);
  const observation = f.brain.capture(key, account, { quote: quote(epoch - 1500), bars: [], now: epoch });
  const selected = { ...plan(epoch, 1, 'reclaim'), holdMinutes: 60, source: 'APEX4_PULLBACK_CLASSROOM_V1' };
  const skipped = { ...plan(epoch, 2, 'early rejection'), observationMinutes: 45,
    lessonEvidence: { depth: .42, sweep: true }, lessonDisposition: 'RECOVERING' };
  const decision = { status: 'QUALIFIED', plan: selected, researchPlan: selected,
    pullbackEvidence: { state: 'RECOVERING', depth: .42 }, researchPlans: [skipped, skipped] };
  f.brain.recordDecision(observation, decision, { now: epoch, knowledgeDigest: 'qualified-study' });
  assert.equal(f.brain.summary(scope).pendingCases, 2);
  f.restart();
  f.brain.recordDecision(observation, { status: 'CHANGED', pullbackEvidence: { state: 'REVERSED' } }, { now: epoch + 1000 });
  const evidence = f.brain.decisionEvidence(observation);
  assert.deepEqual(evidence.pullback, decision.pullbackEvidence);
  assert.equal(evidence.quote.at, quote(epoch - 1500).at);
  assert.equal(evidence.bars.throughObservation, observation.id);
  assert.equal(evidence.knowledgeDigest, 'qualified-study');
  assert.equal(f.brain.summary(scope).snapshots, 1);
  f.brain.capture(key, account, { quote: quote(epoch - 500, 100), bars: [], now: epoch + 1000 });
  f.brain.capture(key, account, { quote: quote(epoch + 2000, 103), bars: [], now: epoch + 2000 });
  const lessons = f.brain.recentLessons(scope);
  assert.equal(lessons.length, 2);
  assert.ok(lessons.every(lesson => lesson.result === 'INVALIDATED_BEFORE_ENTRY' && lesson.r === null));
  const extra = lessons.find(lesson => lesson.setup === 'early rejection');
  assert.equal(extra.disposition, 'SKIPPED');
  assert.equal(extra.observationId, observation.id);
  assert.equal(extra.costs.observationMinutes, 45);
  assert.deepEqual(extra.evidence.recognition, skipped.lessonEvidence);
  const first = lessons.find(lesson => lesson.setup === 'reclaim');
  assert.equal(first.disposition, 'SELECTED');
  assert.equal(first.costs.observationMinutes, 60);
  assert.equal(first.evidence.experimental, true);
});

test('a disconnected unfilled approach is censored rather than counted as a missed fill', (t) => {
  const f = fixture(t);
  const initial = f.brain.capture(key, account, { quote: quote(epoch), bars: [] });
  f.brain.recordDecision(initial, { status: 'PULLBACK_UNCALIBRATED', researchPlan: plan(epoch) });
  f.brain.capture(key, account, { quote: quote(epoch + 17_000, 103), bars: [], now: epoch + 17_000 });
  assert.equal(f.brain.recentLessons(scope)[0].result, 'INSUFFICIENT_OBSERVATION');
  assert.equal(f.brain.recentLessons(scope)[0].observed.entry, null);
});

test('spread and entry-price barriers explain unfilled research without inventing a fill', (t) => {
  const f = fixture(t);
  const observe = (delay: number, bid: number, ask: number) =>
    f.brain.capture(key, account, { quote: quote(epoch + delay, bid, ask), bars: [], now: epoch + delay });
  f.brain.recordDecision(observe(0, 100, 100.1), { status: 'DEVELOPING', researchPlan: plan(epoch) });
  observe(1000, 99.87, 100.27);
  f.restart();
  observe(1000, 99.87, 100.27);
  observe(2000, 100.4, 100.5);
  observe(13_000, 100.4, 100.5);
  const [lesson] = f.brain.recentLessons(scope);
  assert.equal(lesson.result, 'NOT_ENTERED');
  assert.equal(lesson.reason, 'VALIDITY_ELAPSED');
  assert.deepEqual(lesson.entryScreen, { spreadRejections: 1, priceRejections: 1 });
  assert.equal(lesson.r, null);
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

test('a late order acknowledgement links previously unassigned deals and keeps actual costs distinct', (t) => {
  const f = fixture(t, () => epoch + 20_000);
  const approved = plan(epoch);
  const initial = f.brain.capture(key, account, { quote: quote(epoch), bars: [], now: epoch });
  f.brain.recordDecision(initial, { status: 'QUALIFIED', plan: approved }, { now: epoch });
  const opening = { kind: 'DEAL', dealId: '12345', positionId: '45678', entry: 'IN', direction: 'BUY', price: 100.15,
    volume: .01, atMs: epoch + 1000, reason: 'EXPERT', profit: 0, commission: -.1, fee: -.01, swap: 0 };
  const closing = { ...opening, dealId: '12346', entry: 'OUT', direction: 'SELL', price: 102, profit: 8,
    swap: -.03, reason: 'TP', atMs: epoch + 19_000 };
  f.brain.capture(key, account, { quote: quote(epoch + 16_000, 99.8), bars: [], now: epoch + 16_000 });
  f.brain.capture(key, account, { quote: quote(epoch + 18_000, 102), bars: [], now: epoch + 18_000 });
  f.brain.recordBrokerEvents(key, account, [opening, closing]);
  assert.equal(f.brain.latestExecution(scope), null);
  const ack = { kind: 'ORDER_RESULT', eventId: 'test-ack-12345', planId: approved.id, dealId: opening.dealId,
    requestedPrice: 100.1, requestedVolume: .01, filledPrice: 100.15, filledVolume: .01,
    retcode: 10009, spread: .1, atMs: epoch + 900 };
  f.restart();
  f.brain.recordBrokerEvents('alternate-key', account, [ack]);
  assert.equal(f.brain.latestExecution(scope), null);
  f.brain.recordBrokerEvents(key, account, [ack]);
  const actual = f.brain.latestExecution(scope);
  assert.equal(actual.planId, approved.id);
  assert.equal(actual.closed, true);
  assert.equal(actual.observedTp2, true);
  assert.equal(actual.positionGross, 8);
  assert.deepEqual(actual.positionCosts, { commission: -.2, fee: -.02, swap: -.03 });
  assert.equal(actual.entryExecutionCosts.quotedSpread.average, .1);
  assert.ok(Math.abs(actual.entryExecutionCosts.priceSlippage.average - .05) < 1e-9);
  assert.equal(actual.positionNet, 7.75);
  assert.equal(f.brain.summary(scope).brokerDeals, 2);
  f.brain.cycle(epoch + 24 * 60 * minute);
  const report = f.brain.summary(scope).brokerEducation;
  assert.equal(report.source, 'EA_REPORTED_DEMO_BROKER');
  assert.equal(report.settled, 1);
  assert.equal(report.settledNet, 7.75);
  assert.equal(f.brain.summary(scope).research.pullback.totalR, 0);
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
  const sameAsActive = { ...candidate, comparedVersion: 'incumbent', comparisonGroups: ['learned'] };
  const incumbentCheck = evaluateLearningCandidate(sameAsActive, forward);
  assert.equal(incumbentCheck.verdict, 'FORWARD_REJECTED');
  assert.equal(incumbentCheck.comparator?.version, 'incumbent');
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
