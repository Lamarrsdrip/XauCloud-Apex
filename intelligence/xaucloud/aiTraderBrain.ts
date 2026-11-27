// Ported from XauCloud 9e5f137753a9687670ed2105311f72b30891e29e / aiTraderBrain.ts, source blob 7cb66c6010830138885039ef65f75ccf14625294.
// Provider-free subset; see provenance.json for extraction boundaries.
import { aggregate, analyzeFrame, STRATEGY_EVIDENCE, type Bar, type Frame } from "./aiOpportunityEngine.ts";
import { CURRENT_OPPORTUNITY_POLICY, usableCurrentQuote } from "./aiCurrentOpportunity.ts";

/**
 * XauCloud AI — ONE trading brain with many read-only tools.
 *
 * Everything here is EVIDENCE for the selected model: multi-timeframe candles
 * and structure built from the bot's own broker prices, key levels, the
 * Hourly Outlook / M10 evidence recorded at publication, rule-engine ideas
 * (with their measured 5-year results), similar-setup history and the AI's own
 * measured mistakes. No deterministic layer here returns a verdict, and none
 * may override the model's decision. The only things the backend enforces are
 * data integrity (fresh executable price, no look-ahead) and trade geometry.
 *
 * Every builder takes `now` and uses only bars that CLOSED before `now`, so the
 * same code serves live opinions and the no-look-ahead historical replay.
 */
export const TRADER_BRAIN_VERSION = "TRADER_BRAIN_V4_CURRENT_50PIP";
const PIP = 0.1;
const r2 = (n: number) => Math.round(n * 100) / 100;
const pips = (d: number) => Math.round(d / PIP);
type Row = Record<string, unknown>;

export const TIMEFRAMES = { M1: 1, M5: 5, M10: 10, M15: 15, M30: 30, H1: 60, H4: 240, D1: 1440 } as const;
export type Timeframe = keyof typeof TIMEFRAMES;
/** Bars per timeframe kept in the pre-loaded evidence (the model can ask for more with get_candles). */
const PRELOAD_CANDLES: Partial<Record<Timeframe, number>> = { M1: 20, M5: 24, M15: 16, H1: 12, H4: 6, D1: 5 };

export interface Quote { bid: number; ask: number; at: string }

/** Completed bars of one timeframe at `now` (D1 buckets are UTC days). */
export function framesAt(m1: Bar[], tf: Timeframe, now: number): Bar[] {
  const past = m1.filter((b) => b.t + 60_000 <= now);
  return tf === "M1" ? past : aggregate(past, TIMEFRAMES[tf], now, tf === "D1" ? 300 : tf === "H4" ? 120 : undefined);
}

export function compactCandles(bars: Bar[], n: number): Array<[string, number, number, number, number]> {
  return bars.slice(-n).map((b) => [new Date(b.t).toISOString().slice(5, 16).replace("T", " "), r2(b.o), r2(b.h), r2(b.l), r2(b.c)]);
}

export interface FrameSummary {
  bars: number; trend: Frame["trend"]; atr_pips: number; close: number;
  momentum_atr: number; acceleration_atr: number; pressure: number; rsi: number; extension_atr: number;
  range_position_pct: number | null; last_swing_high: number | null; last_swing_low: number | null;
  flags: string[]; last_closed_at: string;
}
export function summarizeFrame(bars: Bar[]): FrameSummary | null {
  const f = analyzeFrame(bars, bars.length >= 60 ? 20 : 9, bars.length >= 60 ? 50 : 21);
  if (!f) return bars.length >= 5 ? shortSummary(bars) : null;
  const w = bars.slice(-20), hi = Math.max(...w.map((b) => b.h)), lo = Math.min(...w.map((b) => b.l));
  const flags = ([
    ["swept_high_and_closed_back_inside", f.sweptHigh], ["swept_low_and_closed_back_inside", f.sweptLow],
    ["closed_above_last_swing_high", f.brokeUp], ["closed_below_last_swing_low", f.brokeDown],
    ["structure_shift_up", f.structureShiftUp], ["structure_shift_down", f.structureShiftDown],
    ["upper_wick_rejection", f.upperRejection], ["lower_wick_rejection", f.lowerRejection],
    ["bearish_rsi_divergence", f.bearishDivergence], ["bullish_rsi_divergence", f.bullishDivergence],
  ] as const).filter(([, on]) => on).map(([k]) => k);
  return {
    bars: f.bars, trend: f.trend, atr_pips: pips(f.atr), close: f.close,
    momentum_atr: f.momentum, acceleration_atr: f.acceleration, pressure: f.pressure, rsi: Math.round(f.rsi), extension_atr: f.extension,
    range_position_pct: hi > lo ? Math.round(((f.close - lo) / (hi - lo)) * 100) : null,
    last_swing_high: f.lastSwingHigh, last_swing_low: f.lastSwingLow, flags, last_closed_at: new Date(f.last.t).toISOString(),
  };
}

