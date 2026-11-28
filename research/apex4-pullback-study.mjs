import {educationMinimums, educationRuleKey, educationSchema, educationVersionId, holdMinutes} from '../intelligence/apex4-pullback-education.mjs';
import {MINUTE, classroomCost, jsonSha256, sourceSha256} from './apex4-pullback-classroom.mjs';
import {pullbackStop, replayPullbackPolicy, summarizePullbackPolicies} from './apex4-pullback-exits.mjs';

const lookahead = 120;
const studies = [
  ...holdMinutes.map(horizonMinutes => ({name: 'TP2_' + horizonMinutes, horizonMinutes})),
  {name: 'SESSION', horizonMinutes: null},
  ...['TP1', 'PARTIAL', 'PARTIAL_PROTECTED', 'TRAIL', 'MOMENTUM', 'STRUCTURE'].map(management => ({name: management, management})),
  ...[1, 2, 3, 5].map(entryDelayMinutes => ({name: 'DELAY_' + entryDelayMinutes, entryDelayMinutes})),
  {name: 'LIMIT_25PCT_RISK', limit: true},
  {name: 'VOLATILITY_STOP', stop: 'VOLATILITY'},
  {name: 'PIVOT_STOP', stop: 'STRUCTURAL'},
  {name: 'LOWER_COST', cost: {spread: .20, slippage: .05, commissionPerOunce: .07}},
  {name: 'HIGHER_COST', cost: {spread: .50, slippage: .20, commissionPerOunce: .10}},
];
const zones = Object.fromEntries(['Asia/Tokyo', 'Europe/London', 'America/New_York'].map(timeZone => [timeZone,
  new Intl.DateTimeFormat('en-GB', {timeZone, hour: 'numeric', hourCycle: 'h23'})]));
const sessionCache = new Map();
const sliceKey = (part, key) => part + ':' + key;
const mark = (table, key, value) => {
  if (!table.has(key)) table.set(key, []);
  table.get(key).push(value);
};

function sessionAt(timestamp) {
  const hour = Math.floor(timestamp / 3_600_000);
  if (sessionCache.has(hour)) return sessionCache.get(hour);
  const [tokyo, london, ny] = Object.values(zones).map(format => Number(format.format(new Date(timestamp))));
  const londonOpen = london >= 8 && london < 17;
  const nyOpen = ny >= 8 && ny < 17;
  const label = londonOpen && nyOpen ? 'LONDON_NEW_YORK_OVERLAP' : londonOpen ? 'LONDON' : nyOpen ? 'NEW_YORK' :
    tokyo >= 9 && tokyo < 17 ? 'ASIA' : 'OTHER';
  sessionCache.set(hour, label);
  return label;
}

function marketAnswer(evidence, bars, end) {
  const side = evidence.side === 'BUY' ? 1 : -1;
  const invalidation = evidence.parentStructure ?? evidence.impulseStartPrice;
  const favorable = side > 0 ? 'h' : 'l';
  const adverse = side > 0 ? 'l' : 'h';
  const at = evidence.at;
  const limit = Math.min(at + lookahead * MINUTE, end);
  const answer = {label: 'UNRESOLVED', minutes: null, mfePrice: 0, maePrice: 0};
  let seen = at - MINUTE;
  for (const bar of bars) {
    if (bar.t >= limit) break;
    if (bar.t - seen > 2 * MINUTE) return {...answer, label: 'CENSORED'};
    seen = bar.t;
    const origin = evidence.correctionExtremePrice;
    answer.mfePrice = Math.max(answer.mfePrice, side * (bar[favorable] - origin));
    answer.maePrice = Math.max(answer.maePrice, -side * (bar[adverse] - origin));
    const broke = side * (bar[adverse] - invalidation) <= 0;
    const continued = side * (bar[favorable] - evidence.impulsePeakPrice) >= 0;
    if (broke || continued) return {...answer, minutes: (bar.t - at) / MINUTE + 1,
      label: broke && continued ? 'AMBIGUOUS' : broke ? 'STRUCTURAL_INVALIDATION' : 'IMPULSE_RETEST'};
  }
  if (seen + MINUTE < at + lookahead * MINUTE) answer.label = 'CENSORED';
  return answer;
}

function replayOne(plan, bars, evaluationEnd, sessionEnd, study, history) {
  const side = plan.side === 'BUY' ? 1 : -1;
  const cost = study.cost ?? classroomCost;
  const bidOffset = (classroomCost.spread - cost.spread) / 2;
  const quotedPlan = study.cost ? {...plan, entry: plan.entry - side * bidOffset} : plan;
  const prices = study.cost ? bars.map(({t, o, h, l, c}) =>
    ({t, o: o + bidOffset, h: h + bidOffset, l: l + bidOffset, c: c + bidOffset})) : bars;
  const stop = study.stop ? pullbackStop(plan, history, {...cost, kind: study.stop}) : quotedPlan.sl;
  if (stop === null) return {status: 'INVALID_PLAN', at: plan.published, group: plan.group};
  return replayPullbackPolicy(quotedPlan, prices, {
    ...cost, evaluationEnd, sessionEnd, stopPrice: stop,
    horizonMinutes: study.horizonMinutes === undefined ? 20 : study.horizonMinutes,
    entryDelayMinutes: study.entryDelayMinutes ?? 0, management: study.management ?? 'TP2',
    entryLimit: study.limit ? {price: plan.entry - side * (side * (plan.entry - plan.sl)) * .25, validMinutes: 3} : null,
  });
}

