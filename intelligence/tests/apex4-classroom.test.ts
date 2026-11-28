import assert from 'node:assert/strict';
import test from 'node:test';
import {selectIndependentPlan, wire} from '../apex4-engine.ts';
import {educationRuleKey, educationSchema, educationVersionId} from '../apex4-pullback-education.mjs';
import {identifyClassroomLessons} from '../../research/apex4-pullback-classroom.mjs';
import {loadMonth} from '../../research/archive.mjs';

test('the historical recognizer and runtime share closed-bar evidence and require the examined knowledge version', () => {
  const archive = loadMonth('2025_06').slice(0, 2000).map(bar => ({
    t: bar.t, o: bar.o - .15, h: bar.h - .15, l: bar.l - .15, c: bar.c - .15,
  }));
  const examples = [];
  identifyClassroomLessons(archive, [{label: 'practice', from: archive[0].t, to: archive.at(-1).t}], lesson => {
    if (lesson.actionable && lesson.at % 3_600_000 > 25_000) examples.push(lesson);
  });
  const lesson = examples[0];
  assert.ok(lesson, 'recorded prefix contains an actionable classroom setup');

  const bars = archive.slice(0, lesson.barIndex);
  const bid = archive[lesson.barIndex].o;
  const quote = {bid, ask: bid + .30, at: new Date(lesson.at).toISOString()};
  const decision = (version, marketBars = bars) => selectIndependentPlan(marketBars, quote, lesson.at, null, undefined, version);
  const staged = decision(null);
  assert.equal(staged.plan, null);
  assert.equal(staged.pullbackEvidence.pattern, lesson.evidence.pattern);
  assert.equal(staged.pullbackEvidence.lastBar, bars.at(-1).t);
  assert.deepEqual(decision(null, archive).pullbackEvidence, staged.pullbackEvidence);

  const stats = {count: 110, expectancyR: .1, profitFactor: 1.2, drawdownR: 5};
  function fixtureKnowledge(minutes) {
    const model = {
      schema: educationSchema, trainingThrough: lesson.at - 10 * 86_400_000,
      ruleSet: [{key: educationRuleKey(lesson.evidence), holdMinutes: minutes,
        train: stats, practice: stats, validation: stats}],
      inputDigest: 'a'.repeat(64), researchDigest: 'b'.repeat(64),
    };
    return {...model, id: educationVersionId(model)};
  }

  const frozen = fixtureKnowledge(30);
  assert.equal(decision(frozen).plan, null);
  const withExam = model => ({...model, exam: {
    version: model.id, label: 'FORWARD', from: model.trainingThrough, through: lesson.at - 1,
    inputDigest: 'c'.repeat(64), qualifies: true, portfolio: stats,
  }});
  const validated = withExam(frozen);
  assert.equal(decision({...validated, exam: {...validated.exam, portfolio: {...stats, count: 1}}}).plan, null);
  assert.equal(decision({...validated, ruleSet: fixtureKnowledge(60).ruleSet}).plan, null);
  const short = decision(validated);
  const long = decision(withExam(fixtureKnowledge(60)));
  assert.equal(short.status, 'EDUCATED_PULLBACK_CANDIDATE');
  assert.equal(long.status, 'EDUCATED_PULLBACK_CANDIDATE');
  assert.equal(wire(short.plan).split('|').at(-1), '30');
  assert.equal(wire(long.plan).split('|').at(-1), '60');
  assert.equal(wire(short.plan).split('|').length, 11);
  assert.equal(wire(long.plan).split('|').slice(0, 10).join('|'), wire(short.plan).split('|').slice(0, 10).join('|'));
});
