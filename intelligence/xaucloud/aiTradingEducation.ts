// Ported from XauCloud 9e5f137753a9687670ed2105311f72b30891e29e / aiTradingEducation.ts, source blob 6bbd46d2df290c47539df320722ec16fa87b9c03.
// Provider-free subset; see provenance.json for extraction boundaries.
import type { Bar } from "./aiOpportunityEngine.ts";
import { framesAt, keyLevels, summarizeFrame, type FrameSummary } from "./aiTraderBrain.ts";
import { simulatePlan } from "./aiOpinionLearning.ts";

/**
 * XauCloud AI's historical trading education.
 *
 * Every published Hourly Outlook and M10 signal becomes a CASE STUDY:
 *  - features = the market exactly as it stood BEFORE publication (only
 *    candles that closed earlier), expressed relative to the signal's side;
 *  - outcome  = what price did afterwards, decomposed: was the direction
 *    right, was the entry the problem, would the opposite side, a better
 *    limit, a confirmation entry or skipping have been better.
 * LESSONS are conditions discovered on the oldest period, kept only if they
 * hold on a later validation period, and then sat as an EXAM on an untouched
 * holdout period. The trader brain retrieves the validated lessons and the
 * most similar earlier cases for every analysis. Nothing here is a verdict:
 * it is evidence with sample sizes and its own measured reliability.
 */
export const KNOWLEDGE_VERSION = "TRADING_EDUCATION_V2_2026_11_27";
type Row = Record<string, unknown>;
type Side = "BUY" | "SELL";
const PIP = 0.1;
const SLIPPAGE = 0.1; // $ per fill, on top of the published bid/ask
const r2 = (n: number) => Math.round(n * 100) / 100;

export interface CaseFeatures {
  hour_utc: number; session: "ASIA" | "LONDON" | "OVERLAP" | "NEW_YORK" | "LATE";
  m5_trend: Rel; m15_trend: Rel; h1_trend: Rel; h4_trend: Rel;
  m5_momentum: number | null; m15_momentum: number | null; m15_extension: number | null; m5_pressure: number | null;
  h1_range_position: number | null; move_60m_atr: number | null; move_15m_pips: number | null;
  room_pips: number | null; m5_atr_pips: number | null; swept_against: boolean; broke_with: boolean;
  pressure_for: number | null; pressure_against: number | null; exhaustion_pct: number | null; consumed_pct: number | null;
  remaining_room_r: number | null; regime: string | null; structure: string | null; source_confidence: number | null;
}
export type Rel = "WITH" | "AGAINST" | "RANGE" | "UNKNOWN";

function session(h: number): CaseFeatures["session"] {
  return h < 7 ? "ASIA" : h < 12 ? "LONDON" : h < 16 ? "OVERLAP" : h < 21 ? "NEW_YORK" : "LATE";
}
const rel = (f: FrameSummary | null, sg: number): Rel => !f ? "UNKNOWN" : f.trend === "RANGE" ? "RANGE" : (f.trend === "UP") === (sg > 0) ? "WITH" : "AGAINST";
const num = (v: unknown): number | null => { const n = Number(v); return v !== null && v !== undefined && v !== "" && Number.isFinite(n) ? n : null; };

/** Pure: the market before `t`, relative to `side`. Uses only bars that closed before t. */
export function caseFeatures(m1: Bar[], t: number, side: Side, source: Row | null): CaseFeatures {
  const sg = side === "BUY" ? 1 : -1;
  const past = m1.filter((b) => b.t + 60_000 <= t && b.t >= t - 5 * 86_400_000);
  const f = (tf: "M5" | "M15" | "H1" | "H4") => summarizeFrame(framesAt(past, tf, t));
  const m5 = f("M5"), m15 = f("M15"), h1 = f("H1"), h4 = f("H4");
  const last = past[past.length - 1];
  const at = (min: number) => { let p: number | null = null; for (const b of past) { if (b.t <= t - min * 60_000) p = b.c; else break; } return p; };
  const p60 = at(60), p15 = at(15), px = last?.c ?? null;
  const h1Atr = h1 ? h1.atr_pips * PIP : null;
  let room: number | null = null;
  if (px !== null) {
    const lv = keyLevels(past, t, px) as { nearest_levels_above?: Array<{ distance_pips: number }>; nearest_levels_below?: Array<{ distance_pips: number }> };
    const xs = sg > 0 ? lv.nearest_levels_above : lv.nearest_levels_below;
    room = xs && xs.length ? xs[0]!.distance_pips : null;
  }
  const flags = (x: FrameSummary | null) => x?.flags ?? [];
  const bp = num(source?.["buy_pressure"] ?? source?.["buy_evidence"]), sp = num(source?.["sell_pressure"] ?? source?.["sell_evidence"]);
  const h = new Date(t).getUTCHours();
  return {
    hour_utc: h, session: session(h),
    m5_trend: rel(m5, sg), m15_trend: rel(m15, sg), h1_trend: rel(h1, sg), h4_trend: rel(h4, sg),
    m5_momentum: m5 ? r2(sg * m5.momentum_atr) : null, m15_momentum: m15 ? r2(sg * m15.momentum_atr) : null,
    m15_extension: m15 ? r2(sg * m15.extension_atr) : null, m5_pressure: m5 ? r2(sg * m5.pressure) : null,
    h1_range_position: h1?.range_position_pct == null ? null : sg > 0 ? h1.range_position_pct : 100 - h1.range_position_pct,
    move_60m_atr: p60 !== null && px !== null && h1Atr ? r2(sg * (px - p60) / h1Atr) : null,
    move_15m_pips: p15 !== null && px !== null ? Math.round(sg * (px - p15) / PIP) : null,
    room_pips: room, m5_atr_pips: m5?.atr_pips ?? null,
    swept_against: flags(m5).includes(sg > 0 ? "swept_low_and_closed_back_inside" : "swept_high_and_closed_back_inside") || flags(m15).includes(sg > 0 ? "swept_low_and_closed_back_inside" : "swept_high_and_closed_back_inside"),
    broke_with: flags(m15).includes(sg > 0 ? "closed_above_last_swing_high" : "closed_below_last_swing_low"),
    pressure_for: sg > 0 ? bp : sp, pressure_against: sg > 0 ? sp : bp,
    exhaustion_pct: num(source?.["exhaustion_pct"]), consumed_pct: num(source?.["movement_consumed_pct"]),
    remaining_room_r: num(source?.["remaining_room_r"]), regime: (source?.["market_regime"] as string) ?? (source?.["trend_state"] as string) ?? null,
    structure: (source?.["structure_state"] as string) ?? null, source_confidence: num(source?.["confidence_pct"] ?? source?.["confidence"]),
  };
}

