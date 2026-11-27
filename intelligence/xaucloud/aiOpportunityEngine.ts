// Ported from XauCloud 9e5f137753a9687670ed2105311f72b30891e29e / aiOpportunityEngine.ts, source blob 7c2bddc6a4c3327bd72f39ca830da9d694939d98.
// Provider-free subset; see provenance.json for extraction boundaries.
/**
 * XauCloud AI two-sided opportunity engine.
 *
 * For every assessment it builds BUY and SELL candidates INDEPENDENTLY from
 * several strategies, scores each on documented evidence, checks that the
 * entry and first target are realistic within the requested horizon, and
 * only then compares the two sides. The dominant trend is one input, not
 * the answer: a stretched bullish market can produce a valid SELL
 * correction, and a bearish one a valid BUY bounce.
 *
 * Inputs are XauCloud's own price memory (minute bars from the bot's broker
 * quotes / EA bars) and a fresh broker bid/ask. "Pressure" is INFERRED from
 * candle closes and bodies; there is no volume or order-flow feed.
 * Deterministic and read-only: no orders, no EA changes, no model calls.
 *
 * Evidence score: the sum of the weights in WEIGHTS for evidence present.
 * It is a ranking of how much supporting evidence exists, NOT a
 * probability. Hit rates are reported separately from measured outcomes.
 */
export type Side = "BUY" | "SELL";
export type Strategy =
  | "TREND_CONTINUATION" | "COUNTERTREND_CORRECTION" | "EXHAUSTION_REVERSAL" | "FAILED_BREAKOUT"
  | "BREAKOUT_RETEST" | "SR_REJECTION" | "MOMENTUM";
export type Conclusion =
  | "BUY_NOW" | "SELL_NOW" | "BUY_AFTER_CONFIRMATION" | "SELL_AFTER_CONFIRMATION"
  | "SHORT_TERM_SELL_THEN_BUY" | "SHORT_TERM_BUY_THEN_SELL" | "NO_TRADE";
export interface Bar { t: number; o: number; h: number; l: number; c: number }

const r2 = (n: number) => Math.round(n * 100) / 100;
const PIPS = 10;

// ------------------------------------------------------------ bars
/** Completed bars of `minutes` from minute bars (needs `minFill` minutes). */
export function aggregate(m1: Bar[], minutes: number, now: number, minFill = Math.max(1, Math.ceil(minutes * 0.6))): Bar[] {
  const size = minutes * 60_000;
  const g = new Map<number, Bar & { n: number }>();
  for (const b of [...m1].sort((a, b) => a.t - b.t)) {
    const k = Math.floor(b.t / size) * size;
    if (k + size > now) continue; // only completed buckets: no look-ahead
    const x = g.get(k);
    if (!x) g.set(k, { t: k, o: b.o, h: b.h, l: b.l, c: b.c, n: 1 });
    else { x.h = Math.max(x.h, b.h); x.l = Math.min(x.l, b.l); x.c = b.c; x.n++; }
  }
  return [...g.values()].filter((b) => b.n >= minFill).map(({ n: _n, ...b }) => b);
}

