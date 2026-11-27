// Ported from XauCloud 9e5f137753a9687670ed2105311f72b30891e29e / aiOutlookQuality.ts, source blob 6c06e15b878643430c419271a97b60420a047c8b.
// Provider-free subset; see provenance.json for extraction boundaries.
import type { CaseFeatures, TradingCase } from "./aiTradingEducation.ts";

/**
 * Hourly Outlook QUALITY — a downstream grade for each new Outlook signal.
 * It never changes Outlook (direction, levels, confidence, publication).
 *
 * 1. RULES: market conditions (before publication, relative to the signal's
 *    side) whose average result differs from Outlook's baseline in the SAME
 *    direction in the training AND the later validation period, with enough
 *    signals in each. The holdout is never used to choose rules.
 * 2. GRADE: WEAK when a losing condition is present (and not outweighed),
 *    STRONG when only winning conditions are present, STANDARD otherwise.
 * 3. "ACTUAL %": the measured history of earlier signals with the same grade
 *    (positive result, TP1/TP2/TP3 before SL in 60 min, SL first, average R),
 *    shrunk toward Outlook's overall rate when the grade has few signals.
 *    No LLM and no invented weighting produces a percentage.
 */
export const QUALITY_VERSION = "OUTLOOK_QUALITY_V2_2026_11_27";
const SHRINK = 12;
type Row = Record<string, unknown>;
export type Grade = "STRONG" | "STANDARD" | "WEAK";

const CUTS: Partial<Record<keyof CaseFeatures, number[]>> = {
  hour_utc: [3, 7, 11, 14, 18, 21], m5_momentum: [-0.5, 0.5], m15_momentum: [-0.5, 0.5], m15_extension: [-1, 1], m5_pressure: [-0.2, 0.2],
  h1_range_position: [25, 50, 75], move_60m_atr: [-0.7, 0, 0.7], move_15m_pips: [-30, 0, 30], room_pips: [30, 80], m5_atr_pips: [12, 20],
  pressure_for: [50, 70], pressure_against: [30, 50], exhaustion_pct: [50, 75], consumed_pct: [50, 80], remaining_room_r: [0.8, 1.5], source_confidence: [50, 60, 70],
};
export function bucketOf(k: keyof CaseFeatures, v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (typeof v !== "number") return String(v);
  const c = CUTS[k] ?? [0]; let i = 0; while (i < c.length && v >= c[i]!) i++;
  return i === 0 ? "<" + c[0] : i === c.length ? "≥" + c[c.length - 1] : c[i - 1] + "–" + c[i];
}
const LABELS: Partial<Record<keyof CaseFeatures, string>> = {
  hour_utc: "UTC hour", session: "session", m5_trend: "M5 trend vs signal", m15_trend: "M15 trend vs signal", h1_trend: "H1 trend vs signal", h4_trend: "H4 trend vs signal",
  m5_momentum: "M5 momentum toward signal (ATR)", m15_momentum: "M15 momentum toward signal (ATR)", m15_extension: "M15 stretch toward signal (ATR)", m5_pressure: "M5 candle pressure toward signal",
  h1_range_position: "position in the H1 range on the signal's side (%)", move_60m_atr: "last-hour move toward signal (H1 ATR)", move_15m_pips: "last-15-min move toward signal (pips)",
  room_pips: "room to next level (pips)", m5_atr_pips: "M5 ATR (pips)", swept_against: "fresh sweep against the signal", broke_with: "M15 broke a swing in the signal direction",
  pressure_for: "engine pressure for side", pressure_against: "engine pressure against side", exhaustion_pct: "engine exhaustion %", consumed_pct: "move consumed %",
  remaining_room_r: "engine remaining room (R)", regime: "Outlook regime", structure: "structure state", source_confidence: "Outlook confidence",
};
export interface QualityRule { feature: keyof CaseFeatures; bucket: string; good: boolean; text: string; train: GroupR; validation: GroupR; holdout?: GroupR; still_holds?: boolean | null }
interface GroupR { n: number; mean_r: number; tp1_60_pct: number }
const groupR = (xs: TradingCase[]): GroupR => ({ n: xs.length, mean_r: xs.length ? Math.round(xs.reduce((s, c) => s + (c.outcome.published_r ?? 0), 0) / xs.length * 1000) / 1000 : 0,
  tp1_60_pct: xs.length ? Math.round(1000 * xs.filter((c) => c.outcome.first60.tp1).length / xs.length) / 10 : 0 });