export interface CaseOutcome {
  /** First of +1 / −1 M15-ATR (min $3) reached within 4 h, from the executable price. */
  direction: "WITH" | "AGAINST" | "NEITHER";
  minutes_to_direction: number | null;
  move_30m_pips: number | null; move_60m_pips: number | null;
  published_r: number | null; opposite_r: number | null; limit_r: number | null; confirm_r: number | null; limit_filled: boolean | null;
  mae_r: number | null; mfe_r: number | null; tp1_after_stop: boolean | null;
  best: "ENTER_NOW" | "BETTER_LIMIT" | "CONFIRMATION" | "OPPOSITE" | "SKIP";
  /** Published levels inside the first 60 minutes: which came first (stop checked before targets in a shared minute). */
  first60: { tp1: boolean; tp2: boolean; tp3: boolean; sl_first: boolean; timeout: boolean; minutes_to_tp1: number | null };
  label: "CLEAN_WIN" | "WIN_AFTER_DRAWDOWN" | "STOP_TOO_TIGHT" | "WRONG_DIRECTION" | "NO_FOLLOW_THROUGH" | "SMALL_RESULT";
}
/**
 * Pure: what happened after `t`. Plan results include the published bid/ask
 * plus $0.10 slippage per fill. `plan` is null for level-less M10 signals:
 * then a standard plan (stop 1.5 × M15 ATR, targets 1/2/3 × the same unit)
 * is used so the same questions can be answered.
 */
