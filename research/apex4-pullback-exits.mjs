const minute = 60_000;
const policies = new Set(['TP2', 'TP1', 'PARTIAL', 'PARTIAL_PROTECTED', 'TRAIL', 'MOMENTUM', 'STRUCTURE']);

function lowerBound(bars, timestamp) {
  let low = 0, high = bars.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (bars[middle].t < timestamp) low = middle + 1;
    else high = middle;
  }
  return low;
}

const sideOf = plan => plan.side === 'BUY' ? 1 : -1;
const adverseAt = (bar, side, spread) => side > 0 ? bar.l : bar.h + spread;
const favorableAt = (bar, side, spread) => side > 0 ? bar.h : bar.l + spread;

/**
 * Estimate price geometry from candles that are complete when the entry is
 * proposed. STRUCTURAL uses the latest confirmed five-bar pivot, plus ATR and
 * spread buffers. VOLATILITY measures distance from the executable entry.
 */
export function pullbackStop(plan, history, { kind, spread, atrMultiple = kind === 'STRUCTURAL' ? .25 : 1.5 }) {
  const side = sideOf(plan);
  const end = lowerBound(history, plan.published - minute + 1);
  const bars = history.slice(Math.max(0, end - 31), end);
  if (bars.length < 15) return null;
  const recent = bars.slice(-15);
  const atr = recent.slice(1).reduce((sum, bar, i) => sum + Math.max(
    bar.h - bar.l,
    Math.abs(bar.h - recent[i].c),
    Math.abs(bar.l - recent[i].c),
  ), 0) / 14;
  if (kind === 'VOLATILITY') return plan.entry - side * (atr * atrMultiple + spread);
  if (kind !== 'STRUCTURAL') throw Error('Unknown pullback stop geometry');
  const extreme = bar => side > 0 ? bar.l : bar.h;
  for (let i = bars.length - 3; i >= 2; i--) {
    const level = extreme(bars[i]);
    if ([i - 2, i - 1, i + 1, i + 2].every(j => side * (extreme(bars[j]) - level) > 0)) {
      return level - side * (atr * atrMultiple + spread);
    }
  }
  return null;
}

/**
 * M1 bars are synthetic bids. Policy prices are absolute USD/oz; returns use
 * the risk from filled entry to initial stop, before exit slippage/commission.
 * evaluationEnd and sessionEnd are exclusive. Session exits require a known
 * boundary. Missing data is kept distinct from missed entries.
 */
