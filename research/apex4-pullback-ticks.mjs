import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { pipeline } from 'node:stream/promises';
import { summarizePullbackPolicies } from './apex4-pullback-exits.mjs';

const minute = 60_000;
const managementPolicies = ['TP2', 'TP1', 'PARTIAL', 'PARTIAL_PROTECTED'];

/** Reprice the original November plan geometry using recorded Exness bid/ask ticks. */
export async function replayNovemberTicks(zip, opportunities, {
  slippage = .10, commissionPerOunce = .07, maxSpread = .35, entryExpiry = 12_000, includeCases = false,
} = {}) {
  const groups = opportunities.map(({ plan, family }) => ({
    plan, family, status: 'PENDING',
    direction: plan.side === 'BUY' ? 1 : -1, expiry: plan.published + entryExpiry,
    deadline: plan.published + 20 * minute,
  })).sort((a, b) => a.plan.published - b.plan.published);
  const command = spawn('unzip', ['-p', zip, 'Exness_XAUUSD_2026_11.csv'], {
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  // The source ZIP appends a Nov 25 block after Nov 26. Preserve original
  // order at equal timestamps and sort by the timestamp field before scoring.
  const sorter = spawn('sort', ['-s', '-t', ',', '-k3,3'], {
    env: {...process.env, LC_ALL: 'C'}, stdio: ['pipe', 'pipe', 'inherit'],
  });
  const completed = Promise.all([once(command, 'close'), once(sorter, 'close'), pipeline(command.stdout, sorter.stdin)]);
  const input = createInterface({ input: sorter.stdout, crlfDelay: Infinity });
  const tickLine = /^"exness","XAUUSD","(2026-11-\d\d) (\d\d):(\d\d):(\d\d)\.(\d\d\d)Z",([\d.]+),([\d.]+)$/;
  let date, dayStart, previousTimestamp = 0, cursor = 0, ticks = 0;
  let active = [];

  function recordOutcome(candidate, basket, price, timestamp, completion) {
    const { direction, fill, risk, entryAt } = candidate;
    const remaining = 1 - basket.closed;
    basket.gross += remaining * direction * (price - direction * slippage - fill);
    basket.closed = 1;
    const r = (basket.gross - commissionPerOunce) / risk;
    basket.outcome = {
      status: 'RESOLVED', at: candidate.plan.published, r, completion, stopped: completion === 'SL',
      netPrice: basket.gross - commissionPerOunce,
      tp1: basket.tp1Minutes !== null, tp2: basket.tp2Minutes !== null,
      tp1Minutes: basket.tp1Minutes, tp2Minutes: basket.tp2Minutes,
      maeR: basket.mae / risk, mfeR: basket.mfe / risk, maePrice: basket.mae, mfePrice: basket.mfe,
      durationMinutes: (timestamp - entryAt) / minute, stopDistance: risk,
      stopDistancePreSlippage: risk - slippage,
    };
  }

  function settle(candidate, timestamp, bid, ask) {
    const { direction, plan, fill, entryAt } = candidate;
    const quote = direction > 0 ? bid : ask;
    const elapsed = (timestamp - entryAt) / minute;
    for (const [policy, basket] of candidate.baskets) {
      if (basket.outcome) continue;
      if (timestamp > candidate.deadline + minute) continue;
      basket.mae = Math.max(basket.mae, direction * (fill - quote));
      if (direction * (quote - basket.stop) <= 0) {
        recordOutcome(candidate, basket, quote, timestamp, 'SL');
        continue;
      }
      basket.mfe = Math.max(basket.mfe, direction * (quote - fill));
      if (timestamp >= candidate.deadline) {
        recordOutcome(candidate, basket, quote, timestamp, 'TIME');
        continue;
      }
      if (basket.tp1Minutes === null && direction * (quote - plan.tp1) >= 0) {
        basket.tp1Minutes = elapsed;
        if (policy === 'TP1') {
          recordOutcome(candidate, basket, plan.tp1, timestamp, 'TP1');
          continue;
        }
        if (policy === 'PARTIAL' || policy === 'PARTIAL_PROTECTED') {
          basket.gross = direction * (plan.tp1 - direction * slippage - fill) * .5;
          basket.closed = .5;
        }
        if (policy === 'PARTIAL_PROTECTED') {
          const protectedStop = fill + direction * (slippage + commissionPerOunce);
          if (direction * (protectedStop - plan.tp1) < 0) basket.stop = protectedStop;
        }
      }
      if (direction * (quote - plan.tp2) >= 0) {
        basket.tp2Minutes = elapsed;
        recordOutcome(candidate, basket, plan.tp2, timestamp, 'TP2');
      }
    }
    return timestamp <= candidate.deadline + minute &&
      [...candidate.baskets.values()].some(basket => !basket.outcome);
  }

  for await (const line of input) {
    if (line === '"Exness","Symbol","Timestamp","Bid","Ask"') continue;
    const match = tickLine.exec(line);
    if (!match) throw Error('Malformed Exness November tick');
    const [, tickDate, hour, min, sec, millis, bidString, askString] = match;
    if (tickDate !== date) {
      date = tickDate;
      dayStart = Date.parse(`${date}T00:00:00Z`);
    }
    const at = dayStart + (((Number(hour) * 60 + Number(min)) * 60 + Number(sec)) * 1_000 + Number(millis));
    const bid = Number(bidString), ask = Number(askString);
    if (at < previousTimestamp || bid <= 0 || ask < bid) throw Error('Unordered or invalid Exness quote');
    previousTimestamp = at;
    ticks++;
    while (groups[cursor]?.plan.published <= at) {
      const candidate = groups[cursor++];
      const { plan, direction } = candidate;
      if (includeCases) candidate.firstQuote = { at, bid, ask };
      const entry = direction > 0 ? ask : bid;
      const exitQuote = direction > 0 ? bid : ask;
      if (at >= candidate.expiry) candidate.status = 'MISSED_ENTRY';
      else if (ask - bid > maxSpread) candidate.status = 'SPREAD_BLOCK';
      else if (Math.abs(entry - plan.entry) > Math.abs(plan.entry - plan.sl) * .25) candidate.status = 'PRICE_DRIFT';
      else if (direction * (entry - plan.tp1) >= 0 || direction * (exitQuote - plan.sl) <= 0) candidate.status = 'INVALIDATED';
      else {
        candidate.status = 'FILLED_MODEL';
        candidate.entryAt = at;
        candidate.fill = entry + direction * slippage;
        candidate.risk = direction * (candidate.fill - plan.sl);
        candidate.spread = ask - bid;
        candidate.baskets = new Map(managementPolicies.map(policy => [policy, {
          stop: plan.sl, closed: 0, mae: 0, mfe: 0, tp1Minutes: null, tp2Minutes: null, gross: 0,
        }]));
        active.push(candidate);
      }
    }
    if (active.length) active = active.filter(candidate => settle(candidate, at, bid, ask));
  }
  const [[unzipCode], [sortCode]] = await completed;
  if (unzipCode !== 0 || sortCode !== 0 || ticks !== 7_606_941) throw Error('Unverified November tick coverage');

  const withFill = groups.filter(x => x.status === 'FILLED_MODEL');
  const resultFor = (candidate, policy) => candidate.baskets?.get(policy)?.outcome ?? {
    status: ['FILLED_MODEL', 'PENDING'].includes(candidate.status) ? 'CENSORED' : candidate.status,
  };
  return {
    source: 'Exness November recorded tick bid/ask, stable-sorted by timestamp. First quote at or after publication. Fixed model slippage and commission.',
    ticks,
    entrySpreadMean: withFill.length ? withFill.reduce((sum, row) => sum + row.spread, 0) / withFill.length : null,
    policies: Object.fromEntries(managementPolicies.map(policy => [
      policy, summarizePullbackPolicies(groups.map(candidate => resultFor(candidate, policy))),
    ])),
    ...(includeCases ? {
      cases: groups.map(candidate => ({
        planId: candidate.plan.id,
        firstQuote: candidate.firstQuote ?? null,
        entryStatus: candidate.status,
        entryAt: candidate.entryAt ?? null,
        modeledFill: candidate.fill ?? null,
        policies: Object.fromEntries(managementPolicies.map(policy => [policy, resultFor(candidate, policy)])),
      })),
    } : {}),
  };
}