export function caseOutcome(after: Bar[], t: number, side: Side, exec: number, spread: number, plan: { stop: number; targets: number[] } | null, m15AtrPips: number | null): CaseOutcome {
  const sg = side === "BUY" ? 1 : -1;
  const unit = Math.max(3, (m15AtrPips ?? 30) * PIP);
  const fill = exec + sg * SLIPPAGE;
  const p = plan ?? { stop: fill - sg * 1.5 * unit, targets: [fill + sg * unit, fill + sg * 2 * unit, fill + sg * 3 * unit] };
  const path = after.filter((b) => b.t >= Math.floor(t / 60_000) * 60_000).sort((a, b) => a.t - b.t);
  let direction: CaseOutcome["direction"] = "NEITHER", minutesTo: number | null = null;
  for (const b of path) {
    if (b.t >= t + 240 * 60_000) break;
    const up = sg > 0 ? b.h - fill : fill - b.l, down = sg > 0 ? fill - b.l : b.h - fill;
    if (down >= unit) { direction = "AGAINST"; minutesTo = (b.t - t) / 60_000; break; } // conservative: adverse first in a shared minute
    if (up >= unit) { direction = "WITH"; minutesTo = (b.t - t) / 60_000; break; }
  }
  const mv = (min: number) => { const w = path.filter((b) => b.t < t + min * 60_000); return w.length >= min * 0.6 ? Math.round(sg * (w[w.length - 1]!.c - fill) / PIP) : null; };
  const risk = Math.abs(fill - p.stop);
  const pub = simulatePlan(path, { side, start: t, entry: fill, stop: p.stop, targets: p.targets, mode: "MARKET" });
  const oppFill = exec - sg * (spread + SLIPPAGE); // the other side trades at the other quote, plus slippage
  const opp = simulatePlan(path, { side: sg > 0 ? "SELL" : "BUY", start: t, entry: oppFill, stop: oppFill + sg * risk, targets: p.targets.map((x) => oppFill - (x - fill)), mode: "MARKET" });
  const lim = simulatePlan(path, { side, start: t, entry: fill - sg * 0.5 * risk, stop: p.stop, targets: p.targets, mode: "LIMIT", fillWindowMin: 60 });
  const conf = simulatePlan(path, { side, start: t, entry: fill + sg * 0.25 * risk, stop: p.stop, targets: p.targets, mode: "STOP", fillWindowMin: 30 });
  // All plan results in units of the ORIGINAL risk so they are comparable.
  const inR0 = (s: ReturnType<typeof simulatePlan>, entry: number) => s.status === "FILLED" && risk > 0 ? (s.r ?? 0) * Math.abs(entry - p.stop) / risk : s.status === "NOT_FILLED" ? 0 : null;
  const published_r = pub.status === "FILLED" ? pub.r ?? null : null;
  const opposite_r = opp.status === "FILLED" ? opp.r ?? null : null;
  const limit_r = inR0(lim, fill - sg * 0.5 * risk), confirm_r = inR0(conf, fill + sg * 0.25 * risk);
  const options: Array<[CaseOutcome["best"], number]> = [["ENTER_NOW", published_r ?? -9], ["BETTER_LIMIT", limit_r ?? -9], ["CONFIRMATION", confirm_r ?? -9], ["OPPOSITE", opposite_r ?? -9], ["SKIP", 0]];
  const best = options.reduce((a, b) => (b[1] > a[1] + 0.05 ? b : a))[0];
  const tp1AfterStop = pub.status === "FILLED" && pub.tp1_first === false ? Boolean(pub.tp1_reached_from_market) : null;
  const label: CaseOutcome["label"] = published_r === null ? "SMALL_RESULT"
    : published_r > 0.05 ? ((pub.mae_r ?? 1) <= 0.1 ? "CLEAN_WIN" : "WIN_AFTER_DRAWDOWN")
    : tp1AfterStop ? "STOP_TOO_TIGHT" : direction === "AGAINST" ? "WRONG_DIRECTION" : direction === "NEITHER" ? "NO_FOLLOW_THROUGH" : "SMALL_RESULT";
  const first60 = (() => {
    let hit = 0, sl = false, tp1Min: number | null = null;
    for (const b of path) {
      if (b.t >= t + 60 * 60_000) break;
      if (sg > 0 ? b.l <= p.stop : b.h >= p.stop) { sl = hit === 0; break; }
      while (hit < p.targets.length && (sg > 0 ? b.h >= p.targets[hit]! : b.l <= p.targets[hit]!)) { if (hit === 0) tp1Min = (b.t - t) / 60_000; hit++; }
      if (hit >= p.targets.length) break;
    }
    return { tp1: hit >= 1, tp2: hit >= 2, tp3: hit >= 3, sl_first: sl, timeout: hit === 0 && !sl, minutes_to_tp1: tp1Min };
  })();
  return { first60, direction, minutes_to_direction: minutesTo, move_30m_pips: mv(30), move_60m_pips: mv(60), published_r, opposite_r, limit_r, confirm_r,
    limit_filled: lim.status === "FILLED" ? true : lim.status === "NOT_FILLED" ? false : null, mae_r: pub.mae_r ?? null, mfe_r: pub.mfe_r ?? null, tp1_after_stop: tp1AfterStop, best, label };
}

export interface TradingCase { id: string; engine: "OUTLOOK" | "M10_ENGINE"; side: Side; at: string; features: CaseFeatures; outcome: CaseOutcome; study: string[] }

/** Pure: the plain-language case study (why it worked or failed, what was visible beforehand). */
export function caseStudy(f: CaseFeatures, o: CaseOutcome, side: Side): string[] {
  const out: string[] = [];
  const what = { CLEAN_WIN: "worked cleanly (almost no drawdown)", WIN_AFTER_DRAWDOWN: "worked after a drawdown", STOP_TOO_TIGHT: "was stopped out, then price reached TP1 anyway: direction right, stop/entry wrong",
    WRONG_DIRECTION: "was wrong: price moved one M15 ATR against before one in favour", NO_FOLLOW_THROUGH: "did not follow through either way within 4 h", SMALL_RESULT: "produced a small result" }[o.label];
  out.push(side + " " + what + ".");
  const pre: string[] = [];
  if (f.m15_trend !== "UNKNOWN") pre.push("M15 trend " + f.m15_trend.toLowerCase() + " the signal");
  if (f.h1_trend !== "UNKNOWN") pre.push("H1 " + f.h1_trend.toLowerCase());
  if (f.move_60m_atr !== null) pre.push("last hour moved " + f.move_60m_atr + " H1-ATR " + (f.move_60m_atr >= 0 ? "in the signal's favour (chasing risk)" : "against the signal (fading)"));
  if (f.h1_range_position !== null) pre.push("price at " + f.h1_range_position + "% of the H1 range toward the signal side");
  if (f.room_pips !== null) pre.push(f.room_pips + " pips to the next level in the signal direction");
  if (f.swept_against) pre.push("a sweep against the signal had just failed (liquidity taken)");
  if (f.exhaustion_pct !== null) pre.push("Outlook exhaustion " + f.exhaustion_pct + "%");
  out.push("Before publication: " + pre.join("; ") + ".");
  const alt = { ENTER_NOW: "entering immediately was the best choice", BETTER_LIMIT: "a better limit entry would have done better (it filled)", CONFIRMATION: "waiting for a confirmation move would have done better",
    OPPOSITE: "the opposite side would have done better", SKIP: "skipping was best" }[o.best];
  out.push("Afterwards: " + alt + (o.limit_filled === false ? "; a 0.5R better limit would never have filled" : "") + ".");
  return out;
}

