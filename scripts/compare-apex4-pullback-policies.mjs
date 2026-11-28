import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { scanPullbacks } from '../intelligence/apex4-engine.ts';
import { coverage, loadMonth, ARCHIVE_DIR } from '../research/archive.mjs';
import { pullbackStop, replayPullbackPolicy, summarizePullbackPolicies } from '../research/apex4-pullback-exits.mjs';

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    'ticks-zip': { type: 'string' },
    'cases-json': { type: 'string' },
    'cases-csv': { type: 'string' },
  },
});
const [november, output] = positionals;
if (!november || !output || positionals.length !== 2 || basename(november) !== 'XAUUSD_M1_2026_11.csv.gz') {
  throw Error('Usage: compare-apex4-pullback-policies.mjs NOVEMBER_M1 REPORT_JSON [--ticks-zip ARCHIVE] [--cases-json LEDGER] [--cases-csv SHEET]');
}
const minute = 60_000;
const novemberDigest = '400d88e8d632c6be78ae7742e4d41a234d96d5332a4e3bba9309c5a6527bf10e';
const digest = file => createHash('sha256').update(readFileSync(file)).digest('hex');
assert.equal(digest(november), novemberDigest, 'November M1 archive hash');
const manifest = coverage(ARCHIVE_DIR);
const preceding = ['2026_09', '2026_10'].flatMap(month => {
  const file = `XAUUSD_M1_${month}.csv.gz`;
  const declared = manifest.files.find(row => row.file === file);
  assert.equal(digest(`${ARCHIVE_DIR}/${file}`), declared.sha256, 'Warmup M1 archive hash');
  const bars = loadMonth(month);
  assert.equal(bars.length, declared.rows);
  return bars;
});
const exam = loadMonth('2026_11', dirname(november));
assert.equal(exam.length, 26_089);
const from = exam[0].t;
const to = exam.at(-1).t + minute;
// More than 120 complete H1 frames are needed before November starts.
const raw = [...preceding.slice(-10_000), ...exam];
const costs = { spread: .30, slippage: .10, commissionPerOunce: .07 };
const makeBid = spread => raw.map(({ t, o, h, l, c }) => ({
  t, o: o - spread / 2, h: h - spread / 2, l: l - spread / 2, c: c - spread / 2,
}));
const bids = new Map([[.30, makeBid(.30)], [.20, makeBid(.20)], [.50, makeBid(.50)]]);

const calendar = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', weekday: 'short', hour: '2-digit', hourCycle: 'h23',
});
const sessionEnds = new Map();
function sessionEndAt(at) {
  const hour = 60 * minute;
  const start = Math.floor(at / hour) * hour;
  if (sessionEnds.has(start)) return sessionEnds.get(start);
  let candidate = start + hour;
  for (;; candidate += hour) {
    const parts = calendar.formatToParts(candidate);
    const h = Number(parts.find(p => p.type === 'hour')?.value);
    const day = parts.find(p => p.type === 'weekday')?.value;
    if (h === 17 && ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].includes(day)) break;
  }
  sessionEnds.set(start, candidate);
  return candidate;
}

const baseline = bids.get(.30);
const cases = [];
scanPullbacks(baseline, costs.spread, costs.slippage, costs.commissionPerOunce, (plan, index, original) => {
  if (original.at < from || original.at + 20 * minute > to) return;
  cases.push({ plan, index, original, family: original.group.startsWith('CONTINUATION|') ?
    'TREND_PULLBACK_RECLAIM' : 'COUNTERTREND_CORRECTION' });
});
assert.equal(cases.length, 142, 'Matched November cohort size');
assert.ok(Math.abs(cases.reduce((sum, x) => sum + x.original.r, 0) + 29.224653398237372) < 1e-9,
  'Matched November baseline P&L');

const scenarios = new Map([
  ['ORIGINAL', { gapStop: 'STOP_PRICE' }],
  ['LEGACY_FULL_TP1', { gapStop: 'STOP_PRICE', management: 'TP1' }],
  ...[10, 20, 30, 45, 60, 120, null].map(horizonMinutes => [
    horizonMinutes === null ? 'SESSION_END' : `HOLD_${horizonMinutes}M`, { horizonMinutes },
  ]),
  ...['TP1', 'PARTIAL', 'PARTIAL_PROTECTED', 'TRAIL', 'MOMENTUM', 'STRUCTURE'].map(management => [
    management, { management },
  ]),
  ...[1, 2, 3, 5].map(entryDelayMinutes => [`DELAY_${entryDelayMinutes}M`, { entryDelayMinutes }]),
  ['LIMIT_25_PERCENT_RISK_5M', { useLimit: true }],
  ['STRUCTURAL_STOP', { stopKind: 'STRUCTURAL' }],
  ['VOLATILITY_STOP', { stopKind: 'VOLATILITY' }],
  ['LOWER_COST', { spread: .20, slippage: .05, commissionPerOunce: .07 }],
  ['HIGHER_COST', { spread: .50, slippage: .20, commissionPerOunce: .10 }],
]);