/** H4/D1 often have fewer than 30 completed bars: plain direction, range and ATR, no indicators. */
function shortSummary(bars: Bar[]): FrameSummary {
  const first = bars[0]!, last = bars[bars.length - 1]!;
  const tr = bars.slice(1).map((b, i) => Math.max(b.h - b.l, Math.abs(b.h - bars[i]!.c), Math.abs(b.l - bars[i]!.c)));
  const atr = tr.reduce((s, x) => s + x, 0) / Math.max(1, tr.length);
  const hi = Math.max(...bars.map((b) => b.h)), lo = Math.min(...bars.map((b) => b.l));
  const net = last.c - first.o;
  const prev = bars[bars.length - 2]!;
  return { bars: bars.length, trend: Math.abs(net) < atr ? "RANGE" : net > 0 ? "UP" : "DOWN", atr_pips: pips(atr), close: last.c,
    momentum_atr: atr > 0 ? r2((last.c - (bars[Math.max(0, bars.length - 4)]!.c)) / atr) : 0, acceleration_atr: 0, pressure: 0, rsi: 50, extension_atr: 0,
    range_position_pct: hi > lo ? Math.round(((last.c - lo) / (hi - lo)) * 100) : null, last_swing_high: r2(hi), last_swing_low: r2(lo),
    flags: [...(last.c > prev.h ? ["closed_above_previous_bar_high"] : []), ...(last.c < prev.l ? ["closed_below_previous_bar_low"] : []), "short_history_no_indicators"],
    last_closed_at: new Date(last.t).toISOString() };
}

/** Day / session highs and lows, nearest swing levels above and below price. */
export function keyLevels(m1: Bar[], now: number, price: number): Row {
  const past = m1.filter((b) => b.t + 60_000 <= now);
  const day = Math.floor(now / 86_400_000) * 86_400_000;
  const span = (from: number, to: number) => {
    const xs = past.filter((b) => b.t >= from && b.t < to);
    return xs.length ? { high: r2(Math.max(...xs.map((b) => b.h))), low: r2(Math.min(...xs.map((b) => b.l))) } : null;
  };
  const swings = new Set<number>();
  for (const tf of ["M15", "H1", "H4"] as const) {
    const f = analyzeFrame(framesAt(m1, tf, now));
    for (const v of [...(f?.swingHighs ?? []), ...(f?.swingLows ?? [])]) swings.add(v);
  }
  const all = [...swings].sort((a, b) => a - b);
  const above = all.filter((v) => v > price).slice(0, 3), below = all.filter((v) => v < price).slice(-3).reverse();
  return {
    today: span(day, now), previous_day: span(day - 86_400_000, day),
    asia_today: span(day, day + 7 * 3600_000), london_today: span(day + 7 * 3600_000, Math.min(now, day + 12 * 3600_000)),
    nearest_levels_above: above.map((v) => ({ price: v, distance_pips: pips(v - price) })),
    nearest_levels_below: below.map((v) => ({ price: v, distance_pips: pips(price - v) })),
  };
}

/** Recent move sizes, so the model can see how much of a move is already consumed. */
export function recentMoves(m1: Bar[], now: number, price: number): Row {
  const past = m1.filter((b) => b.t + 60_000 <= now);
  const at = (min: number) => { const t = now - min * 60_000; let best: Bar | undefined; for (const b of past) { if (b.t <= t) best = b; else break; } return best?.c ?? null; };
  const out: Row = {};
  for (const m of [5, 15, 30, 60, 240]) { const p = at(m); out["change_" + m + "m_pips"] = p === null ? null : pips(price - p); }
  return out;
}

export interface EvidencePack {
  version: string; now: string; live: (Quote & { age_seconds: number; spread_pips: number; buy_executes_at: number; sell_executes_at: number }) | null;
  data_quality: { m1_bars_last_150m: number; last_bar_age_minutes: number | null; gaps: string[] };
  structure: Partial<Record<Timeframe, FrameSummary | null>>;
  candles: Partial<Record<Timeframe, Array<[string, number, number, number, number]>>>;
  levels: Row; moves: Row;
}
/** The pre-loaded market picture. Pure: replay passes archive bars, live passes bot price memory. */
export function buildEvidencePack(m1: Bar[], now: number, quote: Quote | null): EvidencePack {
  const sorted = [...m1].sort((a, b) => a.t - b.t);
  const past = sorted.filter((b) => b.t + 60_000 <= now);
  const last = past[past.length - 1];
  const gaps: string[] = [];
  const qAge = quote ? (now - Date.parse(quote.at)) / 1000 : null;
  const live = usableCurrentQuote(quote, now) && qAge !== null
    ? { ...quote, age_seconds: Math.max(0, Math.round(qAge)), spread_pips: r2((quote.ask - quote.bid) / PIP), buy_executes_at: quote.ask, sell_executes_at: quote.bid } : null;
  if (!live) gaps.push("no fresh executable broker bid/ask");
  const lastAge = last ? (now - (last.t + 60_000)) / 60_000 : null;
  if (lastAge === null || lastAge > 3) gaps.push("minute candles are stale or missing");
  const recent = past.filter((b) => b.t >= now - 150 * 60_000).length;
  if (recent < 90) gaps.push("fewer than 90 of the last 150 minute candles");
  const structure: EvidencePack["structure"] = {}, candles: EvidencePack["candles"] = {};
  for (const tf of Object.keys(TIMEFRAMES) as Timeframe[]) {
    const bars = framesAt(sorted, tf, now);
    structure[tf] = summarizeFrame(bars);
    if (!structure[tf]) gaps.push(tf + " structure unavailable (" + bars.length + " completed bars)");
    const n = PRELOAD_CANDLES[tf];
    if (n) candles[tf] = compactCandles(bars, n);
  }
  const price = live ? (live.bid + live.ask) / 2 : last?.c ?? 0;
  return { version: TRADER_BRAIN_VERSION, now: new Date(now).toISOString(), live,
    data_quality: { m1_bars_last_150m: recent, last_bar_age_minutes: lastAge === null ? null : r2(lastAge), gaps },
    structure, candles, levels: price ? keyLevels(sorted, now, price) : {}, moves: price ? recentMoves(sorted, now, price) : {} };
}