// ---------------------------------------------------------------- lessons
export interface Condition { key: string; text: string; test: (f: CaseFeatures, side: Side) => boolean }
const C = (key: string, text: string, test: Condition["test"]): Condition => ({ key, text, test });
const singles: Condition[] = [
  ...(["ASIA", "LONDON", "OVERLAP", "NEW_YORK", "LATE"] as const).map((s) => C("session=" + s, "published in the " + s.toLowerCase().replace("_", " ") + " session", (f) => f.session === s)),
  C("side=BUY", "a BUY signal", (_f, s) => s === "BUY"), C("side=SELL", "a SELL signal", (_f, s) => s === "SELL"),
  ...(["m5_trend", "m15_trend", "h1_trend", "h4_trend"] as const).flatMap((k) => (["WITH", "AGAINST", "RANGE"] as const).map((v) => C(k + "=" + v, k.split("_")[0]!.toUpperCase() + " trend " + v.toLowerCase() + " the signal", (f) => f[k] === v))),
  C("chase>=1", "the last hour already moved ≥1 H1-ATR in the signal's direction", (f) => (f.move_60m_atr ?? 0) >= 1),
  C("fade<=-1", "the last hour moved ≥1 H1-ATR against the signal", (f) => (f.move_60m_atr ?? 0) <= -1),
  C("extended>=75", "price in the top quarter of the H1 range toward the signal side", (f) => (f.h1_range_position ?? 50) >= 75),
  C("discount<=25", "price in the bottom quarter of the H1 range (room to run)", (f) => (f.h1_range_position ?? 50) <= 25),
  C("m5mom>=0.5", "M5 momentum already with the signal", (f) => (f.m5_momentum ?? 0) >= 0.5),
  C("m5mom<=-0.5", "M5 momentum against the signal", (f) => (f.m5_momentum ?? 0) <= -0.5),
  C("room<30", "less than 30 pips to the next level", (f) => f.room_pips !== null && f.room_pips < 30),
  C("room>=80", "80+ pips of room to the next level", (f) => (f.room_pips ?? 0) >= 80),
  C("swept_against", "a sweep against the signal just failed", (f) => f.swept_against),
  C("broke_with", "M15 closed beyond the last swing in the signal direction", (f) => f.broke_with),
  C("pressure_for>=70", "engine pressure for the side ≥70", (f) => (f.pressure_for ?? 0) >= 70),
  C("exhaustion>=70", "engine exhaustion ≥70%", (f) => (f.exhaustion_pct ?? 0) >= 70),
  C("consumed>=70", "≥70% of the expected move already consumed", (f) => (f.consumed_pct ?? 0) >= 70),
  C("highvol", "high volatility (M5 ATR ≥ 25 pips)", (f) => (f.m5_atr_pips ?? 0) >= 25), C("lowvol", "low volatility (M5 ATR < 12 pips)", (f) => f.m5_atr_pips !== null && f.m5_atr_pips < 12),
];
/** A small, fixed set of meaningful pairs (not every combination: that would only find coincidences). */
const PAIRS: Array<[string, string]> = [["session=LONDON", "side=BUY"], ["session=LONDON", "side=SELL"], ["session=NEW_YORK", "side=BUY"], ["session=NEW_YORK", "side=SELL"], ["session=ASIA", "side=BUY"], ["session=ASIA", "side=SELL"],
  ["m15_trend=WITH", "chase>=1"], ["m15_trend=AGAINST", "fade<=-1"], ["m15_trend=AGAINST", "swept_against"], ["extended>=75", "m5mom>=0.5"], ["discount<=25", "m5mom<=-0.5"],
  ["h1_trend=AGAINST", "m15_trend=WITH"], ["h1_trend=WITH", "m15_trend=AGAINST"], ["pressure_for>=70", "exhaustion>=70"], ["highvol", "session=OVERLAP"], ["room<30", "chase>=1"]];
export const CONDITIONS: Condition[] = [...singles, ...PAIRS.map(([a, b]) => { const x = singles.find((c) => c.key === a)!, y = singles.find((c) => c.key === b)!; return C(a + " & " + b, x.text + " and " + y.text, (f, s) => x.test(f, s) && y.test(f, s)); })];