function nonoverlapping(rows) {
  const result = [];
  const episodes = new Set();
  let available = 0;
  for (const {episode, outcome} of rows) {
    if (episodes.has(episode) || outcome.at < available || outcome.status !== 'RESOLVED') continue;
    episodes.add(episode);
    available = outcome.entryAt + outcome.durationMinutes * MINUTE;
    result.push(outcome);
  }
  return result;
}

function ruleStats(rows) {
  const clean = nonoverlapping(rows);
  const metrics = summarizePullbackPolicies(clean);
  const avg = metrics.expectancyR;
  const variance = clean.length > 1 ? clean.reduce((sum, row) => sum + (row.r - avg) ** 2, 0) / (clean.length - 1) : null;
  return {
    count: metrics.n, expectancyR: avg, winRate: metrics.winRate,
    profitFactor: metrics.profitFactor, netR: metrics.netR, drawdownR: metrics.maxDrawdownR,
    lowerMeanApprox95R: variance === null ? null : avg - 1.96 * Math.sqrt(variance / clean.length),
  };
}

function chooseRules(lessons) {
  const groups = new Map();
  for (const lesson of lessons) {
    if (lesson.actionable && lesson.at + lookahead * MINUTE <= lesson.through && lesson.split !== 'knownDevelopment') {
      mark(groups, educationRuleKey(lesson.evidence), lesson);
    }
  }
  const evaluated = [];
  const ruleSet = [];
  for (const [key, examples] of groups) {
    const partition = label => examples.filter(lesson => lesson.split === label);
    const train = partition('train');
    const scores = holdMinutes.map(minutes => ({holdMinutes: minutes,
      train: ruleStats(train.map(lesson => ({episode: lesson.episode, outcome: lesson.variants['TP2_' + minutes]})))}));
    const available = scores.filter(row => row.train.count >= educationMinimums.train && Number.isFinite(row.train.lowerMeanApprox95R));
    available.sort((a, b) => b.train.lowerMeanApprox95R - a.train.lowerMeanApprox95R || a.holdMinutes - b.holdMinutes);
    const best = available[0];
    if (!best) {
      evaluated.push({key, verdict: 'INSUFFICIENT_TRAIN', scores});
      continue;
    }
    const stats = label => ruleStats(partition(label).map(lesson =>
      ({episode: lesson.episode, outcome: lesson.variants['TP2_' + best.holdMinutes]})));
    const practice = stats('practice');
    const validation = stats('validation');
    const sufficient = (item, label) => item.count >= educationMinimums[label] && item.profitFactor > 1 && item.expectancyR > 0;
    const qualified = best.train.lowerMeanApprox95R > 0 && sufficient(practice, 'practice') && sufficient(validation, 'validation');
    const rule = {key, ...best, practice, validation};
    evaluated.push({...rule, verdict: qualified ? 'DEVELOPMENT_QUALIFIED' : 'REJECTED', scores});
    if (qualified) ruleSet.push(rule);
  }
  return {ruleSet: ruleSet.sort((a, b) => a.key.localeCompare(b.key)), evaluated};
}

function studyBreakdown(lessons, groupBy) {
  const groups = new Map();
  for (const {split, episode, at, evidence, variants} of lessons) {
    if (!variants.TP2_20) continue;
    const category = groupBy(evidence, at);
    mark(groups, sliceKey(split, category), {episode, outcome: variants.TP2_20});
  }
  return Object.fromEntries([...groups].sort(([a], [b]) => a.localeCompare(b)).map(([key, rows]) => [key, ruleStats(rows)]));
}