const priceDistance = (a, b) => Number(Math.abs(a - b).toFixed(6));
const includeCases = Boolean(values['cases-json'] || values['cases-csv']);
const caseRows = includeCases ? cases.map(({ plan, original, family, index }) => ({
  plan,
  publishedUtc: new Date(plan.published).toISOString(),
  expiresUtc: new Date(plan.expires).toISOString(),
  family,
  distancesUsdPerOz: {
    entryToStop: priceDistance(plan.entry, plan.sl),
    entryToTp1: priceDistance(plan.entry, plan.tp1),
    entryToTp2: priceDistance(plan.entry, plan.tp2),
    tp1ToTp2: priceDistance(plan.tp1, plan.tp2),
  },
  original,
  policies: {},
  afterStop: { status: original.stopped ? 'CENSORED' : 'NO_STOP' },
  ...(values['cases-json'] ? {
    minuteBarsMid: raw.slice(Math.max(0, index - 20), index + 60)
      .filter(bar => bar.t >= plan.published - 20 * minute && bar.t < plan.published + 60 * minute)
      .map(bar => [bar.t, bar.o, bar.h, bar.l, bar.c]),
  } : {}),
})) : null;

const reports = {};
for (const [name, { useLimit, stopKind, ...overrides }] of scenarios) {
  const replayOptions = { ...costs, ...overrides, evaluationEnd: to };
  const bars = bids.get(replayOptions.spread);
  const tests = cases.map(({ plan, original, family }) => {
    const direction = plan.side === 'BUY' ? 1 : -1;
    const entry = plan.entry + direction * (replayOptions.spread - costs.spread) / 2;
    const opts = { ...replayOptions };
    if (name !== 'ORIGINAL' && name !== 'LEGACY_FULL_TP1') opts.sessionEnd = sessionEndAt(plan.published);
    if (useLimit) {
      opts.entryLimit = { price: entry - direction * Math.abs(entry - plan.sl) * .25, validMinutes: 5 };
    }
    if (stopKind) {
      opts.stopPrice = pullbackStop({ ...plan, entry }, bars, { kind: stopKind, spread: opts.spread });
      if (opts.stopPrice === null) return { family, status: 'INVALID_PLAN' };
    }
    const result = replayPullbackPolicy({ ...plan, entry }, bars, opts);
    if (name === 'ORIGINAL') {
      assert.equal(result.status, 'RESOLVED');
      assert.equal(result.r, original.r);
      assert.equal(result.tp1, original.tp1);
      assert.equal(result.tp2, original.tp2);
      assert.equal(result.maeR, original.maeR);
      assert.equal(result.mfeR, original.mfeR);
    }
    return { family, ...result };
  });
  if (caseRows) tests.forEach((result, index) => { caseRows[index].policies[name] = result; });
  reports[name] = {
    all: summarizePullbackPolicies(tests),
    byFamily: Object.fromEntries([...new Set(tests.map(x => x.family))].map(family => [
      family, summarizePullbackPolicies(tests.filter(x => x.family === family)),
    ])),
  };
}

let recoverable = 0, reachedAfterStop = 0;
for (const [caseIndex, { original, index, plan }] of cases.entries()) {
  const windowEnd = plan.published + 60 * minute;
  if (!original.stopped || windowEnd > Math.min(to, sessionEndAt(plan.published))) continue;
  const windowStart = plan.published + original.minutes * minute;
  const later = baseline.slice(index + original.minutes, index + 60).filter(bar => bar.t < windowEnd);
  if (later.length < 60 - original.minutes - 2) continue;
  recoverable++;
  const side = plan.side === 'BUY' ? 1 : -1;
  const favourable = bar => side > 0 ? bar.h : bar.l + costs.spread;
  const firstTp1 = later.find(bar => side * (favourable(bar) - plan.tp1) >= 0);
  const firstTp2 = later.find(bar => side * (favourable(bar) - plan.tp2) >= 0);
  if (firstTp2) reachedAfterStop++;
  if (caseRows) caseRows[caseIndex].afterStop = {
    status: 'OBSERVED',
    stopBarUtc: new Date(windowStart - minute).toISOString(),
    windowStartUtc: new Date(windowStart).toISOString(),
    windowEndExclusiveUtc: new Date(windowEnd).toISOString(),
    bars: later.length,
    firstTp1Utc: firstTp1 ? new Date(firstTp1.t).toISOString() : null,
    firstTp2Utc: firstTp2 ? new Date(firstTp2.t).toISOString() : null,
  };
}