export interface GroupStats { n: number; direction_with_pct: number | null; mean_r: number | null; mean_opposite_r: number | null; best: Record<string, number>; wilson_with: [number, number] | null }
function wilson(k: number, n: number): [number, number] | null {
  if (!n) return null; const z = 1.96, p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n), m = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n));
  return [Math.round((c - m) / d * 1000) / 10, Math.round((c + m) / d * 1000) / 10];
}
export function groupStats(cs: TradingCase[]): GroupStats {
  const decided = cs.filter((c) => c.outcome.direction !== "NEITHER"), withN = decided.filter((c) => c.outcome.direction === "WITH").length;
  const rs = cs.map((c) => c.outcome.published_r).filter((x): x is number => x !== null), os = cs.map((c) => c.outcome.opposite_r).filter((x): x is number => x !== null);
  const best: Record<string, number> = {}; for (const c of cs) best[c.outcome.best] = (best[c.outcome.best] ?? 0) + 1;
  return { n: cs.length, direction_with_pct: decided.length ? Math.round(1000 * withN / decided.length) / 10 : null,
    mean_r: rs.length ? Math.round(rs.reduce((a, b) => a + b, 0) / rs.length * 1000) / 1000 : null,
    mean_opposite_r: os.length ? Math.round(os.reduce((a, b) => a + b, 0) / os.length * 1000) / 1000 : null, best, wilson_with: wilson(withN, decided.length) };
}
export interface Lesson { key: string; engine: string; text: string; effect: "FAVOURS_SIGNAL" | "AGAINST_SIGNAL" | "FAVOURS_OPPOSITE"; train: GroupStats; validation: GroupStats; baseline_train: GroupStats; baseline_validation: GroupStats; summary: string }
/**
 * Pure: conditions that beat (or trail) the engine's own baseline in BOTH the
 * training and the later validation period, with enough cases in each. The
 * holdout period is never looked at here.
 */
export function discoverLessons(cases: TradingCase[], engine: string, trainEnd: string, validationEnd: string, min = { train: 20, validation: 10 }): Lesson[] {
  const mine = cases.filter((c) => c.engine === engine);
  const train = mine.filter((c) => c.at < trainEnd), val = mine.filter((c) => c.at >= trainEnd && c.at < validationEnd);
  const bt = groupStats(train), bv = groupStats(val);
  const out: Lesson[] = [];
  for (const cond of CONDITIONS) {
    const a = train.filter((c) => cond.test(c.features, c.side)), b = val.filter((c) => cond.test(c.features, c.side));
    if (a.length < min.train || b.length < min.validation) continue;
    const ga = groupStats(a), gb = groupStats(b);
    const dA = (ga.direction_with_pct ?? 50) - (bt.direction_with_pct ?? 50), dB = (gb.direction_with_pct ?? 50) - (bv.direction_with_pct ?? 50);
    const rA = engine === "OUTLOOK" ? (ga.mean_r ?? 0) - (bt.mean_r ?? 0) : 0, rB = engine === "OUTLOOK" ? (gb.mean_r ?? 0) - (bv.mean_r ?? 0) : 0;
    const dirAgrees = Math.abs(dA) >= 8 && Math.abs(dB) >= 5 && Math.sign(dA) === Math.sign(dB);
    const rAgrees = engine === "OUTLOOK" && Math.abs(rA) >= 0.1 && Math.abs(rB) >= 0.05 && Math.sign(rA) === Math.sign(rB);
    if (!dirAgrees && !rAgrees) continue;
    const good = (dirAgrees ? dA : rA) > 0;
    const opp = !good && (ga.mean_opposite_r ?? -1) > 0 && (gb.mean_opposite_r ?? -1) > 0;
    const effect: Lesson["effect"] = good ? "FAVOURS_SIGNAL" : opp ? "FAVOURS_OPPOSITE" : "AGAINST_SIGNAL";
    const eng = engine === "OUTLOOK" ? "Hourly Outlook" : "M10";
    const summary = "When " + eng + " publishes " + cond.text + ": direction right " + ga.direction_with_pct + "% (train, n=" + ga.n + ") and " + gb.direction_with_pct + "% (later validation, n=" + gb.n + ") vs " +
      bt.direction_with_pct + "%/" + bv.direction_with_pct + "% for all its signals" + (engine === "OUTLOOK" ? "; published plan " + ga.mean_r + "R / " + gb.mean_r + "R per signal vs " + bt.mean_r + "R / " + bv.mean_r + "R" : "") +
      (opp ? "; the opposite side averaged " + ga.mean_opposite_r + "R / " + gb.mean_opposite_r + "R" : "") + ".";
    out.push({ key: cond.key, engine, text: cond.text, effect, train: ga, validation: gb, baseline_train: bt, baseline_validation: bv, summary });
  }
  return out.sort((x, y) => Math.abs((y.train.direction_with_pct ?? 50) - (y.baseline_train.direction_with_pct ?? 50)) - Math.abs((x.train.direction_with_pct ?? 50) - (x.baseline_train.direction_with_pct ?? 50)));
}