const outlookCases = (cases: TradingCase[]) => cases.filter((c) => c.engine === "OUTLOOK" && c.outcome.published_r !== null && c.outcome.first60);

/** Pure: rules chosen on train + validation only; holdout stats attached for monitoring. */
export function discoverQualityRules(cases: TradingCase[], trainEnd: string, validationEnd: string, min = { train: 25, validation: 10, effect: 0.07 }): QualityRule[] {
  const all = outlookCases(cases);
  const tr = all.filter((c) => c.at < trainEnd), va = all.filter((c) => c.at >= trainEnd && c.at < validationEnd), ho = all.filter((c) => c.at >= validationEnd);
  const bT = groupR(tr), bV = groupR(va), bH = groupR(ho);
  const rules: QualityRule[] = [];
  for (const k of Object.keys(LABELS) as Array<keyof CaseFeatures>) {
    const buckets = new Set([...tr, ...va].map((c) => bucketOf(k, c.features[k])));
    for (const b of buckets) {
      if (b === "null") continue;
      const m = (xs: TradingCase[]) => xs.filter((c) => bucketOf(k, c.features[k]) === b);
      const a = groupR(m(tr)), v = groupR(m(va));
      if (a.n < min.train || v.n < min.validation) continue;
      const dA = a.mean_r - bT.mean_r, dV = v.mean_r - bV.mean_r;
      if (Math.sign(dA) !== Math.sign(dV) || Math.min(Math.abs(dA), Math.abs(dV)) < min.effect) continue;
      const h = groupR(m(ho));
      rules.push({ feature: k, bucket: b, good: dA > 0, text: (LABELS[k] ?? k) + " " + b, train: a, validation: v, holdout: h,
        still_holds: h.n < 10 ? null : dA > 0 ? h.mean_r > bH.mean_r : h.mean_r < bH.mean_r });
    }
  }
  return rules;
}
export function gradeFor(f: CaseFeatures, rules: QualityRule[]): { grade: Grade; matched: QualityRule[] } {
  const matched = rules.filter((r) => bucketOf(r.feature, f[r.feature]) === r.bucket);
  const g = matched.filter((r) => r.good).length, b = matched.length - g;
  return { grade: b > 0 && b >= g ? "WEAK" : g > 0 && b === 0 ? "STRONG" : "STANDARD", matched };
}

export interface GradeHistory { signals: number; positive_pct: number; tp1_60m_pct: number; tp2_60m_pct: number; tp3_60m_pct: number; sl_first_60m_pct: number; avg_r: number; median_minutes_to_tp1: number | null }
/** Pure: what earlier signals of each grade actually did, shrunk toward Outlook's overall rate. */
export function gradeHistory(earlier: TradingCase[], rules: QualityRule[]): Record<Grade, GradeHistory> {
  const all = outlookCases(earlier);
  const rate = (xs: TradingCase[], p: (c: TradingCase) => boolean) => (xs.length ? xs.filter(p).length / xs.length : 0);
  const out = {} as Record<Grade, GradeHistory>;
  for (const G of ["STRONG", "STANDARD", "WEAK"] as const) {
    const xs = all.filter((c) => gradeFor(c.features, rules).grade === G);
    const s = (p: (c: TradingCase) => boolean) => Math.round(1000 * (xs.filter(p).length + SHRINK * rate(all, p)) / (xs.length + SHRINK)) / 10;
    const meanAll = all.length ? all.reduce((a, c) => a + (c.outcome.published_r ?? 0), 0) / all.length : 0;
    const mins = xs.map((c) => c.outcome.first60.minutes_to_tp1).filter((x): x is number => x !== null).sort((a, b) => a - b);
    out[G] = { signals: xs.length, positive_pct: s((c) => (c.outcome.published_r ?? 0) > 0), tp1_60m_pct: s((c) => c.outcome.first60.tp1), tp2_60m_pct: s((c) => c.outcome.first60.tp2),
      tp3_60m_pct: s((c) => c.outcome.first60.tp3), sl_first_60m_pct: s((c) => c.outcome.first60.sl_first),
      avg_r: Math.round((xs.reduce((a, c) => a + (c.outcome.published_r ?? 0), 0) + SHRINK * meanAll) / (xs.length + SHRINK) * 1000) / 1000,
      median_minutes_to_tp1: mins.length ? Math.round(mins[Math.floor(mins.length / 2)]! * 10) / 10 : null };
  }
  return out;
}