// -------------------------------------------------------- features
export interface Frame {
  bars: number; atr: number; close: number; emaFast: number; emaSlow: number;
  trend: "UP" | "DOWN" | "RANGE";
  momentum: number;      // 3-bar change in ATR units
  acceleration: number;  // momentum now minus momentum 3 bars ago
  pressure: number;      // -1..1, inferred from where candles close and body direction
  rsi: number; extension: number; // close vs slow EMA in ATR
  swingHighs: number[]; swingLows: number[];
  lastSwingHigh: number | null; lastSwingLow: number | null;
  bearishDivergence: boolean; bullishDivergence: boolean;
  upperRejection: boolean; lowerRejection: boolean;
  sweptHigh: boolean; sweptLow: boolean;   // traded beyond the last swing, closed back inside
  brokeUp: boolean; brokeDown: boolean;    // last close beyond the last swing
  structureShiftDown: boolean; structureShiftUp: boolean; // close beyond the opposite swing
  last: Bar;
}
function ema(xs: number[], p: number): number[] {
  const k = 2 / (p + 1); const out: number[] = [];
  xs.forEach((v, i) => out.push(i === 0 ? v : v * k + out[i - 1]! * (1 - k)));
  return out;
}
function rsiSeries(xs: number[], p = 14): number[] {
  const out: number[] = new Array(xs.length).fill(50);
  let gain = 0, loss = 0;
  for (let i = 1; i < xs.length; i++) {
    const d = xs[i]! - xs[i - 1]!;
    const g = Math.max(0, d), l = Math.max(0, -d);
    if (i <= p) { gain += g / p; loss += l / p; } else { gain = (gain * (p - 1) + g) / p; loss = (loss * (p - 1) + l) / p; }
    out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  return out;
}

export function analyzeFrame(input: Bar[], fast = 9, slow = 21): Frame | null {
  if (input.length < 30) return null;
  const bars = input.slice(-120);
  const c = bars.map((b) => b.c);
  const tr = bars.slice(1).map((b, i) => Math.max(b.h - b.l, Math.abs(b.h - bars[i]!.c), Math.abs(b.l - bars[i]!.c)));
  const atr = tr.slice(-14).reduce((a, b) => a + b, 0) / 14;
  if (!(atr > 0)) return null;
  const ef = ema(c, fast), es = ema(c, slow), rsi = rsiSeries(c);
  const n = bars.length, last = bars[n - 1]!;
  const hi: Array<{ i: number; v: number }> = [], lo: Array<{ i: number; v: number }> = [];
  for (let i = 2; i < n - 2; i++) {
    const b = bars[i]!, nb = [bars[i - 2]!, bars[i - 1]!, bars[i + 1]!, bars[i + 2]!];
    if (nb.every((x) => x.h < b.h)) hi.push({ i, v: b.h });
    if (nb.every((x) => x.l > b.l)) lo.push({ i, v: b.l });
  }
  const lh = hi[hi.length - 1], ph = hi[hi.length - 2], ll = lo[lo.length - 1], pl = lo[lo.length - 2];
  const up = es[n - 1]! < ef[n - 1]! && (!lh || !ph || lh.v >= ph.v) && (!ll || !pl || ll.v >= pl.v);
  const down = es[n - 1]! > ef[n - 1]! && (!lh || !ph || lh.v <= ph.v) && (!ll || !pl || ll.v <= pl.v);
  const mom = (i: number) => (c[i]! - c[i - 3]!) / atr;
  const momentum = mom(n - 1), acceleration = momentum - mom(n - 4);
  const recent = bars.slice(-6);
  const pressure = recent.reduce((s, b) => {
    const range = b.h - b.l; if (range <= 0) return s;
    const clv = ((b.c - b.l) - (b.h - b.c)) / range; // -1 close at low .. +1 close at high
    const body = (b.c - b.o) / range;
    return s + (clv + body) / 2;
  }, 0) / recent.length;
  const body = Math.abs(last.c - last.o);
  const upperWick = last.h - Math.max(last.o, last.c), lowerWick = Math.min(last.o, last.c) - last.l;
  const window = bars.slice(-3);
  const sweptHigh = Boolean(lh && lh.i < n - 3 && window.some((b) => b.h > lh.v) && last.c < lh.v);
  const sweptLow = Boolean(ll && ll.i < n - 3 && window.some((b) => b.l < ll.v) && last.c > ll.v);
  return {
    bars: n, atr: r2(atr), close: last.c, emaFast: r2(ef[n - 1]!), emaSlow: r2(es[n - 1]!),
    trend: up ? "UP" : down ? "DOWN" : "RANGE", momentum: r2(momentum), acceleration: r2(acceleration),
    pressure: r2(pressure), rsi: r2(rsi[n - 1]!), extension: r2((last.c - es[n - 1]!) / atr),
    swingHighs: hi.slice(-4).map((x) => r2(x.v)), swingLows: lo.slice(-4).map((x) => r2(x.v)),
    lastSwingHigh: lh ? r2(lh.v) : null, lastSwingLow: ll ? r2(ll.v) : null,
    bearishDivergence: Boolean(lh && ph && lh.v > ph.v && rsi[lh.i]! < rsi[ph.i]! - 2),
    bullishDivergence: Boolean(ll && pl && ll.v < pl.v && rsi[ll.i]! > rsi[pl.i]! + 2),
    upperRejection: upperWick >= Math.max(2 * body, 0.5 * atr), lowerRejection: lowerWick >= Math.max(2 * body, 0.5 * atr),
    sweptHigh, sweptLow,
    brokeUp: Boolean(lh && last.c > lh.v), brokeDown: Boolean(ll && last.c < ll.v),
    structureShiftDown: Boolean(ll && last.c < ll.v && (up || es[n - 1]! < ef[n - 1]!)),
    structureShiftUp: Boolean(lh && last.c > lh.v && (down || es[n - 1]! > ef[n - 1]!)),
    last,
  };
}

// ------------------------------------------------------- candidates
export const WEIGHTS = {
  higher_trend_agrees: 2, execution_trend_agrees: 1, momentum_agrees: 1, momentum_accelerating: 1,
  pressure_agrees: 1, exhaustion_against_prior_move: 2, rejection_candle: 1, divergence: 1,
  failed_breakout: 2, structure_shift: 2, at_level: 1, breakout: 1,
} as const;
type Ev = keyof typeof WEIGHTS;

export interface Candidate {
  side: Side; strategy: Strategy; entry_type: "NOW" | "ON_CONFIRMATION" | "AT_ZONE";
  entry: { low: number; high: number }; trigger: string | null;
  stop: number; targets: { tp1: number; tp2: number; tp3: number };
  reward_risk_tp1: number; risk_pips: number; horizon_minutes: number;
  reachable_within_horizon: boolean; evidence: string[]; evidence_keys: Ev[]; score: number;
  invalidation: string; why: string;
}
export interface Market {
  now: number; bid: number; ask: number;
  m1: Frame | null; m5: Frame | null; m15: Frame | null; h1: Frame | null;
  m10?: Frame | null; m30?: Frame | null;
}
const label: Record<Ev, string> = {
  higher_trend_agrees: "the higher timeframe agrees", execution_trend_agrees: "the 5-minute trend agrees",
  momentum_agrees: "momentum points this way", momentum_accelerating: "momentum is accelerating",
  pressure_agrees: "candles show pressure this way", exhaustion_against_prior_move: "the prior move looks exhausted",
  rejection_candle: "a rejection candle formed", divergence: "RSI divergence against the prior move",
  failed_breakout: "a failed breakout / liquidity sweep", structure_shift: "short-term structure has shifted",
  at_level: "price is at a key level", breakout: "price broke a swing level",
};

/** Expected typical move over `minutes`, from 5-minute ATR (random-walk scaling). */
export function expectedMove(m5Atr: number, minutes: number): number {
  return m5Atr * Math.sqrt(Math.max(1, minutes) / 5);
}

function buildCandidate(mk: Market, side: Side, strategy: Strategy, keys: Ev[], entryType: Candidate["entry_type"],
  zone: { low: number; high: number } | null, trigger: string | null, horizon: number, why: string): Candidate | null {
  const f = mk.m5!, k = side === "BUY" ? 1 : -1, spread = mk.ask - mk.bid;
  const px = side === "BUY" ? mk.ask : mk.bid;
  const entry = zone ?? { low: r2(px), high: r2(px) };
  const ref = side === "BUY" ? entry.high : entry.low; // worst fill inside the zone
  // Stop beyond the nearest opposing swing, at least 0.6 ATR, plus spread.
  const swing = side === "BUY" ? Math.min(...[f.lastSwingLow ?? ref - f.atr, f.last.l]) : Math.max(...[f.lastSwingHigh ?? ref + f.atr, f.last.h]);
  let stop = swing - k * (0.25 * f.atr + spread);
  if (k * (ref - stop) < 0.6 * f.atr) stop = ref - k * 0.6 * f.atr;
  const risk = Math.abs(ref - stop);
  if (risk > 4 * f.atr || risk <= 0) return null;
  // Targets: nearest opposing structure (M5/M15/H1 swings) beyond 1R, else R multiples.
  const levels = [...(f.swingHighs ?? []), ...(f.swingLows ?? []), ...(mk.m15?.swingHighs ?? []), ...(mk.m15?.swingLows ?? []), ...(mk.h1?.swingHighs ?? []), ...(mk.h1?.swingLows ?? [])]
    .filter((v) => k * (v - ref) >= risk + spread).sort((a, b) => k * (a - b));
  const move = expectedMove(f.atr, horizon);
  // Nearest structure level if it is both close enough in R and reachable
  // within the horizon; otherwise a plain 1R (+spread) first target.
  const structural = levels[0];
  const tp1 = structural !== undefined && k * (structural - ref) <= 2.5 * risk && Math.abs(structural - ref) <= 1.5 * move ? structural : ref + k * (risk + spread);
  const tp2 = Math.max(k * (tp1 - ref), 2 * risk) * k + ref;
  const tp3 = Math.max(k * (tp2 - ref), 3 * risk) * k + ref;
  const rr = (Math.abs(tp1 - ref) - spread) / risk;
  if (rr < 1) return null;
  const distanceToEntry = entryType === "NOW" ? 0 : Math.abs(px - ref);
  const reachable = distanceToEntry <= move && Math.abs(tp1 - ref) <= 1.5 * move;
  const score = keys.reduce((s, x) => s + WEIGHTS[x], 0);
  return {
    side, strategy, entry_type: entryType, entry: { low: r2(Math.min(entry.low, entry.high)), high: r2(Math.max(entry.low, entry.high)) },
    trigger, stop: r2(stop), targets: { tp1: r2(tp1), tp2: r2(tp2), tp3: r2(tp3) }, reward_risk_tp1: r2(rr),
    risk_pips: r2(risk * PIPS), horizon_minutes: horizon, reachable_within_horizon: reachable,
    evidence: keys.map((x) => label[x]), evidence_keys: keys, score,
    invalidation: (side === "BUY" ? "a 5-minute close below " : "a 5-minute close above ") + r2(stop).toFixed(2),
    why,
  };
}

/** All strategies for one side. Every strategy is evaluated for BOTH sides. */
export function sideCandidates(mk: Market, side: Side, horizon: number): Candidate[] {
  const f = mk.m5, hi = mk.h1 ?? mk.m30 ?? mk.m15;
  if (!f) return [];
  const k = side === "BUY" ? 1 : -1;
  const want = side === "BUY" ? "UP" : "DOWN", against = side === "BUY" ? "DOWN" : "UP";
  const momOk = k * f.momentum > 0.3, accel = k * f.acceleration > 0.2, press = k * f.pressure > 0.15;
  const exhaustedAgainst = (k * f.extension < -2 || (side === "SELL" ? f.rsi > 70 : f.rsi < 30)) && k * f.acceleration > 0;
  const rejection = side === "SELL" ? f.upperRejection : f.lowerRejection;
  const divergence = side === "SELL" ? f.bearishDivergence : f.bullishDivergence;
  const swept = side === "SELL" ? f.sweptHigh : f.sweptLow;
  const shift = side === "SELL" ? f.structureShiftDown : f.structureShiftUp;
  const broke = side === "BUY" ? f.brokeUp : f.brokeDown;
  const level = side === "SELL" ? f.lastSwingHigh : f.lastSwingLow;
  const atLevel = level !== null && Math.abs(f.close - level) <= 0.35 * f.atr;
  const out: Candidate[] = [];
  const add = (c: Candidate | null) => { if (c) out.push(c); };
  const higherAgrees = hi?.trend === want, higherAgainst = hi?.trend === against;
  const keysWith = (base: Ev[]) => [...(higherAgrees ? ["higher_trend_agrees" as Ev] : []), ...base];

  // Trend continuation: trend on both frames; NOW when momentum confirms, else at the fast-EMA pullback.
  if (higherAgrees && f.trend === want && !(side === "BUY" ? f.rsi > 75 : f.rsi < 25)) {
    const keys = keysWith(["execution_trend_agrees", ...(momOk ? ["momentum_agrees" as Ev] : []), ...(press ? ["pressure_agrees" as Ev] : []), ...(accel ? ["momentum_accelerating" as Ev] : [])]);
    if (momOk && press) add(buildCandidate(mk, side, "TREND_CONTINUATION", keys, "NOW", null, null, horizon, "Trend and momentum line up; joining the move now."));
    else add(buildCandidate(mk, side, "TREND_CONTINUATION", keys, "AT_ZONE",
      { low: f.emaFast - 0.2 * f.atr, high: f.emaFast + 0.2 * f.atr }, null, horizon, "Trend intact; a pullback to the 5-minute EMA is the better price."));
  }
  // Countertrend correction / exhaustion reversal: against the higher trend once the move is stretched and turning.
  const turnKeys: Ev[] = [...(exhaustedAgainst ? ["exhaustion_against_prior_move" as Ev] : []), ...(rejection ? ["rejection_candle" as Ev] : []),
    ...(divergence ? ["divergence" as Ev] : []), ...(shift ? ["structure_shift" as Ev] : []), ...(press ? ["pressure_agrees" as Ev] : []), ...(accel ? ["momentum_accelerating" as Ev] : [])];
  const turning = turnKeys.filter((x) => x !== "pressure_agrees" && x !== "momentum_accelerating").length;
  if (turning >= 2 && (press || accel)) {
    add(buildCandidate(mk, side, higherAgainst ? "COUNTERTREND_CORRECTION" : "EXHAUSTION_REVERSAL", turnKeys, "NOW", null, null, horizon,
      higherAgainst ? "The bigger trend is the other way, but the short-term move is stretched and turning: a correction trade." : "The move is stretched and turning; trading the reversal."));
  } else if (turning >= 1 && (exhaustedAgainst || divergence || rejection)) {
    const trig = side === "SELL" ? f.lastSwingLow : f.lastSwingHigh;
    if (trig !== null) add(buildCandidate(mk, side, higherAgainst ? "COUNTERTREND_CORRECTION" : "EXHAUSTION_REVERSAL", turnKeys, "ON_CONFIRMATION",
      { low: trig - 0.1 * f.atr, high: trig + 0.1 * f.atr }, "a 5-minute close " + (side === "SELL" ? "below " : "above ") + trig.toFixed(2), horizon,
      "Signs of exhaustion, but the turn needs a structure break to confirm."));
  }
  // Failed breakout / liquidity sweep.
  if (swept) add(buildCandidate(mk, side, "FAILED_BREAKOUT", ["failed_breakout", ...(rejection ? ["rejection_candle" as Ev] : []), ...(press ? ["pressure_agrees" as Ev] : [])], "NOW", null, null, horizon,
    "Price ran the last swing and closed back inside: the breakout failed."));
  // Support/resistance rejection.
  if (atLevel && rejection) add(buildCandidate(mk, side, "SR_REJECTION", ["at_level", "rejection_candle", ...(press ? ["pressure_agrees" as Ev] : [])], "NOW", null, null, horizon,
    "Price is reacting at a key level with a rejection candle."));
  // Breakout and retest of the broken level.
  if (broke && level !== null) {
    const brokenLevel = side === "BUY" ? f.lastSwingHigh : f.lastSwingLow;
    if (brokenLevel !== null) add(buildCandidate(mk, side, "BREAKOUT_RETEST", keysWith(["breakout", ...(momOk ? ["momentum_agrees" as Ev] : [])]), "AT_ZONE",
      { low: brokenLevel - 0.15 * f.atr, high: brokenLevel + 0.15 * f.atr }, null, horizon, "Price broke a swing level; a retest of it is the entry."));
  }
  // Short-term momentum (scalp), only when not already stretched in that direction.
  if (momOk && accel && press && k * f.extension < 2.5 && !(higherAgainst && !shift)) {
    add(buildCandidate(mk, side, "MOMENTUM", ["momentum_agrees", "momentum_accelerating", "pressure_agrees", ...(f.trend === want ? ["execution_trend_agrees" as Ev] : [])], "NOW", null, null, horizon,
      "Short-term momentum and candle pressure are accelerating this way."));
  }
  return out;
}

export interface OpportunityAssessment {
  as_of: string; horizon_minutes: number;
  conclusion: Conclusion; headline: string;
  primary: Candidate | null; follow_up: Candidate | null; rejected_alternative: Candidate | null;
  buy: Candidate[]; sell: Candidate[];
  context: { dominant_trend: string; short_term_trend: string; momentum: number | null; pressure: number | null; rsi: number | null;
    extension_atr: number | null; atr_m5: number | null; expected_move: number | null; bid: number | null; ask: number | null; spread: number | null };
  no_trade_reasons: string[];
  /** The market view, ALWAYS given unless prices are missing/stale: direction, move, best entry, score. */
  forecast: Forecast;
  data: { m1: number; m5: number; m15: number; h1: number; m10?: number; m30?: number };
  market_tools?: MarketTools;
}
export interface MarketTools {
  price_source: "SAME_APPROVED_BROKER" | "UNAVAILABLE";
  quote_at: string | null;
  last_closed_minute_at: string | null;
  candle_pressure_kind: "OHLC_PROXY_NOT_ORDER_FLOW";
  frames: Record<string, { trend: Frame["trend"]; momentum: number; acceleration: number; pressure: number; atr: number; rsi: number; support: number | null; resistance: number | null; sweep_high: boolean; sweep_low: boolean; breakout_up: boolean; breakout_down: boolean } | null>;
  economic_calendar: { status: "AVAILABLE" | "UNAVAILABLE"; as_of: string | null; events: { title: string; date: string; impact: string; forecast: string; previous: string; actual: string }[] };
  unavailable: string[];
}
export type EntryKind = "BUY NOW" | "SELL NOW" | "BUY ON PULLBACK" | "SELL ON PULLBACK" | "BUY ON BREAKOUT" | "SELL ON BREAKDOWN" | "RANGE";
export interface Forecast {
  status: "DIRECTIONAL" | "RANGE" | "INSUFFICIENT_RELIABLE_DATA";
  direction: Side | null;
  /** Evidence score 0-100 from the engine's own weighted evidence; NOT a calibrated probability. */
  ai_score: number | null; score_kind: "AI_EVIDENCE_SCORE";
  expected_move_pips: number | null; horizon_minutes: number;
  entry_kind: EntryKind | null; entry: { low: number; high: number } | null; executable_now: boolean;
  stop: number | null; tp1: number | null; tp2: number | null; invalidation: string | null;
  range: { support: number; resistance: number } | null;
  why: string; missing: string[];
}
const kindOf = (c: Candidate): EntryKind => c.entry_type === "NOW" ? (c.side + " NOW") as EntryKind
  : c.entry_type === "AT_ZONE" ? (c.side + " ON PULLBACK") as EntryKind : c.side === "BUY" ? "BUY ON BREAKOUT" : "SELL ON BREAKDOWN";
/**
 * Directional forecast that survives "no executable trade": the leading side
 * from the same scored candidates, its best entry (now / pullback / breakout),
 * and an evidence score. Range only when neither side leads and trend is flat.
 */
export function buildForecast(mk: Market, buy: Candidate[], sell: Candidate[], horizon: number, primary: Candidate | null, missing: string[] = []): Forecast {
  const blank = { score_kind: "AI_EVIDENCE_SCORE" as const, horizon_minutes: horizon };
  if (missing.length || !mk.m5) return { ...blank, status: "INSUFFICIENT_RELIABLE_DATA", direction: null, ai_score: null, expected_move_pips: null, entry_kind: null, entry: null,
    executable_now: false, stop: null, tp1: null, tp2: null, invalidation: null, range: null, why: "No reliable live price/candles: " + (missing[0] ?? "missing 5-minute candles"), missing: missing.length ? missing : ["5-minute candles"] };
  const move = Math.round(expectedMove(mk.m5.atr, horizon) * PIPS);
  const bb = buy[0] ?? null, bs = sell[0] ?? null;
  const gap = (bb?.score ?? 0) - (bs?.score ?? 0);
  const trendDir = (f: Frame | null | undefined) => f?.trend === "UP" ? 1 : f?.trend === "DOWN" ? -1 : 0;
  const tilt = Math.sign(gap) || trendDir(mk.m5) || Math.sign(mk.m5.momentum) || 0;
  const best = primary ?? (tilt > 0 ? bb : tilt < 0 ? bs : null);
  const f15 = mk.m15 ?? mk.m5;
  if (!best) {
    const sup = f15.lastSwingLow, res = f15.lastSwingHigh;
    return { ...blank, status: "RANGE", direction: null, ai_score: null, expected_move_pips: move, entry_kind: "RANGE", entry: null, executable_now: false,
      stop: null, tp1: null, tp2: null, invalidation: null, range: sup !== null && res !== null ? { support: r2(sup), resistance: r2(res) } : null,
      why: "Neither side leads; trade the range edges" + (sup !== null && res !== null ? " (" + r2(sup) + " – " + r2(res) + ")" : ""), missing: [] };
  }
  const other = best.side === "BUY" ? bs : bb;
  const edge = Math.max(0, best.score - (other?.score ?? 0));
  let score = 50 + 4 * Math.min(edge, 6) + 2.5 * Math.min(best.score, 8);
  if (best.evidence_keys.includes("higher_trend_agrees" as Ev)) score += 4;
  if (!best.reachable_within_horizon) score -= 8;
  if (trendDir(mk.m5) === (best.side === "BUY" ? -1 : 1)) score -= 6;
  // Only a setup the engine itself approved (primary) is an immediate entry. A weaker
  // "now" lean becomes a pullback entry at a better price, never a manufactured market order.
  const approvedNow = primary !== null && best === primary && best.entry_type === "NOW" && best.reachable_within_horizon;
  const pull = best.entry_type === "NOW" && !approvedNow;
  const k = best.side === "BUY" ? -1 : 1, d = 0.3 * mk.m5.atr;
  const entry = pull ? { low: r2(Math.min(best.entry.low, best.entry.low + k * d)), high: r2(Math.max(best.entry.high, best.entry.high + k * d)) } : { low: r2(best.entry.low), high: r2(best.entry.high) };
  if (pull) { if (best.side === "BUY") entry.high = r2(best.entry.low); else entry.low = r2(best.entry.high); }
  return { ...blank, status: "DIRECTIONAL", direction: best.side, ai_score: Math.round(Math.max(5, Math.min(98, score))), expected_move_pips: move,
    entry_kind: pull ? (best.side + " ON PULLBACK") as EntryKind : kindOf(best), entry, executable_now: approvedNow,
    stop: r2(best.stop), tp1: r2(best.targets.tp1), tp2: r2(best.targets.tp2), invalidation: best.invalidation,
    range: null, why: best.why, missing: [] };
}
export function frameTool(f: Frame | null | undefined): MarketTools["frames"][string] {
  return f ? { trend:f.trend, momentum:f.momentum, acceleration:f.acceleration, pressure:f.pressure, atr:f.atr, rsi:f.rsi,
    support:f.lastSwingLow,resistance:f.lastSwingHigh,sweep_high:f.sweptHigh,sweep_low:f.sweptLow,breakout_up:f.brokeUp,breakout_down:f.brokeDown } : null;
}
/**
 * Decision thresholds. These defaults are only the starting point: the
 * production service passes thresholds re-learned from XauCloud's own price
 * memory (aiThresholdCalibration.ts: chronological train/held-out, realistic
 * spread + slippage) whenever the learned values beat the defaults out of sample.
 */
export interface EngineThresholds { now_min_score: number; confirm_min_score: number; conflict_gap: number; source: "DEFAULT" | "CALIBRATED"; calibrated_at?: string | null;
  /** Strategies never selected as the executable call (still listed as candidates/evidence). */
  excluded_strategies?: string[] }
/**
 * Measured on 5 years of XAUUSD minute history (Nov 2021 - Oct 2026, 43,409 filled
 * candidates, spread + slippage, chronological train / validation / holdout):
 * mean R per strategy. Two strategies lose about 0.42 R per trade in EVERY block,
 * so they are never the engine's executable call. Re-measure with
 * scripts/research/strategy-lab.ts.
 */
export const STRATEGY_EVIDENCE: Record<string, { train: number; validation: number; holdout: number; trades_train: number }> = {
  MOMENTUM: { train: -0.125, validation: -0.072, holdout: -0.048, trades_train: 3601 },
  BREAKOUT_RETEST: { train: -0.146, validation: -0.092, holdout: -0.071, trades_train: 6035 },
  SR_REJECTION: { train: -0.282, validation: -0.197, holdout: -0.064, trades_train: 420 },
  FAILED_BREAKOUT: { train: -0.261, validation: -0.199, holdout: -0.096, trades_train: 4944 },
  TREND_CONTINUATION: { train: -0.276, validation: -0.188, holdout: -0.149, trades_train: 2174 },
  EXHAUSTION_REVERSAL: { train: -0.431, validation: -0.434, holdout: -0.417, trades_train: 4203 },
  COUNTERTREND_CORRECTION: { train: -0.412, validation: -0.456, holdout: -0.419, trades_train: 1042 },
};
export const PROVEN_LOSING_STRATEGIES = ["EXHAUSTION_REVERSAL", "COUNTERTREND_CORRECTION"];
export const DEFAULT_THRESHOLDS: EngineThresholds = { now_min_score: 5, confirm_min_score: 3, conflict_gap: 2, source: "DEFAULT", excluded_strategies: PROVEN_LOSING_STRATEGIES };

/** Minimal candidate view the selection rule needs (lets research replay every threshold set cheaply). */
export interface SelectableCandidate { side: Side; entry_type: Candidate["entry_type"]; score: number; reachable_within_horizon: boolean; strategy?: string }
/**
 * The engine's exact primary-selection rule (same as assessOpportunity):
 * conflicting NOW setups closer than the gap → none; otherwise the stronger
 * NOW; else the stronger confirmation/zone setup; else none.
 * `buy`/`sell` must be sorted by score, highest first.
 */
export function selectPrimary<C extends SelectableCandidate>(buy: C[], sell: C[], t: Pick<EngineThresholds, "now_min_score" | "confirm_min_score" | "conflict_gap" | "excluded_strategies">): C | null {
  const ex = new Set(t.excluded_strategies ?? []);
  if (ex.size) { buy = buy.filter((c) => !ex.has(String(c.strategy))); sell = sell.filter((c) => !ex.has(String(c.strategy))); }
  const nowB = buy.find((c) => c.entry_type === "NOW" && c.reachable_within_horizon && c.score >= t.now_min_score);
  const nowS = sell.find((c) => c.entry_type === "NOW" && c.reachable_within_horizon && c.score >= t.now_min_score);
  const laterB = buy.find((c) => c.entry_type !== "NOW" && c.reachable_within_horizon && c.score >= t.confirm_min_score);
  const laterS = sell.find((c) => c.entry_type !== "NOW" && c.reachable_within_horizon && c.score >= t.confirm_min_score);
  if (nowB && nowS) return Math.abs(nowB.score - nowS.score) < t.conflict_gap ? null : nowB.score > nowS.score ? nowB : nowS;
  if (nowS) return nowS;
  if (nowB) return nowB;
  if (laterB && laterS) return laterB.score >= laterS.score ? laterB : laterS;
  return laterB ?? laterS ?? null;
}
/** Compare both sides and return one coherent recommendation. */
export function assessOpportunity(mk: Market, horizon: number, guards: string[] = [], thresholds: EngineThresholds = DEFAULT_THRESHOLDS): OpportunityAssessment {
  const NOW_MIN_SCORE = thresholds.now_min_score, CONFIRM_MIN_SCORE = thresholds.confirm_min_score, CONFLICT_GAP = thresholds.conflict_gap;
  const base = {
    as_of: new Date(mk.now).toISOString(), horizon_minutes: horizon,
    context: { dominant_trend: (mk.h1 ?? mk.m30 ?? mk.m15)?.trend ?? "UNKNOWN", short_term_trend: mk.m5?.trend ?? "UNKNOWN",
      momentum: mk.m5?.momentum ?? null, pressure: mk.m5?.pressure ?? null, rsi: mk.m5?.rsi ?? null, extension_atr: mk.m5?.extension ?? null,
      atr_m5: mk.m5?.atr ?? null, expected_move: mk.m5 ? r2(expectedMove(mk.m5.atr, horizon)) : null,
      bid: guards.length ? null : mk.bid, ask: guards.length ? null : mk.ask, spread: guards.length ? null : r2(mk.ask - mk.bid) },
    data: { m1: mk.m1?.bars ?? 0, m5: mk.m5?.bars ?? 0, m10: mk.m10?.bars ?? 0, m15: mk.m15?.bars ?? 0, m30: mk.m30?.bars ?? 0, h1: mk.h1?.bars ?? 0 },
  };
  // Strategies with a measured multi-year loss are listed as candidates (evidence) but never become the call or the forecast's levels.
  const ex = new Set(thresholds.excluded_strategies ?? []);
  const usable = (xs: Candidate[]) => (ex.size ? xs.filter((c) => !ex.has(c.strategy)) : xs);
  const none = (reasons: string[], buy: Candidate[] = [], sell: Candidate[] = [], dataMissing = false): OpportunityAssessment => ({
    ...base, conclusion: "NO_TRADE", headline: "No trade now: " + reasons[0], primary: null, follow_up: null, rejected_alternative: null, buy, sell, no_trade_reasons: reasons,
    forecast: buildForecast(mk, usable(buy), usable(sell), horizon, null, dataMissing ? reasons : []),
  });
  if (guards.length) return none(guards, [], [], true);
  if (!mk.m5) return none(["not enough recent 5-minute candles in XauCloud's price memory"], [], [], true);
  const valid = (c: Candidate) => c.reachable_within_horizon && !ex.has(c.strategy);
  const buy = sideCandidates(mk, "BUY", horizon).sort((a, b) => b.score - a.score);
  const sell = sideCandidates(mk, "SELL", horizon).sort((a, b) => b.score - a.score);
  const nowB = buy.find((c) => c.entry_type === "NOW" && valid(c) && c.score >= NOW_MIN_SCORE);
  const nowS = sell.find((c) => c.entry_type === "NOW" && valid(c) && c.score >= NOW_MIN_SCORE);
  const laterB = buy.find((c) => c.entry_type !== "NOW" && valid(c) && c.score >= CONFIRM_MIN_SCORE);
  const laterS = sell.find((c) => c.entry_type !== "NOW" && valid(c) && c.score >= CONFIRM_MIN_SCORE);
  const pick = (conclusion: Conclusion, primary: Candidate, follow: Candidate | null, rejected: Candidate | null, headline: string): OpportunityAssessment =>
    ({ ...base, conclusion, headline, primary, follow_up: follow, rejected_alternative: rejected, buy, sell, no_trade_reasons: [], forecast: buildForecast(mk, usable(buy), usable(sell), horizon, primary) });
  if (nowB && nowS) {
    if (Math.abs(nowB.score - nowS.score) < CONFLICT_GAP) return none(["buyers and sellers both have a case right now (" + nowB.strategy.toLowerCase().replace(/_/g, " ") + " vs " + nowS.strategy.toLowerCase().replace(/_/g, " ") + "); wait for one side to break"], buy, sell);
    const [w, l] = nowB.score > nowS.score ? [nowB, nowS] : [nowS, nowB];
    return pick(w.side === "BUY" ? "BUY_NOW" : "SELL_NOW", w, null, l, w.side + " now: " + w.why);
  }
  const otherLater = (side: Side) => (side === "BUY" ? laterS : laterB);
  for (const now of [nowS, nowB]) {
    if (!now) continue;
    const later = otherLater(now.side);
    if (later && later.entry_type === "AT_ZONE" && now.targets.tp1 !== undefined &&
        (now.side === "SELL" ? later.entry.high >= now.targets.tp2 : later.entry.low <= now.targets.tp2)) {
      return pick(now.side === "SELL" ? "SHORT_TERM_SELL_THEN_BUY" : "SHORT_TERM_BUY_THEN_SELL", now, later, null,
        "Short-term " + now.side + " now; I'd look for a " + later.side + " around " + later.entry.low.toFixed(2) + "–" + later.entry.high.toFixed(2) + " after that.");
    }
    return pick(now.side === "BUY" ? "BUY_NOW" : "SELL_NOW", now, later ?? null, (now.side === "BUY" ? sell : buy)[0] ?? null, now.side + " now: " + now.why);
  }
  if (laterB || laterS) {
    const [w, l] = laterB && laterS ? (laterB.score >= laterS.score ? [laterB, laterS] : [laterS, laterB]) : [laterB ?? laterS!, null];
    return pick(w.side === "BUY" ? "BUY_AFTER_CONFIRMATION" : "SELL_AFTER_CONFIRMATION", w, null, l,
      w.side + " only after " + (w.trigger ?? "price reaches " + w.entry.low.toFixed(2) + "–" + w.entry.high.toFixed(2)) + ": " + w.why);
  }
  const unreachable = [...buy, ...sell].filter((c) => !c.reachable_within_horizon);
  return none([unreachable.length
    ? "the setups I can see need a move bigger than gold usually makes in " + horizon + " minutes (" + unreachable.map((c) => c.side + " " + c.strategy.toLowerCase().replace(/_/g, " ")).slice(0, 2).join(", ") + ")"
    : "no setup in either direction has enough supporting evidence and a target worth the risk"], buy, sell);
}