export function replayPullbackPolicy(plan, bars, {
  spread = .30, slippage = .10, commissionPerOunce = .07,
  horizonMinutes = 20, sessionEnd = null, evaluationEnd = Infinity,
  management = 'TP2', tp1Fraction = .5, stopPrice = plan.sl,
  entryDelayMinutes = 0, entryLimit = null,
  gapStop = 'OPEN',
} = {}) {
  if (![spread, slippage, commissionPerOunce].every(x => Number.isFinite(x) && x >= 0) ||
      !policies.has(management) ||
      !['OPEN', 'STOP_PRICE'].includes(gapStop) ||
      !Number.isFinite(tp1Fraction) || tp1Fraction <= 0 || tp1Fraction >= 1 ||
      !Number.isInteger(entryDelayMinutes) || entryDelayMinutes < 0 ||
      (horizonMinutes !== null && (!Number.isInteger(horizonMinutes) || horizonMinutes <= 0)) ||
      (entryDelayMinutes > 0 && entryLimit !== null)) throw Error('Invalid pullback replay options');

  const side = sideOf(plan);
  const at = Math.ceil(plan.published / minute) * minute;
  const result = status => ({ status, at: plan.published, group: plan.group ?? 'UNKNOWN' });
  if (!['BUY', 'SELL'].includes(plan.side) ||
      ![at, plan.entry, plan.tp1, plan.tp2, stopPrice].every(Number.isFinite) ||
      side * (plan.entry - stopPrice) <= 0 ||
      side * (plan.tp1 - plan.entry) <= 0 ||
      side * (plan.tp2 - plan.tp1) <= 0) return result('INVALID_PLAN');

  const first = lowerBound(bars, at);
  const terminal = Math.min(sessionEnd ?? Infinity, evaluationEnd);
  if (bars[first]?.t !== at || at >= terminal) return result('CENSORED');
  let entryIndex = first, entry = plan.entry, intrabarLimit = false;
  let limitFill = false;
  if (entryDelayMinutes > 0) {
    for (let offset = 0; offset < entryDelayMinutes; offset++) {
      const bar = bars[first + offset];
      if (bar?.t !== at + offset * minute || bar.t >= terminal) return result('CENSORED');
      if (side * (adverseAt(bar, side, spread) - stopPrice) <= 0) return result('INVALIDATED');
      if (side * (favorableAt(bar, side, spread) - plan.tp2) >= 0) return result('TARGET_BEFORE_ENTRY');
    }
    entryIndex = first + entryDelayMinutes;
    const delayed = bars[entryIndex];
    if (delayed?.t !== at + entryDelayMinutes * minute || delayed.t >= terminal) return result('CENSORED');
    entry = delayed.o + (side > 0 ? spread : 0);
    if (side * (entry - stopPrice) <= 0) return result('INVALIDATED');
    if (side * (entry - plan.tp1) >= 0) return result('MISSED_ENTRY');
  }
  if (entryLimit !== null) {
    const { price, validMinutes } = entryLimit;
    if (!Number.isFinite(price) || !Number.isInteger(validMinutes) || validMinutes < 1 ||
        side * (price - stopPrice) <= 0 || side * (plan.entry - price) <= 0) return result('INVALID_PLAN');
    const quoteSpread = side > 0 ? spread : 0;
    for (let offset = 0; offset < validMinutes; offset++) {
      const bar = bars[first + offset];
      if (bar?.t !== at + offset * minute || bar.t >= terminal) return result('CENSORED');
      const marketableAtOpen = side * (bar.o + quoteSpread - price) <= 0;
      const strictlyPassed = side * ((side > 0 ? bar.l : bar.h) + quoteSpread - price) < 0;
      if (marketableAtOpen || strictlyPassed) {
        entryIndex = first + offset;
        entry = price;
        limitFill = true;
        intrabarLimit = !marketableAtOpen;
        break;
      }
      if (side * (favorableAt(bar, side, spread) - plan.tp2) >= 0) return result('TARGET_BEFORE_ENTRY');
    }
    if (!limitFill) return result('MISSED_ENTRY');
  }

  const fill = entry + side * (limitFill ? 0 : slippage);
  const risk = side * (fill - stopPrice);
  if (!(risk > 0) || side * (plan.tp2 - fill) <= 0) return result('INVALID_PLAN');
  const entryAt = bars[entryIndex].t;
  const deadline = horizonMinutes === null ? Infinity : entryAt + horizonMinutes * minute;
  const sessionIsExit = Number.isFinite(sessionEnd) && sessionEnd <= evaluationEnd && sessionEnd <= deadline;
  const closeAt = Math.min(terminal, deadline);
  const exitAt = Math.min(deadline, sessionEnd ?? Infinity);
  const firstAfter = lowerBound(bars, closeAt);
  const expectedBars = (closeAt - entryAt) / minute;
  // The original benchmark tolerated two missing bars. Explicit archive and
  // session boundaries still cannot be extended beyond authenticated coverage.
  if (firstAfter <= entryIndex || (firstAfter - entryIndex < expectedBars - 2)) return result('CENSORED');
  let closedFraction = 0, gross = 0, activeStop = stopPrice, mae = 0, mfe = 0;
  let tp1Minutes = null, tp2Minutes = null, stopped = false, completion = '';
  let momentumLosses = 0, structure = null, exitOnOpen = false;
  let lastIndex = entryIndex;
  let exitPrice = fill;
  function closeAtPrice(reference, fraction) {
    exitPrice = reference - side * slippage;
    gross += fraction * side * (exitPrice - fill);
    closedFraction += fraction;
  }

  for (let i = entryIndex; i < firstAfter; i++) {
    const bar = bars[i];
    lastIndex = i;
    const bidToClosingQuote = side < 0 ? spread : 0;
    const open = bar.o + bidToClosingQuote;
    const adverse = adverseAt(bar, side, spread);
    const favorable = favorableAt(bar, side, spread);
    const duration = (bar.t - entryAt) / minute + 1;
    if (exitOnOpen && side * (open - activeStop) > 0) {
      mae = Math.max(mae, side * (fill - open));
      mfe = Math.max(mfe, side * (open - fill));
      closeAtPrice(open, 1 - closedFraction);
      completion = management;
      break;
    }
    mae = Math.max(mae, side * (fill - adverse));
    if (side * (adverse - activeStop) <= 0) {
      const gap = gapStop === 'OPEN' && side * (open - activeStop) < 0;
      closeAtPrice(gap ? open : activeStop, 1 - closedFraction);
      stopped = true;
      completion = 'SL';
      break;
    }
    if (intrabarLimit && i === entryIndex) continue;
    mfe = Math.max(mfe, side * (favorable - fill));
    if (tp1Minutes === null && side * (favorable - plan.tp1) >= 0) {
      tp1Minutes = duration;
      if (management === 'TP1') {
        closeAtPrice(plan.tp1, 1);
        completion = 'TP1';
        break;
      }
      if (management === 'PARTIAL' || management === 'PARTIAL_PROTECTED') {
        closeAtPrice(plan.tp1, tp1Fraction);
      }
    }
    if (side * (favorable - plan.tp2) >= 0) {
      tp2Minutes = duration;
      closeAtPrice(plan.tp2, 1 - closedFraction);
      completion = 'TP2';
      break;
    }
    if (tp1Minutes !== null) {
      const protectAt = fill + side * (slippage + commissionPerOunce);
      if (management === 'PARTIAL_PROTECTED' &&
          side * (protectAt - plan.tp1) < 0 && side * (protectAt - activeStop) > 0) {
        activeStop = protectAt;
      }
      if (management === 'TRAIL') {
        const proposed = fill + side * (mfe - risk * .5);
        if (side * (proposed - activeStop) > 0) activeStop = proposed;
      }
    }
    if (management === 'MOMENTUM' && i > entryIndex) {
      momentumLosses = side * (bar.c - bars[i - 1].c) < 0 ? momentumLosses + 1 : 0;
      exitOnOpen = momentumLosses >= 2 && tp1Minutes !== null;
    }
    if (management === 'STRUCTURE' && i >= entryIndex + 4) {
      const pivot = adverseAt(bars[i - 2], side, spread);
      if (structure !== null && side * (bar.c + bidToClosingQuote - structure) < 0) exitOnOpen = true;
      if ([i - 4, i - 3, i - 1, i].every(j => side * (adverseAt(bars[j], side, spread) - pivot) > 0)) {
        structure = pivot;
      }
    }
  }
  if (!completion) {
    if (!Number.isFinite(exitAt) || closeAt < exitAt || bars[lastIndex].t + minute < closeAt - 2 * minute) {
      return result('CENSORED');
    }
    closeAtPrice(bars[lastIndex].c + (side < 0 ? spread : 0), 1 - closedFraction);
    completion = sessionIsExit ? 'SESSION_END' : 'TIME';
  }
  const durationMinutes = (bars[lastIndex].t - entryAt) / minute + 1;
  return {
    ...result('RESOLVED'), entryAt, entry: fill, exit: exitPrice, stop: stopPrice, completion,
    r: (gross - commissionPerOunce) / risk, netPrice: gross - commissionPerOunce,
    tp1: tp1Minutes !== null, tp2: tp2Minutes !== null, stopped, tp1Minutes, tp2Minutes,
    maeR: mae / risk, mfeR: mfe / risk, maePrice: mae, mfePrice: mfe,
    durationMinutes, stopDistance: risk, stopDistancePreSlippage: side * (entry - stopPrice),
  };
}