// ---------------------------------------------------------- retrieval
const NUMS: Array<[keyof CaseFeatures, number]> = [["m5_momentum", 1], ["m15_momentum", 1], ["m15_extension", 1.5], ["m5_pressure", 0.5], ["h1_range_position", 40], ["move_60m_atr", 1], ["room_pips", 60], ["m5_atr_pips", 15], ["hour_utc", 6]];
const CATS: Array<keyof CaseFeatures> = ["session", "m5_trend", "m15_trend", "h1_trend", "h4_trend", "swept_against", "broke_with"];
export function caseDistance(a: CaseFeatures, b: CaseFeatures): number {
  let d = 0;
  for (const [k, scale] of NUMS) { const x = a[k] as number | null, y = b[k] as number | null; d += x === null || y === null ? 1 : Math.min(4, Math.abs(x - y) / scale); }
  for (const k of CATS) d += a[k] === b[k] ? 0 : 1;
  return d;
}
/** Pure: the k most similar EARLIER cases on the same side and engine, and what they did. */
export function similarCases(f: CaseFeatures, side: Side, engine: string, cases: TradingCase[], before: string, k = 15): Row {
  const pool = cases.filter((c) => c.engine === engine && c.side === side && c.at < before);
  const near = pool.map((c) => ({ c, d: caseDistance(f, c.features) })).sort((x, y) => x.d - y.d).slice(0, k).map((x) => x.c);
  const g = groupStats(near);
  return { engine, side, compared_with: pool.length, nearest: near.length, ...g,
    examples: near.slice(0, 4).map((c) => ({ at: c.at, label: c.outcome.label, best: c.outcome.best, published_r: c.outcome.published_r, study: c.study.join(" ") })),
    reading: near.length < 8 ? "Too few similar earlier cases to lean on." : "Nearest earlier " + engine + " " + side + " signals by structure, momentum, location, volatility and session." };
}

/** Pure: lessons that apply to these features, with their measured reliability. */
export function applicableLessons(f: CaseFeatures, side: Side, lessons: Lesson[], engine?: string): Row[] {
  return lessons.filter((l) => (!engine || l.engine === engine) && CONDITIONS.find((c) => c.key === l.key)?.test(f, side))
    .slice(0, 8).map((l) => ({ engine: l.engine, effect: l.effect, lesson: l.summary }));
}

// ---------------------------------------------------------------- exam
export interface ExamResult { policy: string; signals: number; taken: number; net_r: number; expectancy_r: number | null; profit_factor: number | null; max_drawdown_r: number; missed_winners: number; avoided_losers: number; win_rate_pct: number | null }
function exam(name: string, cs: TradingCase[], decide: (c: TradingCase) => "TAKE" | "OPPOSITE" | "SKIP"): ExamResult {
  let eq = 0, peak = 0, dd = 0, taken = 0, wins = 0, gp = 0, gl = 0, missed = 0, avoided = 0;
  for (const c of cs) {
    const d = decide(c), pub = c.outcome.published_r ?? 0;
    const r = d === "TAKE" ? pub : d === "OPPOSITE" ? c.outcome.opposite_r ?? 0 : 0;
    if (d !== "SKIP") { taken++; if (r > 0) { wins++; gp += r; } else gl -= r; }
    else { if (pub > 0) missed++; else if (pub < 0) avoided++; }
    eq += r; peak = Math.max(peak, eq); dd = Math.max(dd, peak - eq);
  }
  return { policy: name, signals: cs.length, taken, net_r: r2(eq), expectancy_r: cs.length ? Math.round(eq / cs.length * 1000) / 1000 : null, profit_factor: gl ? r2(gp / gl) : null,
    max_drawdown_r: r2(dd), missed_winners: missed, avoided_losers: avoided, win_rate_pct: taken ? Math.round(1000 * wins / taken) / 10 : null };
}
/**
 * The exam: decisions on the untouched holdout using ONLY knowledge from the
 * training + validation periods. Outlook only (it has published levels).
 */
