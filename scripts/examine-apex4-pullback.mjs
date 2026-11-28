#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {
  checkEducation, educationMinimums, educationRuleKey,
} from '../intelligence/apex4-pullback-education.mjs';
import {
  classroomCost, identifyClassroomLessons, loadClassroomPrices, MINUTE, openClassroom, sourceSha256,
} from '../research/apex4-pullback-classroom.mjs';
import {replayPullbackPolicy, summarizePullbackPolicies} from '../research/apex4-pullback-exits.mjs';
import {loadMonth} from '../research/archive.mjs';

const [databaseFile, frozenFile, archive, knownNovember, forwardFile, expectedHash, output] = process.argv.slice(2);
if (!output || !/^[a-f0-9]{64}$/.test(expectedHash ?? '')) {
  throw Error('Usage: node scripts/examine-apex4-pullback.mjs <db> <frozen.json> <archive> <known-november|-> <sealed-forward.csv.gz> <sha256> <examined.json>');
}

const model = JSON.parse(fs.readFileSync(frozenFile, 'utf8'));
if (!checkEducation(model) || model.exam) throw Error('MODEL_NOT_FROZEN');
const db = openClassroom(databaseFile);
const receipt = db.prepare('SELECT manifest FROM classroom_knowledge WHERE id = ?').get(model.id);
if (!receipt || receipt.manifest !== JSON.stringify(model)) throw Error('MODEL_RECEIPT_MISMATCH');
if (db.prepare('SELECT 1 FROM classroom_exams WHERE version_id = ?').get(model.id)) throw Error('MODEL_ALREADY_EXAMINED');

if (sourceSha256(forwardFile) !== expectedHash || model.provenance.sources.some(row => row.digest === expectedHash)) {
  throw Error('FORWARD_INPUT_MISMATCH');
}
const month = /^XAUUSD_M1_(\d{4}_\d{2})\.csv\.gz$/.exec(path.basename(forwardFile))?.[1];
if (!month) throw Error('INVALID_FORWARD_FILENAME');
const rows = loadMonth(month, path.dirname(forwardFile));
const from = rows[0]?.t;
const through = rows.at(-1)?.t + MINUTE;
if (!rows.length || from < model.trainingThrough || !Number.isSafeInteger(through)) throw Error('FORWARD_INPUT_OVERLAPS');
const spreadHalf = classroomCost.spread / 2;
const {prices, sources} = loadClassroomPrices(path.resolve(archive), knownNovember === '-' ? null : knownNovember);
if (JSON.stringify(sources) !== JSON.stringify(model.provenance.sources)) throw Error('WARMUP_SOURCE_MISMATCH');
const warmup = prices.slice(-7500);
let previous = warmup.at(-1).t;
for (const {t, o, h, l, c} of rows) {
  if (t <= previous || t % MINUTE !== 0) throw Error('INVALID_FORWARD_SEQUENCE');
  previous = t;
  warmup.push({t, o: o - spreadHalf, h: h - spreadHalf, l: l - spreadHalf, c: c - spreadHalf});
}

const eligible = new Map(model.ruleSet.map(rule => [rule.key, rule]));
const examined = [];
const baseline = [];
const decisions = [];
const baselineEpisodes = new Set();
const selectedEpisodes = new Set();
let baselineAvailable = 0;
let selectedAvailable = 0;
let patterns = 0;
let executable = 0;
const days = new Set(rows.map(row => new Date(row.t).toISOString().slice(0,10)));
identifyClassroomLessons(warmup, [{label: 'forward', from, to: through}], lesson => {
  const {at, episode, evidence, plan, actionable, barIndex, sessionBarEnd} = lesson;
  patterns++;
  if (!actionable) return;
  executable++;
  const rule = eligible.get(educationRuleKey(evidence));
  const decision = {at, episode, pattern: evidence.pattern, selected: !!rule};
  decisions.push(decision);
  const replay = horizonMinutes => {
    if (at + horizonMinutes * MINUTE > through) return null;
    return replayPullbackPolicy(plan, warmup.slice(barIndex, Math.min(barIndex + horizonMinutes + 1, sessionBarEnd)), {
      ...classroomCost, evaluationEnd: through, horizonMinutes,
    });
  };
  if (!baselineEpisodes.has(episode) && at >= baselineAvailable) {
    const trial = replay(20);
    if (trial?.status === 'RESOLVED') {
      baseline.push(trial);
      baselineEpisodes.add(episode);
      baselineAvailable = trial.entryAt + trial.durationMinutes * MINUTE;
      decision.referenceOutcome = trial;
    }
  }
  if (rule && !selectedEpisodes.has(episode) && at >= selectedAvailable) {
    const trial = replay(rule.holdMinutes);
    if (trial?.status === 'RESOLVED') {
      examined.push(trial);
      selectedEpisodes.add(episode);
      selectedAvailable = trial.entryAt + trial.durationMinutes * MINUTE;
      decision.selectedOutcome = trial;
    }
  }
});

const stats = summarizePullbackPolicies(examined);
const portfolio = {...stats, count: stats.n, drawdownR: stats.maxDrawdownR};
const reference = summarizePullbackPolicies(baseline);
const qualifies = days.size >= 5 && portfolio.count >= educationMinimums.exam &&
  portfolio.netR > Math.max(0, reference.netR) && portfolio.profitFactor > 1 &&
  portfolio.drawdownR <= reference.maxDrawdownR;
const exam = {version: model.id, label: 'FORWARD', from, through, inputDigest: expectedHash, qualifies,
  bars: rows.length, marketDays: days.size, patterns, actionable: executable, portfolio, reference,
  verdict: qualifies ? 'QUALIFIED' : !eligible.size ? 'NO_DEVELOPMENT_RULES' :
    days.size < 5 || stats.n < educationMinimums.exam ? 'INSUFFICIENT_FORWARD_SAMPLE' : 'REJECTED'};
const result = {...model, exam};
if (!checkEducation(result)) throw Error('INVALID_EXAM');
db.exec('BEGIN IMMEDIATE');
try {
  if (db.prepare('SELECT 1 FROM classroom_exams WHERE version_id = ?').get(model.id)) throw Error('MODEL_ALREADY_EXAMINED');
  db.prepare('INSERT INTO classroom_exams VALUES (?,?,?)').run(model.id, expectedHash, JSON.stringify({exam, decisions}));
  fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n', {mode: 0o600, flag: 'wx'});
  db.exec('COMMIT');
} catch (error) {
  db.exec('ROLLBACK');
  throw error;
}
db.close();
console.log(JSON.stringify(exam, null, 2));
