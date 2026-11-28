import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePullbackReplay } from '../intelligence/apex4-replay-validation.mjs';

const groups = [{ group: 'CONTINUATION|BUY' }, { group: 'BUY|REJECTION' }];
const knowledge = (exam) => ({
  pullbacks: groups,
  diagnostics: { replay: { results: [{ cost: { label: 'baseline' }, splits: exam ? { unseen: { selected: exam } } : {} }] } },
});

test('a losing untouched exam keeps research groups and removes execution eligibility', () => {
  const before = knowledge({ n: 20, expectancyR: -.01 });
  const after = validatePullbackReplay(before);
  assert.deepEqual(after.pullbacks, []);
  assert.deepEqual(after.diagnostics.pullbackSelection.groupsBeforeExam, groups);
  assert.equal(after.diagnostics.pullbackSelection.result, 'NONPOSITIVE_UNSEEN_EXPECTANCY');
  assert.deepEqual(after.diagnostics.replay, before.diagnostics.replay);
  assert.deepEqual(before.pullbacks, groups);
});

test('a missing or small untouched exam cannot authorize any group', () => {
  for (const exam of [null, { n: 9, expectancyR: 1 }, { expectancyR: 1 }]) {
    const result = validatePullbackReplay(knowledge(exam));
    assert.equal(result.diagnostics.pullbackSelection.passed, false);
    assert.deepEqual(result.pullbacks, []);
  }
});

test('a positive exam applies to the whole preselected portfolio', () => {
  const result = validatePullbackReplay(knowledge({ n: 10, expectancyR: .01 }));
  assert.equal(result.diagnostics.pullbackSelection.passed, true);
  assert.deepEqual(result.pullbacks, groups);
});