export function holdoutExam(cases: TradingCase[], lessons: Lesson[], validationEnd: string): Row {
  const known = cases.filter((c) => c.engine === "OUTLOOK" && c.at < validationEnd);
  const hold = cases.filter((c) => c.engine === "OUTLOOK" && c.at >= validationEnd && c.outcome.published_r !== null);
  const knn = (c: TradingCase) => { const s = similarCases(c.features, c.side, "OUTLOOK", known, validationEnd, 15); return s as unknown as GroupStats; };
  const lessonScore = (c: TradingCase) => applicableLessons(c.features, c.side, lessons, "OUTLOOK").reduce((s, l) => s + (l["effect"] === "FAVOURS_SIGNAL" ? 1 : -1), 0);
  return {
    holdout_signals: hold.length, from: validationEnd,
    results: [
      exam("Take every Outlook signal (no intelligence)", hold, () => "TAKE"),
      exam("Similar-case memory: take when similar earlier cases paid", hold, (c) => ((knn(c).mean_r ?? 0) > 0 ? "TAKE" : "SKIP")),
      exam("Similar-case memory incl. opposite side", hold, (c) => { const k = knn(c); return (k.mean_r ?? 0) > 0 ? "TAKE" : (k.mean_opposite_r ?? 0) > 0.15 && (k.direction_with_pct ?? 50) < 40 ? "OPPOSITE" : "SKIP"; }),
      exam("Validated lessons: take when lessons net favour the signal", hold, (c) => (lessonScore(c) > 0 ? "TAKE" : "SKIP")),
      exam("Validated lessons: skip only when lessons net oppose", hold, (c) => (lessonScore(c) < 0 ? "SKIP" : "TAKE")),
      exam("Lessons + similar cases must both agree", hold, (c) => (lessonScore(c) >= 0 && (knn(c).mean_r ?? 0) > 0 ? "TAKE" : "SKIP")),
    ],
    note: "Plan results include published bid/ask and $0.10 slippage; stop checked before targets within a minute; 4 h horizon; ⅓ off at each target, stop to entry after TP1.",
  };
}

/**
 * Fixed chronological periods. Lessons are discovered on TRAIN, must hold on
 * VALIDATION, and the HOLDOUT (from validation_end) is only used for the exam.
 * Nov 1–10 has no price data. When the holdout grows, move the boundaries
 * forward as a new knowledge version (never silently).
 */
export const SPLITS = { train_end: "2026-10-10", validation_end: "2026-11-01" } as const;
export interface Splits { train_end: string; validation_end: string; method: string }
/**
 * Rolling chronological periods, re-derived on every rebuild: the oldest 60%
 * of Outlook cases train, the next 20% validate, the newest 20% are the
 * holdout. As time passes the boundaries move forward, so newly completed
 * signals become validation and then training evidence, while the newest
 * signals always form a holdout no rule was chosen on. A minimum of 30 days
 * of training keeps a few recent trades from overwriting long-standing lessons.
 */
export function rollingSplits(cases: TradingCase[], fallback: { train_end: string; validation_end: string } = SPLITS): Splits {
  const ts = cases.filter((c) => c.engine === "OUTLOOK").map((c) => c.at).sort();
  if (ts.length < 200) return { ...fallback, method: "FIXED_FALLBACK (fewer than 200 Outlook cases)" };
  const q = (p: number) => ts[Math.min(ts.length - 1, Math.floor(ts.length * p))]!;
  const first = Date.parse(ts[0]!), train = q(0.6), val = q(0.8);
  if (Date.parse(train) - first < 30 * 86_400_000) return { ...fallback, method: "FIXED_FALLBACK (training span under 30 days)" };
  return { train_end: train, validation_end: val, method: "ROLLING_60_20_20" };
}