export function studyClassroom(db, runId, prices, provenance) {
  const previous = db.prepare('SELECT manifest FROM classroom_knowledge WHERE run_id = ? ORDER BY created_at DESC LIMIT 1').get(runId);
  const researchFiles = ['./apex4-pullback-study.mjs', './apex4-pullback-exits.mjs'];
  const researchDigest = jsonSha256(researchFiles.map(file => sourceSha256(new URL(file, import.meta.url))));
  if (previous && JSON.parse(previous.manifest).researchDigest === researchDigest) return JSON.parse(previous.manifest);

  const lessons = [];
  const recordedAnswer = db.prepare('SELECT outcome FROM classroom_outcomes WHERE run_id = ? AND lesson_id = ? AND policy = ?');
  const insertOutcome = db.prepare('INSERT OR IGNORE INTO classroom_outcomes VALUES (?,?,?,?)');
  const lessonStatement = db.prepare('SELECT * FROM classroom_lessons WHERE run_id = ? ORDER BY observed_at,id');
  const inputDigest = jsonSha256(provenance.sources);
  const counts = {lessons: 0, episodes: 0, executableGeometry: 0, actionable: 0, answer: {}, byStage: {}, bySplit: {}};
  const episodes = new Set();
  const bump = (object, key) => { object[key] = (object[key] ?? 0) + 1; };
  const aggregates = new Map();

  db.exec('BEGIN');
  try {
    for (const row of lessonStatement.iterate(runId)) {
      const plan = row.plan ? JSON.parse(row.plan) : null;
      const evidence = JSON.parse(row.evidence);
      const jsonOutcome = (policy, evaluate) => {
        const versioned = researchDigest.slice(0, 12) + ':' + policy;
        const found = recordedAnswer.get(runId, row.id, versioned);
        if (found) return JSON.parse(found.outcome);
        const result = evaluate();
        insertOutcome.run(runId, row.id, versioned, JSON.stringify(result));
        return result;
      };
      const {bar_index: index, split_end: rangeEnd, session_bar_end: sessionIndex} = row;
      const sessionEnd = sessionIndex < prices.length ? prices[sessionIndex - 1].t + MINUTE : null;
      const boundedEnd = Math.min(rangeEnd, sessionEnd ?? Infinity);
      const answer = jsonOutcome('MARKET_ANSWER', () => marketAnswer(evidence,
        prices.slice(index, Math.min(index + lookahead, sessionIndex)), boundedEnd));
      counts.lessons++;
      counts.executableGeometry += Number(!!plan);
      counts.actionable += Number(row.actionable);
      episodes.add(row.episode);
      bump(counts.answer, answer.label);
      bump(counts.byStage, evidence.stage);
      bump(counts.bySplit, row.split);
      if (!plan) continue;

      const variants = {};
      const window = prices.slice(index, Math.min(index + lookahead + 6, sessionIndex));
      const history = prices.slice(Math.max(0, index - 36), index);
      for (const study of studies) {
        if (row.split !== 'knownDevelopment' && !study.name.startsWith('TP2_')) continue;
        const outcome = jsonOutcome(study.name, () => replayOne(plan,
          study.horizonMinutes === null ? prices.slice(index, sessionIndex) : window, rangeEnd, sessionEnd, study, history));
        if (study.name.startsWith('TP2_')) variants[study.name] = outcome;
        if (row.split === 'knownDevelopment' && row.actionable) mark(aggregates, study.name, outcome);
      }
      lessons.push({at: row.observed_at, split: row.split, through: rangeEnd, episode: row.episode, actionable: !!row.actionable,
        evidence: {side: evidence.side, family: evidence.family, stage: evidence.stage, depthBand: evidence.depthBand,
          trendAlignment: evidence.trendAlignment, atrM5: evidence.atrM5}, variants});
    }
    counts.episodes = episodes.size;
    const {ruleSet, evaluated} = chooseRules(lessons);
    const known = lessons.filter(row => row.split === 'knownDevelopment');
    const executionStudies = Object.fromEntries([...aggregates].map(([key, rows]) => [key, summarizePullbackPolicies(rows)]));
    const measurements = {
      executionStudies,
      portfolio: Object.fromEntries(provenance.splits.map(({label}) => [label, ruleStats(lessons
        .filter(row => row.split === label && row.actionable)
        .map(lesson => ({episode: lesson.episode, outcome: lesson.variants.TP2_20})))])),
      windows: {
        wat: studyBreakdown(lessons, (_e, at) => (new Date(at).getUTCHours() + 1) % 24),
        sessions: studyBreakdown(lessons, (_e, at) => sessionAt(at)),
        weekdayWAT: studyBreakdown(lessons, (_e, at) => new Date(at + 3_600_000).getUTCDay()),
        volatility: studyBreakdown(lessons, e => e.atrM5 < 2 ? 'ATR_BELOW_$2' : e.atrM5 < 5 ? 'ATR_$2_TO_$5' : 'ATR_AT_LEAST_$5'),
      },
      featureGroups: Object.fromEntries(['side', 'family', 'stage', 'depthBand', 'trendAlignment'].map(feature =>
        [feature, studyBreakdown(lessons, evidence => evidence[feature])])),
      windowBasis: 'All geometry-valid first-observed pattern states with nonoverlapping modeled entries. These descriptive slices grant no execution authority.',
      selectedOnKnownDevelopment: ruleStats(known.flatMap(lesson => {
        const rule = ruleSet.find(candidate => candidate.key === educationRuleKey(lesson.evidence));
        return rule && lesson.actionable ? [{episode: lesson.episode, outcome: lesson.variants['TP2_' + rule.holdMinutes]}] : [];
      })),
      evaluated,
    };
    const manifest = {schema: educationSchema, trainingThrough: provenance.splits.at(-1).to, inputDigest, researchDigest,
      ruleSet, samples: counts, measurements, provenance, classroomRun: runId};
    manifest.id = educationVersionId(manifest);
    db.prepare('INSERT OR IGNORE INTO classroom_knowledge VALUES (?,?,?,?)')
      .run(manifest.id, runId, JSON.stringify(manifest), Date.now());
    db.exec('COMMIT');
    return manifest;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
