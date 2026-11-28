// Offline, provider-free replay. M1 MID input is converted to synthetic BID
// using explicit costs. A separately pinned later month is an untouched exam.
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';
import path from 'node:path';
import { loadMonth, coverage, SPLITS as ARCHIVE_SPLITS } from '../research/archive.mjs';
import { replayPullback, scanPullbacks, trainKnowledge } from '../intelligence/apex4-engine.ts';
import { validatePullbackReplay } from '../intelligence/apex4-replay-validation.mjs';
import { rollingSplits } from '../intelligence/xaucloud/aiTradingEducation.ts';

const { positionals, values: options } = parseArgs({
  allowPositionals: true,
  options: {
    'archive-only': { type: 'boolean' },
    'unseen-file': { type: 'string' },
    'unseen-sha256': { type: 'string' },
    'commission-per-ounce': { type: 'string', default: '0' },
    'cost-sensitivity': { type: 'boolean' },
  },
});
const [dirArg, outArg, spreadArg = '0.30', slipArg = '0.10'] = positionals;
if (!dirArg || !outArg || positionals.length > 4) throw Error('Provide an export directory (or --archive-only archive directory), a private output file, spread and slippage.');
const dir = path.resolve(dirArg), out = path.resolve(outArg);
const spread = Number(spreadArg), slippage = Number(slipArg);
const commissionPerOunce = Number(options['commission-per-ounce']);
if (!(spread > 0 && slippage >= 0 && commissionPerOunce >= 0) ||
    ![spread, slippage, commissionPerOunce].every(Number.isFinite)) {
  throw Error('Invalid cost assumptions');
}
if (Boolean(options['unseen-file']) !== Boolean(options['unseen-sha256'])) {
  throw Error('Provide both the unseen file and its SHA-256');
}