export interface OutlookQuality { version: string; grade: Grade; history: GradeHistory; reasons: Array<{ condition: string; effect: "HELPS" | "HURTS"; train_r: number; validation_r: number; holdout_r: number | null }>; summary: string; original_confidence: number | null }
export function assessOutlookQuality(f: CaseFeatures, rules: QualityRule[], history: Record<Grade, GradeHistory>): OutlookQuality {
  const { grade, matched } = gradeFor(f, rules);
  const h = history[grade];
  const summary = grade + ": earlier " + grade.toLowerCase() + " Outlook signals finished positive " + h.positive_pct + "% of the time, average " + (h.avg_r >= 0 ? "+" : "") + h.avg_r + "R" +
    " (TP1 before SL within 60 min " + h.tp1_60m_pct + "%, SL first " + h.sl_first_60m_pct + "%; " + h.signals + " signals). History, not a guarantee.";
  return { version: QUALITY_VERSION, grade, history: h, original_confidence: f.source_confidence, summary,
    reasons: matched.map((r) => ({ condition: r.text, effect: r.good ? "HELPS" : "HURTS", train_r: r.train.mean_r, validation_r: r.validation.mean_r, holdout_r: r.holdout?.n ? r.holdout.mean_r : null })) };
}

/** Pure: per-period grade results and Brier scores (knowledge frozen at `from`). */
export function validateQuality(cases: TradingCase[], rules: QualityRule[], from: string, to = "9999"): Row {
  const all = outlookCases(cases), earlier = all.filter((c) => c.at < from), test = all.filter((c) => c.at >= from && c.at < to);
  const hist = gradeHistory(earlier, rules);
  const rows = test.map((c) => ({ c, q: assessOutlookQuality(c.features, rules, hist) }));
  const brier = (p: (r: { c: TradingCase; q: OutlookQuality }) => number, y: (c: TradingCase) => boolean) =>
    rows.length ? Math.round(rows.reduce((s, r) => s + (p(r) - (y(r.c) ? 1 : 0)) ** 2, 0) / rows.length * 10000) / 10000 : null;
  const base = (y: (c: TradingCase) => boolean) => (earlier.length ? earlier.filter(y).length / earlier.length : 0.5);
  const pos = (c: TradingCase) => (c.outcome.published_r ?? 0) > 0, tp1 = (c: TradingCase) => c.outcome.first60.tp1;
  return { period: [from, to], signals: rows.length,
    grades: (["STRONG", "STANDARD", "WEAK"] as const).map((G) => {
      const xs = rows.filter((r) => r.q.grade === G).map((r) => r.c), rs = xs.map((c) => c.outcome.published_r ?? 0);
      const gp = rs.filter((r) => r > 0).reduce((a, b) => a + b, 0), gl = -rs.filter((r) => r < 0).reduce((a, b) => a + b, 0);
      let eq = 0, peak = 0, dd = 0; for (const r of rs) { eq += r; peak = Math.max(peak, eq); dd = Math.max(dd, peak - eq); }
      return { grade: G, signals: xs.length, net_r: Math.round(eq * 100) / 100, avg_r: xs.length ? Math.round(eq / xs.length * 1000) / 1000 : null, profit_factor: gl ? Math.round(gp / gl * 100) / 100 : null,
        max_drawdown_r: Math.round(dd * 100) / 100, positive_pct: xs.length ? Math.round(1000 * xs.filter(pos).length / xs.length) / 10 : null,
        predicted_positive_pct: hist[G].positive_pct, tp1_60m_pct: xs.length ? Math.round(1000 * xs.filter(tp1).length / xs.length) / 10 : null, predicted_tp1_60m_pct: hist[G].tp1_60m_pct };
    }),
    brier: { positive_result: { graded: brier((r) => r.q.history.positive_pct / 100, pos), base_rate: brier(() => base(pos), pos) },
      tp1_60m: { graded: brier((r) => r.q.history.tp1_60m_pct / 100, tp1), base_rate: brier(() => base(tp1), tp1), outlook_confidence: brier((r) => (r.c.features.source_confidence ?? 50) / 100, tp1) } } };
}
