import {createHash} from 'node:crypto';

export const educationSchema = 'APEX4_PULLBACK_CLASSROOM_V1';
export const holdMinutes = [10, 20, 30, 45, 60, 120];
const MINUTE = 60_000;
const FIVE_MINUTES = 5 * MINUTE;
const dollars = value => Math.round(value * 100) / 100;
const sign = trend => trend === 'UP' ? 1 : trend === 'DOWN' ? -1 : 0;
const idFor = value => createHash('sha256').update(value).digest('hex').slice(0, 24);

function extremum(bars, side, favorable) {
  const field = (side > 0) === favorable ? 'h' : 'l';
  return bars.reduce((chosen, bar) => side * (bar[field] - chosen[field]) * (favorable ? 1 : -1) >= 0
    ? bar : chosen);
}

/** Describe a possible correction from closed candles, then construct a quote-tested research plan. */
export function recognizePullback(market, quote, oneMinute, fiveMinute) {
  const {now, m1, m5, m15, h1} = market;
  const parent = sign(m15.trend);
  const local = sign(m5.trend);
  const side = parent || local;
  if (!side) return null;

  const five = fiveMinute.slice(-16).filter(bar => bar.t + FIVE_MINUTES <= now);
  const one = oneMinute.slice(-90).filter(bar => bar.t + MINUTE <= now);
  if (five.length < 12 || one.length < 60 || !Number.isFinite(m5.atr) || m5.atr <= 0) return null;

  const peak = extremum(five.slice(3), side, true);
  const prior = five.filter(bar => bar.t < peak.t);
  const start = extremum(prior, side, false);
  const peakBar = one.findLast(bar => bar.t >= peak.t && bar.t < peak.t + FIVE_MINUTES &&
    (side > 0 ? bar.h === peak.h : bar.l === peak.l));
  if (!peakBar || now - start.t > 90 * MINUTE) return null;

  const peakPrice = side > 0 ? peak.h : peak.l;
  const startPrice = side > 0 ? start.l : start.h;
  const impulse = side * (peakPrice - startPrice);
  if (impulse < m5.atr * 1.25) return null;
  const correction = one.filter(bar => bar.t > peakBar.t);
  if (!correction.length) return null;
  const adverse = extremum(correction, side, false);
  const adversePrice = side > 0 ? adverse.l : adverse.h;
  const depth = side * (peakPrice - adversePrice) / impulse;
  if (depth < 0.12) return null;

  const spread = quote.ask - quote.bid;
  const entry = side > 0 ? quote.ask : quote.bid;
  const recovery = side * (entry - adversePrice) / (impulse * depth);
  const structure = side > 0 ? m15.lastSwingLow : m15.lastSwingHigh;
  const broken = depth >= 1 || (Number.isFinite(structure) && side * (adversePrice - structure) <= 0);
  const sweep = side > 0 ? m1.sweptLow : m1.sweptHigh;
  const rejection = side > 0 ? m1.lowerRejection : m1.upperRejection;
  const reclaim = side > 0 ? m1.brokeUp || m1.structureShiftUp : m1.brokeDown || m1.structureShiftDown;
  const recoveryPressure = side * m1.pressure > 0.1 && side * m1.acceleration > 0;
  const stage = broken ? 'STRUCTURE_BROKEN' : recovery >= 0.85 ? 'LATE'
    : sweep && recoveryPressure ? 'SWEEP_RECOVERY' : reclaim ? 'STRUCTURE_RECLAIM'
    : rejection ? 'REJECTION' : recoveryPressure ? 'MOMENTUM_RECOVERY' : 'DEVELOPING';
  const higher = sign(h1?.trend);
  const family = !parent || higher === -side ? 'MIXED_TREND' : 'TREND_PULLBACK';
  const depthBand = depth < 0.35 ? 'SHALLOW' : depth < 0.65 ? 'MODERATE' : 'DEEP';
  const direction = side > 0 ? 'BUY' : 'SELL';
  const trendAlignment = local === side ? 'ALIGNED' : local === -side ? 'OPPOSED' : 'MIXED';

  const stop = dollars(adversePrice - side * (m1.atr * 0.25 + spread));
  const risk = side * (entry - stop);
  const room = side * (peakPrice - entry);
  const target = Math.min(room, m5.atr * 1.5);
  const tp1 = dollars(entry + side * target / 2);
  const tp2 = dollars(entry + side * target);
  const pattern = [family, direction, stage, depthBand].join('|');
  const evidence = {
    source: 'BROKER_CLOSED_M1_M5_M15_H1', at: now, lastBar: m1.last.t,
    side: direction, pattern, family, stage, depthBand, trendAlignment,
    impulseStart: start.t, impulsePeak: peakBar.t, correctionExtreme: adverse.t,
    impulseStartPrice: startPrice, impulsePeakPrice: peakPrice, correctionExtremePrice: adversePrice,
    correctionMinutes: (now - peakBar.t - MINUTE) / MINUTE,
    recoveryMinutes: (now - adverse.t - MINUTE) / MINUTE,
    depth, recovery, parentStructure: structure,
    atrM1: m1.atr, atrM5: m5.atr, impulseAtr: impulse / m5.atr, entryRoomR: risk > 0 ? room / risk : null,
    spread, m1Momentum: m1.momentum, m5Momentum: m5.momentum, m1Pressure: m1.pressure,
    m1Acceleration: m1.acceleration, m5Extension: m5.extension, m5Rsi: m5.rsi,
    m5Trend: m5.trend, m15Trend: m15.trend, h1Trend: h1?.trend ?? null,
    structureBroken: broken, sweep, rejection, reclaim, recoveryPressure,
  };

  const executableGeometry = risk > 0 && side * (tp1 - entry) > spread &&
    side * (tp2 - tp1) > 0 && stop > 0;
  const plan = executableGeometry ? {
    id: idFor([educationSchema, direction, peakBar.t, m1.last.t, stage].join('|')),
    kind: 'PULLBACK', side: direction, published: now, expires: now + 12_000,
    entry, sl: stop, tp1, tp2, group: pattern, source: educationSchema,
    reason: [family, direction, stage, depthBand].map(label => label.toLowerCase().replaceAll('_', ' ')).join(' · '),
  } : null;
  return {evidence, plan, actionable: !!plan && !['DEVELOPING', 'LATE', 'STRUCTURE_BROKEN'].includes(stage)};
}

