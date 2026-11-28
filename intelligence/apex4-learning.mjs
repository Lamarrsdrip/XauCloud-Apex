const DAY = 86_400_000;
const MIN_TRAIN = 30;
const MIN_VALIDATION = 15;
const MIN_FORWARD = 20;
const FORWARD_WINDOW = 30 * DAY;

export function quoteResearchStats(rows) {
  const totalR = rows.reduce((sum, row) => sum + row.r, 0);
  const gains = rows.reduce((sum, row) => sum + Math.max(0, row.r), 0);
  const losses = rows.reduce((sum, row) => sum + Math.max(0, -row.r), 0);
  let equityR = 0, peakR = 0, drawdownR = 0;
  for (const row of rows) {
    equityR += row.r;
    peakR = Math.max(peakR, equityR);
    drawdownR = Math.max(drawdownR, peakR - equityR);
  }
  const count = rows.length;
  return {
    count, totalR, drawdownR, profitFactor: losses ? gains / losses : null,
    expectancyR: count ? totalR / count : null,
    winRate: count ? rows.filter(row => row.r > 0).length / count : null,
    tp1Rate: count ? rows.filter(row => row.tp1At !== null).length / count : null,
    tp2Rate: count ? rows.filter(row => row.tp2At !== null).length / count : null,
    meanMaeR: count ? rows.reduce((sum, row) => sum + row.maeR, 0) / count : null,
    meanMfeR: count ? rows.reduce((sum, row) => sum + row.mfeR, 0) / count : null
  };
}
const chronological = rows => rows.filter(row => Number.isFinite(row.r) && Number.isFinite(row.at) && Number.isFinite(row.until) &&
    Number.isFinite(row.maeR) && Number.isFinite(row.mfeR) && row.until > row.at).slice().sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));

export function buildLearningCandidate(rows, cutoff, policyVersion, createdAt = cutoff) {
  const historical = chronological(rows).filter(row => row.until <= cutoff);
  if (historical.length < MIN_TRAIN + MIN_VALIDATION) return null;
  const boundary = historical[Math.floor(historical.length * 2 / 3)].at;
  const train = historical.filter(row => row.until <= boundary);
  const validation = historical.filter(row => row.at >= boundary);
  if (train.length < MIN_TRAIN || validation.length < MIN_VALIDATION) return null;
  const groups = [...new Set(train.map(row => row.group))].map(group => ({
    group, train: quoteResearchStats(train.filter(row => row.group === group)), validation: quoteResearchStats(validation.filter(row => row.group === group))
  }));
  const selectedGroups = groups.filter(row => row.train.count >= MIN_TRAIN && row.validation.count >= MIN_VALIDATION &&
    row.train.expectancyR > 0 && row.validation.expectancyR > 0).map(row => row.group);
  if (!selectedGroups.length) return null;
  return {
    schema: 'APEX4_PULLBACK_QUOTE_RESEARCH_V1', policyVersion,
    evidenceSource: 'SIMULATED_OBSERVED_QUOTES', createdAt, cutoff, trainEnd: boundary,
    newestDecision: historical.at(-1).at, holdoutStart: createdAt, holdoutEnd: createdAt + FORWARD_WINDOW,
    train: quoteResearchStats(train), validation: quoteResearchStats(validation), groups, selectedGroups
  };
}

export function evaluateLearningCandidate(candidate, rows) {
  // All policies are compared on the same forward opportunity set, including their skipped cases.
  // Rows that lack quote coverage or straddle the boundary never enter the comparison.
  const unseen = chronological(rows).filter(row => row.at >= candidate.holdoutStart && row.until <= candidate.holdoutEnd);
  const baseline = quoteResearchStats(candidate.reference === 'ALL_ELIGIBLE_CLASSROOM_RESEARCH'
    ? unseen : unseen.filter(row => row.accepted));
  const candidateRows = unseen.filter(row => candidate.selectedGroups.includes(row.group));
  const improved = quoteResearchStats(candidateRows);
  const comparator = candidate.comparedVersion ? quoteResearchStats(unseen.filter(
    row => candidate.comparisonGroups.includes(row.group)
  )) : null;
  const enough = improved.count >= MIN_FORWARD && baseline.count >= MIN_FORWARD && (!comparator || comparator.count >= MIN_FORWARD);
  const beats = reference => improved.totalR > reference.totalR && improved.drawdownR <= reference.drawdownR;
  const verdict = !enough ? 'FORWARD_INSUFFICIENT' :
    improved.expectancyR > 0 && beats(baseline) && (!comparator || beats(comparator))
      ? 'FORWARD_VALIDATED' : 'FORWARD_REJECTED';
  return {
    verdict, evidenceSource: candidate.evidenceSource, holdoutStart: candidate.holdoutStart, holdoutEnd: candidate.holdoutEnd,
    opportunities: unseen.length, baseline, candidate: improved,
    ...(comparator ? { comparator: { version: candidate.comparedVersion, ...comparator } } : {})
  };
}