const raw = [];
function appendBar(b) {
  if (![b.t, b.o, b.h, b.l, b.c].every(Number.isFinite) || b.t % 60_000 !== 0 ||
      b.l <= 0 || b.l > Math.min(b.o, b.c) || b.h < Math.max(b.o, b.c) ||
      (raw.length && b.t <= raw.at(-1).t)) throw Error('Invalid or unordered archive row');
  raw.push({ t: b.t, o: b.o, h: b.h, l: b.l, c: b.c });
}
async function checkDigest(file, digest) {
  const expected = String(digest ?? '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(expected)) throw Error('Invalid SHA-256');
  if (createHash('sha256').update(await fs.readFile(file)).digest('hex') !== expected) {
    throw Error('Archive SHA-256 mismatch: ' + path.basename(file));
  }
  return expected;
}
function monthOf(file) {
  const month = /^XAUUSD_M1_(\d{4}_\d{2})\.csv\.gz$/.exec(path.basename(file))?.[1];
  if (!month) throw Error('Invalid archive filename');
  return month;
}

let meta, cases, archiveSource;
if (options['archive-only']) {
  const manifest = coverage(dir);
  if (manifest?.source !== 'EXNESS_PUBLIC_TICKS_M1' || !Array.isArray(manifest.files)) {
    throw Error('No verified archive manifest');
  }
  for (const f of manifest.files) {
    const month = monthOf(f.file);
    await checkDigest(path.join(dir, f.file), f.sha256);
    const rows = loadMonth(month, dir);
    if (rows.length !== f.rows) throw Error('Archive row count mismatch: ' + month);
    for (const b of rows) appendBar(b);
  }
  meta = { bars: manifest.totalM1Bars };
  cases = [];
  archiveSource = manifest.source;
} else {
  meta = JSON.parse(await fs.readFile(path.join(dir, 'metadata.json'), 'utf8'));
  cases = JSON.parse(await fs.readFile(path.join(dir, 'cases.json'), 'utf8'));
  if (meta.source !== 'XAUCLOUD_EXNESS_PUBLIC_TICKS_M1_MID' || !Array.isArray(cases) || !cases.length) {
    throw Error('No verified historical case export. Use --archive-only for a pullback-only study.');
  }
  archiveSource = meta.source;
  for await (const line of createInterface({ input: createReadStream(path.join(dir, 'bars.ndjson')), crlfDelay: Infinity })) {
    if (line.trim()) appendBar(JSON.parse(line));
  }
}
if (raw.length < 10_000 || raw.length !== meta.bars) throw Error('Insufficient or incomplete price archive');

const originalCount = raw.length;
let unseen = null;
if (options['unseen-file']) {
  const file = path.resolve(options['unseen-file']), month = monthOf(file);
  const sha256 = await checkDigest(file, options['unseen-sha256']);
  const rows = loadMonth(month, path.dirname(file));
  if (!rows.length || rows[0].t <= raw.at(-1).t) throw Error('The unseen archive must begin after the base archive');
  for (const b of rows) appendBar(b);
  unseen = { from: rows[0].t, through: rows.at(-1).t + 60_000, bars: rows.length, sha256 };
}
const first = raw[0].t, last = raw.at(-1).t + 60_000;
const historicalEnd = unseen?.from ?? Math.min(last, Date.now());
const through = Math.min(last, Date.now());
const pTrain = options['archive-only'] ? ARCHIVE_SPLITS.TRAIN.to : raw[Math.floor(originalCount * .6)].t;
const pValidation = options['archive-only'] ? ARCHIVE_SPLITS.VALIDATION.to : raw[Math.floor(originalCount * .8)].t;
const splits = cases.length ? rollingSplits(cases) : null;
const trainEnd = splits ? Date.parse(splits.train_end) : pTrain;
const validationEnd = splits ? Date.parse(splits.validation_end) : pValidation;
const outlookThrough = cases.length ? Math.min(meta.to, Date.now()) : through;
const windows = [
  { name: 'train', from: first, to: pTrain },
  { name: 'validation', from: pTrain, to: pValidation },
  { name: 'historicalHoldout', from: pValidation, to: historicalEnd },
  ...(unseen ? [{ name: 'unseen', from: unseen.from, to: unseen.through }] : []),
];

function stats(rows) {
  let running = 0, peak = 0, drawdown = 0;
  for (const row of rows) {
    running += row.r;
    peak = Math.max(peak, running);
    drawdown = Math.max(drawdown, peak - running);
  }
  const average = key => rows.length ? rows.reduce((sum, x) => sum + Number(x[key]), 0) / rows.length : null;
  return {
    n: rows.length,
    winRate: rows.length ? rows.filter(x => x.r > 0).length / rows.length : null,
    tp1Rate: average('tp1'), tp2Rate: average('tp2'), stopRate: average('stopped'),
    expectancyR: average('r'), netR: running, maxDrawdownR: drawdown,
    meanMaeR: average('maeR'), meanMfeR: average('mfeR'),
  };
}
function report(rows, chosen) {
  return Object.fromEntries(windows.map(w => {
    const cohort = rows.filter(x => x.at >= w.from && x.at + 20 * 60_000 <= w.to);
    const families = [...new Set(cohort.map(c => c.group.startsWith('CONTINUATION|')
      ? 'TREND_PULLBACK_RECLAIM' : 'COUNTERTREND_CORRECTION'))].sort();
    return [w.name, {
      all: stats(cohort), selected: stats(cohort.filter(c => chosen.has(c.group))),
      byFamily: Object.fromEntries(families.map(family => [family, stats(cohort.filter(c =>
        c.group.startsWith('CONTINUATION|') === (family === 'TREND_PULLBACK_RECLAIM')
      ))])),
    }];
  }));
}

function delayedReplay(plan, bars, index, delay, cost) {
  const side = plan.side === 'BUY' ? 1 : -1;
  const start = bars[index + delay];
  if (!start || start.t !== plan.published + delay * 60_000) return { status: 'FEED_GAP' };
  for (const bar of bars.slice(index, index + delay)) {
    const adverse = side > 0 ? bar.l : bar.h + cost.spread;
    const favorable = side > 0 ? bar.h : bar.l + cost.spread;
    if (side * (adverse - plan.sl) <= 0) return { status: 'INVALIDATED' };
    if (side * (favorable - plan.tp2) >= 0) return { status: 'MISSED_TP2' };
  }
  const entry = start.o + (side > 0 ? cost.spread : 0);
  if (side * (entry - plan.sl) <= 0) return { status: 'INVALIDATED' };
  if (side * (entry - plan.tp1) >= 0) return { status: 'MISSED_ENTRY' };
  const candidate = { ...plan, entry, published: start.t };
  const outcome = replayPullback(candidate, bars.slice(index + delay, index + delay + 20),
    cost.spread, cost.slippage, 20, cost.commissionPerOunce);
  return outcome ? { status: 'REPLAYED', outcome } : { status: 'NO_REPLAY' };
}

function compareTiming(pairs) {
  return Object.fromEntries(windows.map(w => {
    const cutoff = w.to - 23 * 60_000;
    const cohort = pairs.filter(x => x.immediate.at >= w.from && x.immediate.at <= cutoff);
    return [w.name, {
      immediate: stats(cohort.map(x => x.immediate)),
      delayed: [1, 3].map((minutes, i) => {
        const states = cohort.map(x => x.delayed[i]);
        const paired = cohort.filter(x => x.delayed[i].status === 'REPLAYED');
        return { minutes, attempted: cohort.length,
          dispositions: Object.fromEntries([...new Set(states.map(x => x.status))].sort().map(s =>
            [s, states.filter(x => x.status === s).length])),
          immediateMatched: stats(paired.map(x => x.immediate)),
          delayedMatched: stats(paired.map(x => x.delayed[i].outcome)) };
      }),
    }];
  }));
}

const mainCosts = { spread, slippage, commissionPerOunce };
const scenarios = [{ label: 'baseline', ...mainCosts }];
if (options['cost-sensitivity']) scenarios.push(
  { label: 'lowerCost', spread: .20, slippage: .05, commissionPerOunce: .07 },
  { label: 'higherCost', spread: .50, slippage: .20, commissionPerOunce: .10 },
);

let knowledge, selected;
const results = [];
for (const cost of scenarios) {
  const bid = raw.map(x => ({
    t: x.t, o: x.o - cost.spread / 2, h: x.h - cost.spread / 2,
    l: x.l - cost.spread / 2, c: x.c - cost.spread / 2,
  }));
  const timing = [];
  const rows = scanPullbacks(bid, cost.spread, cost.slippage, cost.commissionPerOunce,
    cost.label === 'baseline' ? (p, i, immediate) => timing.push({ immediate,
      delayed: [1, 3].map(delay => delayedReplay(p, bid, i, delay, cost)) }) : undefined);
  if (!knowledge) {
    knowledge = trainKnowledge(cases, rows.filter(x => x.at < historicalEnd), trainEnd, validationEnd, outlookThrough,
      { trainEnd: pTrain, validationEnd: pValidation });
    selected = new Set(knowledge.pullbacks.map(p => p.group));
  }
  results.push({ cost, splits: report(rows, selected), ...(timing.length ? { timing: compareTiming(timing) } : {}) });
}
knowledge.diagnostics.archive = {
  source: archiveSource, bars: originalCount, from: first, through: historicalEnd, unseen,
  zeroProductionCases: !cases.length,
};
knowledge.diagnostics.costScenario = {
  ...mainCosts, archive: 'MID converted to synthetic BID', minuteResolution: true,
  commissionNotIncluded: commissionPerOunce === 0,
};
knowledge.diagnostics.replay = {
  method: 'Closed candles only. First executable quote at the next minute open. Stop first within ambiguous bars. TP2 basket exit. Sequential 20-minute observations with boundary purges. Drawdown in cumulative initial-risk units.',
  costBasis: 'MID converted to synthetic BID; USD/oz spread, per-side slippage, and round-trip commission. Minute resolution.',
  windows, results,
};
knowledge = validatePullbackReplay(knowledge);
await fs.writeFile(out + '.tmp', JSON.stringify(knowledge, null, 2), { flag: 'wx', mode: 0o600 });
await fs.rename(out + '.tmp', out);
console.log(JSON.stringify({
  cases: knowledge.diagnostics.caseCount, pullbacks: knowledge.diagnostics.pullbackCaseCount,
  hoursWAT: knowledge.hours, selectedBeforeExam: [...selected],
  exam: knowledge.diagnostics.pullbackSelection, results, output: out,
}));