function windowOf(sorted: Bar[], from: number, to: number): Bar[] {
  let lo = 0, hi = sorted.length; while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m]!.t < from) lo = m + 1; else hi = m; }
  const out: Bar[] = []; for (let i = lo; i < sorted.length && sorted[i]!.t < to; i++) out.push(sorted[i]!); return out;
}
interface CaseTask { engine: TradingCase["engine"]; id: string; t: number; side: Side; exec: number; spread: number; plan: { stop: number; targets: number[] } | null; src: Row }
/** Pure, cheap: deduplicated case tasks (Outlook: first per hourly slot; M10: first per direction per 10-minute bucket). */
export function caseTasks(outlooks: Row[], m10: Row[], sorted: Bar[]): CaseTask[] {
  const tasks: CaseTask[] = [];
  const slots = new Set<string>();
  for (const o of [...outlooks].sort((a, b) => String(a["published_at"]).localeCompare(String(b["published_at"])))) {
    const slot = String(o["hourly_slot"] ?? String(o["published_at"]).slice(0, 13)); if (slots.has(slot)) continue;
    const side = o["primary_direction"] as Side, t = Date.parse(String(o["published_at"]));
    const bid = Number(o["published_bid"]), ask = Number(o["published_ask"]), stop = Number(o["original_sl"]);
    const targets = [o["tp1_price"], o["tp2_price"], o["tp3_price"]].map(Number).filter((x) => x > 0);
    if (!(bid > 0 && ask >= bid && stop > 0 && targets.length) || !Number.isFinite(t)) continue;
    slots.add(slot);
    tasks.push({ engine: "OUTLOOK", id: String(o["id"]), t, side, exec: side === "BUY" ? ask : bid, spread: ask - bid, plan: { stop, targets }, src: o });
  }
  const buckets = new Set<string>();
  for (const s of [...m10].sort((a, b) => String(a["effective_at"]).localeCompare(String(b["effective_at"])))) {
    const t = Date.parse(String(s["effective_at"])), side = s["direction"] as Side;
    const key = side + Math.floor(t / 600_000); if (!Number.isFinite(t) || buckets.has(key)) continue; buckets.add(key);
    const before = windowOf(sorted, t - 120_000, t); const px = before[before.length - 1]?.c; if (!px) continue;
    // M10 has no published quote: assume a 0.25 spread around the last minute close.
    tasks.push({ engine: "M10_ENGINE", id: String(s["signal_id"]), t, side, exec: px + (side === "BUY" ? 0.125 : -0.125), spread: 0.25, plan: null, src: s });
  }
  return tasks;
}
/** Pure: the case study for one task, or null when the market was closed or price data is incomplete / not yet mature. */
export function runCaseTask(sorted: Bar[], k: CaseTask, isOpen: (t: number) => boolean, nowMs: number): TradingCase | null {
  if (!isOpen(k.t) || k.t > nowMs - 270 * 60_000) return null;
  const before = windowOf(sorted, k.t - 5 * 86_400_000, k.t), after = windowOf(sorted, k.t, k.t + 270 * 60_000);
  if (before.filter((b) => b.t >= k.t - 150 * 60_000).length < 90 || after.length < 150) return null;
  const features = caseFeatures(before, k.t, k.side, k.src);
  const m15 = summarizeFrame(framesAt(before, "M15", k.t));
  const outcome = caseOutcome(after, k.t, k.side, k.exec, k.spread, k.plan, m15?.atr_pips ?? null);
  return { id: k.id, engine: k.engine, side: k.side, at: new Date(k.t).toISOString(), features, outcome, study: caseStudy(features, outcome, k.side) };
}
export function buildCases(sorted: Bar[], outlooks: Row[], m10: Row[], isOpen: (t: number) => boolean, nowMs = Date.now()): TradingCase[] {
  return caseTasks(outlooks, m10, sorted).map((k) => runCaseTask(sorted, k, isOpen, nowMs)).filter((c): c is TradingCase => c !== null).sort((a, b) => a.at.localeCompare(b.at));
}
/** Per-lesson check on the holdout: does it still hold on data it never saw? (monitoring only, never used to select lessons) */
export function lessonHealth(lessons: Lesson[], cases: TradingCase[], from: string): Array<Lesson & { holdout: GroupStats; still_holds: boolean | null }> {
  return lessons.map((l) => {
    const cond = CONDITIONS.find((c) => c.key === l.key)!;
    const all = cases.filter((c) => c.engine === l.engine && c.at >= from), hit = all.filter((c) => cond.test(c.features, c.side));
    const h = groupStats(hit), base = groupStats(all);
    const d = (h.direction_with_pct ?? 50) - (base.direction_with_pct ?? 50);
    const still = hit.length < 8 ? null : l.effect === "FAVOURS_SIGNAL" ? d > 0 : d < 0;
    return { ...l, holdout: h, still_holds: still };
  });
}

/**
 * Pure: entry-timing evidence for THIS situation — among the most similar
 * earlier signals on this side, what entering immediately, a 0.5R-better
 * limit (unfilled = 0R, i.e. a missed trade) and a 0.25R confirmation entry
 * actually returned, and how many winners waiting would have missed.
 */
export function entryTimingHere(f: CaseFeatures, side: Side, cases: TradingCase[], before: string, k = 40): Row {
  const near = cases.filter((c) => c.side === side && c.at < before && c.outcome.published_r !== null)
    .map((c) => ({ c, d: caseDistance(f, c.features) })).sort((a, b) => a.d - b.d).slice(0, k).map((x) => x.c);
  if (near.length < 15) return { similar_signals: near.length, reading: "Too few similar earlier signals to compare entry timing." };
  const avg = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length) * 1000) / 1000;
  const now = near.map((c) => c.outcome.published_r ?? 0), lim = near.map((c) => c.outcome.limit_r ?? 0), conf = near.map((c) => c.outcome.confirm_r ?? 0);
  const limitMissedWinners = near.filter((c) => c.outcome.limit_filled === false && (c.outcome.published_r ?? 0) > 0).length;
  const cleanFast = near.filter((c) => c.outcome.label === "CLEAN_WIN").length;
  const best = [["ENTER_NOW", avg(now)], ["BETTER_LIMIT", avg(lim)], ["CONFIRMATION", avg(conf)]].sort((a, b) => Number(b[1]) - Number(a[1]))[0]!;
  return { similar_signals: near.length, enter_now_avg_r: avg(now), better_limit_avg_r: avg(lim), confirmation_avg_r: avg(conf),
    better_limit_fill_pct: Math.round(100 * near.filter((c) => c.outcome.limit_filled).length / near.length), winners_missed_by_waiting_for_limit: limitMissedWinners,
    clean_fast_winners: cleanFast, best_measured: best[0],
    reading: best[0] === "ENTER_NOW" ? "In comparable situations entering at the current price did best; waiting cost money." : "In comparable situations " + String(best[0]).toLowerCase().replace("_", " ") + " did better than entering now (" + best[1] + "R vs " + avg(now) + "R) — wait only with a specific price and expiry." };
}