function quantile(values, percentile) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * percentile;
  const lower = Math.floor(index);
  return sorted[lower] + (sorted[Math.ceil(index)] - sorted[lower]) * (index - lower);
}

export function summarizePullbackPolicies(rows) {
  const dispositions = {};
  let equity = 0, peak = 0, maxDrawdownR = 0, grossPositiveR = 0, grossNegativeR = 0;
  const resolved = rows.filter(row => row.status === 'RESOLVED').sort((a, b) => a.at - b.at);
  const durations = resolved.map(row => row.durationMinutes);
  const stopDistances = resolved.map(row => row.stopDistance);
  const tp1Durations = resolved.flatMap(row => row.tp1 ? [row.tp1Minutes] : []);
  const tp2Durations = resolved.flatMap(row => row.tp2 ? [row.tp2Minutes] : []);
  for (const row of rows) dispositions[row.status] = (dispositions[row.status] ?? 0) + 1;
  for (const row of resolved) {
    equity += row.r;
    peak = Math.max(peak, equity);
    maxDrawdownR = Math.max(maxDrawdownR, peak - equity);
    if (row.r > 0) grossPositiveR += row.r;
    else grossNegativeR -= row.r;
  }
  const n = resolved.length;
  const evaluable = rows.length - (dispositions.CENSORED ?? 0) - (dispositions.INVALID_PLAN ?? 0);
  const winners = resolved.filter(row => row.r > 0).length;
  const avg = (field, items = resolved) => items.length ?
    items.reduce((sum, row) => sum + Number(row[field]), 0) / items.length : null;
  const medianStop = quantile(stopDistances, .5);
  return {
    opportunities: rows.length, evaluable, n, dispositions, winners,
    losers: resolved.filter(row => row.r < 0).length,
    winRate: n ? winners / n : null, tp1Rate: avg('tp1'), tp2Rate: avg('tp2'), stopRate: avg('stopped'),
    expectancyR: n ? equity / n : null, expectancyPerOpportunityR: evaluable ? equity / evaluable : null,
    netR: equity, maxDrawdownR, profitFactor: grossNegativeR > 0 ? grossPositiveR / grossNegativeR : null,
    grossPositiveR, grossNegativeR,
    meanMaeR: avg('maeR'), meanMfeR: avg('mfeR'), meanMaePrice: avg('maePrice'), meanMfePrice: avg('mfePrice'),
    medianDurationMinutes: quantile(durations, .5), medianTp1Minutes: quantile(tp1Durations, .5),
    medianTp2Minutes: quantile(tp2Durations, .5), p90Tp2Minutes: quantile(tp2Durations, .90),
    stopDistance: {
      p10: quantile(stopDistances, .1), median: medianStop, p90: quantile(stopDistances, .9),
      medianBeforeSlippage: quantile(resolved.map(row => row.stopDistancePreSlippage), .5),
      medianPipsAtPointOne: medianStop === null ? null : medianStop / .1,
      medianPointsAtPointZeroOne: medianStop === null ? null : medianStop / .01,
    },
  };
}
