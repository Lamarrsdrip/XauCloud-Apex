// Use the same minimum count already required of a validation group. The
// untouched exam is a portfolio-level gate and never chooses individual groups.
const MIN_EXAM_CASES = 10;

export function validatePullbackReplay(knowledge) {
  const groups = knowledge.diagnostics.pullbackSelection?.groupsBeforeExam ?? knowledge.pullbacks;
  const baseline = knowledge.diagnostics.replay?.results?.find(result => result.cost.label === 'baseline');
  const exam = baseline?.splits.unseen?.selected ?? null;
  const reason = groups.length === 0 ? 'NO_TRAIN_VALIDATION_GROUPS'
    : !exam ? 'UNSEEN_EXAM_REQUIRED'
    : !Number.isSafeInteger(exam.n) || exam.n < MIN_EXAM_CASES ? 'INSUFFICIENT_UNSEEN_CASES'
    : !Number.isFinite(exam.expectancyR) || exam.expectancyR <= 0 ? 'NONPOSITIVE_UNSEEN_EXPECTANCY'
    : 'UNSEEN_PORTFOLIO_PASSED';
  const passed = reason === 'UNSEEN_PORTFOLIO_PASSED';
  return {
    ...knowledge,
    pullbacks: passed ? groups : [],
    diagnostics: {
      ...knowledge.diagnostics,
      pullbackSelection: { groupsBeforeExam: groups, minimumExamCases: MIN_EXAM_CASES, result: reason, passed, exam },
    },
  };
}