// The same measurable grouping is used by the archive, the exam and live decisions.
export function educationRuleKey(evidence) {
  return [evidence.family, evidence.stage, evidence.depthBand, evidence.trendAlignment].join('|');
}

export function educationVersionId(manifest) {
  return createHash('sha256').update(JSON.stringify({
    schema: manifest.schema, trainingThrough: manifest.trainingThrough,
    ruleSet: manifest.ruleSet, inputDigest: manifest.inputDigest,
    researchDigest: manifest.researchDigest,
  })).digest('hex');
}

const sufficient = (stats, min) => Number.isInteger(stats?.count) && stats.count >= min &&
  Number.isFinite(stats.expectancyR) && stats.expectancyR > 0 &&
  Number.isFinite(stats.drawdownR) && stats.drawdownR >= 0 &&
  Number.isFinite(stats.profitFactor) && stats.profitFactor > 1;
export const educationMinimums = Object.freeze({train: 70, practice: 30, validation: 30, exam: 40});

export function checkEducation(manifest) {
  const digest = value => /^[a-f0-9]{64}$/.test(String(value));
  if (manifest?.schema !== educationSchema || !Number.isSafeInteger(manifest.trainingThrough) ||
      !digest(manifest.inputDigest) || !digest(manifest.researchDigest) ||
      !Array.isArray(manifest.ruleSet) || manifest.ruleSet.length > 200 ||
      !manifest.ruleSet.every((rule, index, rules) =>
        typeof rule?.key === 'string' && rule.key.length <= 200 &&
        rules.findIndex(row => row.key === rule.key) === index &&
        holdMinutes.includes(rule.holdMinutes) &&
        sufficient(rule.train, educationMinimums.train) &&
        sufficient(rule.practice, educationMinimums.practice) &&
        sufficient(rule.validation, educationMinimums.validation)) ||
      educationVersionId(manifest) !== manifest.id) return false;
  if (!manifest.exam) return true;
  const {exam} = manifest;
  return exam.version === manifest.id && exam.label === 'FORWARD' && exam.from >= manifest.trainingThrough &&
    Number.isSafeInteger(exam.from) && Number.isSafeInteger(exam.through) && exam.through > exam.from &&
    digest(exam.inputDigest) && exam.inputDigest !== manifest.inputDigest &&
    typeof exam.qualifies === 'boolean' &&
    (!exam.qualifies || sufficient(exam.portfolio, educationMinimums.exam));
}

export function selectEducatedPullback(detected, manifest, now) {
  if (!detected) return null;
  const rule = manifest?.ruleSet?.find(row => row.key === educationRuleKey(detected.evidence));
  const lessonEvidence = {
    ...detected.evidence,
    version: manifest?.id ?? null,
    comparison: rule ? {train: rule.train, practice: rule.practice, validation: rule.validation} : null,
    examinationQualified: manifest?.exam?.qualifies === true,
  };
  const eligible = detected.actionable && rule && manifest?.exam?.qualifies === true &&
    manifest.exam.through <= now && checkEducation(manifest);
  const plan = eligible ? {...detected.plan, observationMinutes: rule.holdMinutes, holdMinutes: rule.holdMinutes,
    reason: detected.plan.reason + ' · matched a validated historical group'} : null;
  return {
    plan, lessonEvidence,
    researchPlan: plan ?? detected.plan,
    status: plan ? 'EDUCATED_PULLBACK_CANDIDATE' : !detected.actionable ? detected.evidence.stage
      : rule ? 'AWAITING_FORWARD_QUALIFICATION' : 'UNQUALIFIED_PULLBACK_PATTERN',
  };
}