let tickReplay;
if (values['ticks-zip']) {
  const zip = values['ticks-zip'];
  const tickDigest = 'c4914d04fef174e6e282814c46aebaca766c623afe8aa02f39e36c02ce2a10c3';
  assert.equal(digest(zip), tickDigest, 'November tick archive hash');
  const { replayNovemberTicks } = await import('../research/apex4-pullback-ticks.mjs');
  const { cases: tickRows, ...tickSummary } = await replayNovemberTicks(zip, cases, { includeCases });
  tickReplay = { sha256: tickDigest, ...tickSummary };
  if (caseRows) {
    const ticksByPlan = new Map(tickRows.map(row => [row.planId, row]));
    assert.equal(ticksByPlan.size, caseRows.length, 'One tick record per case');
    for (const row of caseRows) {
      row.tickReplay = ticksByPlan.get(row.plan.id);
      assert.ok(row.tickReplay, 'Matched tick case');
    }
  }
}

const report = {
  dataset: { from, to, bars: exam.length, sha256: novemberDigest, source: 'Exness public XAUUSD ticks, M1 MID' },
  role: 'Previously revealed November development diagnostic. Matching original entries does not create a fresh examination.',
  assumptions: {
    bidAsk: 'M1 MID to BID/ASK via fixed modeled spread. Round-trip commission and slippage are charged per ounce.',
    cohort: '142 original November setups. Later variants retain the original opportunity count. Missing data and absent valid geometry remain explicitly censored or invalid.',
    entry: 'Delays use next opens and skip prior invalidations and completed TP2 moves. Limits require passage beyond the price or marketability at open. Intrabar limits have no same-bar target credit, and stops can fire on the fill bar.',
    exits: 'SL gets priority within an ambiguous bar. Gap stops use the open where worse, except the two original-policy replicas. Stop updates and dynamic exits only use completed bars.',
    drawdown: 'Equal initial risk per filled opportunity, ordered by entry. Longer variants can overlap. This does not model levered account equity, sizing, layering, liquidation, or portfolio drawdown.',
    session: 'Next 17:00 New York daily market boundary. DST uses the New York time zone. A dataset ending mid-session censors unfinished positions.',
    costSensitivity: 'Spread changes executable prices, with original plan geometry and opportunity timestamps held fixed.',
  },
  originalStoppedThenReachedTp2: { fullObservedStops: recoverable, reachedTp2Within60Minutes: reachedAfterStop },
  scenarios: reports,
  ...(tickReplay ? { tickReplay } : {}),
};
const writeNewFile = (path, content) => writeFileSync(path, content, { flag: 'wx', mode: 0o600 });
writeNewFile(output, JSON.stringify(report, null, 2) + '\n');
if (values['cases-json']) {
  writeNewFile(values['cases-json'], JSON.stringify({
    schemaVersion: 1,
    dataset: report.dataset,
    role: report.role,
    modeledCostsUsdPerOz: costs,
    assumptions: report.assumptions,
    minuteBarFields: ['openTimeUtcMs', 'midOpen', 'midHigh', 'midLow', 'midClose'],
    afterStop: 'Target touches in minute bars from the minute following the original stop bar through 60 minutes from publication. These are subsequent prices, not simulated fills.',
    tickDatasetSha256: tickReplay?.sha256 ?? null,
    cases: caseRows,
  }, null, 2) + '\n');
}
if (values['cases-csv']) {
  const rows = caseRows.map(row => {
    const fullTp1 = row.policies.LEGACY_FULL_TP1;
    const original = row.policies.ORIGINAL;
    const tick = row.tickReplay;
    return {
      planId: row.plan.id, publishedUtc: row.publishedUtc, expiresUtc: row.expiresUtc,
      side: row.plan.side, family: row.family, group: row.plan.group, reason: row.plan.reason,
      plannedEntry: row.plan.entry, plannedStop: row.plan.sl, plannedTp1: row.plan.tp1, plannedTp2: row.plan.tp2,
      ...row.distancesUsdPerOz,
      originalFill: original.entry, originalExit: original.exit, originalCompletion: original.completion,
      originalNetR: original.r, originalTp1Touched: original.tp1, originalTp2Touched: original.tp2,
      originalMaeR: original.maeR, originalMfeR: original.mfeR, originalDurationMinutes: original.durationMinutes,
      fullTp1Completion: fullTp1.completion, fullTp1NetR: fullTp1.r,
      afterStopStatus: row.afterStop.status, afterStopFirstTp1Utc: row.afterStop.firstTp1Utc,
      afterStopFirstTp2Utc: row.afterStop.firstTp2Utc,
      tickEntryStatus: tick?.entryStatus, tickTp1NetR: tick?.policies.TP1.r, tickTp2NetR: tick?.policies.TP2.r,
    };
  });
  const csvLine = cells => cells.map(cell => '"' + String(cell ?? '').replaceAll('"', '""') + '"').join(',');
  writeNewFile(values['cases-csv'], [csvLine(Object.keys(rows[0])), ...rows.map(row => csvLine(Object.values(row)))].join('\n') + '\n');
}
console.log(JSON.stringify(Object.fromEntries(Object.entries(reports).map(([name, { all }]) => [
  name, { n: all.n, winRate: all.winRate, netR: all.netR, profitFactor: all.profitFactor, dispositions: all.dispositions },
])), null, 2));
