// Ported from XauCloud 9e5f137753a9687670ed2105311f72b30891e29e / aiOpinionLearning.ts, source blob 6912fdb79859cac8ed5077f8d2d81991b284716b.
// Provider-free subset; see provenance.json for extraction boundaries.
import type { Bar } from "./aiOpportunityEngine.ts";

/**
 * Learning from the AI's own opinions, labelled ONLY from what price did
 * afterwards (never from an engine's or the AI's own outcome labels, so a
 * wrong label can't teach itself). Every opinion — including NO TRADE and
 * INSUFFICIENT EVIDENCE — gets one deduplicated lesson. A lesson pattern is
 * shown to the model only when it holds in BOTH the older and the newer half
 * of the record (walk-forward), with enough cases in each.
 */
export const LESSONS = "ai_opinion_lessons";
export const OPINION_COLLECTIONS = ["ai_signal_opinions", "ai_chat_recommendations"] as const;
const PIP = 0.1;
const FILL_WINDOW_MIN = 60, HORIZON_MIN = 240;
type Row = Record<string, unknown>;

export interface PlanSim {
  status: "FILLED" | "NOT_FILLED" | "NO_PATH" | "BAD_GEOMETRY";
  fill_at?: number; fill_price?: number; r?: number; tp1_first?: boolean | null; targets_hit?: number;
  mfe_r?: number; mae_r?: number; minutes_to_tp1?: number | null; fill_delay_min?: number;
  /** Did price later reach the plan's TP1 from where it stood at decision time (for unfilled / stand-aside plans)? */
  tp1_reached_from_market?: boolean;
}
/**
 * Replay one plan on minute bars. Start at the next full minute if the decision was mid-bar; never fill before the decision. MARKET fills on the first eligible bar; LIMIT / STOP
 * fill when touched inside `fillWindowMin`. Stop is checked before targets
 * inside a minute (conservative). One third off at each target, stop to entry
 * after TP1, remainder marked at the horizon.
 */
export function simulatePlan(bars: Bar[], p: { side: "BUY" | "SELL"; start: number; entry: number | null; stop: number; targets: number[];
  mode: "MARKET" | "LIMIT" | "STOP"; fillWindowMin?: number; horizonMin?: number }): PlanSim {
  const sg = p.side === "BUY" ? 1 : -1, fw = p.fillWindowMin ?? FILL_WINDOW_MIN, hz = p.horizonMin ?? HORIZON_MIN;
  const path = bars.filter((b) => b.t >= Math.ceil(p.start / 60_000) * 60_000 && b.t < p.start + (fw + hz) * 60_000).sort((a, b) => a.t - b.t);
  if (path.length < Math.min(30, hz) || !p.targets.length) return { status: "NO_PATH" };
  const tp1FromMarket = path.some((b) => b.t < p.start + hz * 60_000 && (sg > 0 ? b.h >= p.targets[0]! : b.l <= p.targets[0]!));
  let i = 0, fillPx: number;
  if (p.mode === "MARKET") fillPx = p.entry ?? path[0]!.o;
  else {
    const e = p.entry!;
    for (; i < path.length && path[i]!.t < p.start + fw * 60_000; i++) {
      const b = path[i]!;
      if (p.mode === "LIMIT" ? (sg > 0 ? b.l <= e : b.h >= e) : (sg > 0 ? b.h >= e : b.l <= e)) break;
    }
    if (i >= path.length || path[i]!.t >= p.start + fw * 60_000) return { status: "NOT_FILLED", tp1_reached_from_market: tp1FromMarket };
    fillPx = e;
  }
  const risk = Math.abs(fillPx - p.stop);
  if (!(sg * (fillPx - p.stop) > 0) || !(risk > 0) || !Number.isFinite(fillPx) || p.targets.some((t, j) => !Number.isFinite(t) || !(sg * (t - fillPx) > 0) || (j > 0 && !(sg * (t - p.targets[j - 1]!) > 0)))) return { status: "BAD_GEOMETRY" };
  const fillAt = path[i]!.t, end = fillAt + hz * 60_000;
  let rem = 1, pnl = 0, stop = p.stop, k = 0, last = fillPx, mfe = 0, mae = 0, tp1At: number | null = null, tp1First: boolean | null = null;
  for (let j = i; j < path.length && path[j]!.t < end; j++) {
    const b = path[j]!; last = b.c;
    const adv = sg > 0 ? fillPx - b.l : b.h - fillPx; mae = Math.max(mae, adv);
    if (sg > 0 ? b.l <= stop : b.h >= stop) { pnl += rem * sg * (stop - fillPx); rem = 0; if (tp1First === null) tp1First = false; break; }
    mfe = Math.max(mfe, sg > 0 ? b.h - fillPx : fillPx - b.l);
    while (k < p.targets.length && (sg > 0 ? b.h >= p.targets[k]! : b.l <= p.targets[k]!)) {
      const share = k === p.targets.length - 1 ? rem : 1 / p.targets.length;
      pnl += share * Math.abs(p.targets[k]! - fillPx); rem -= share;
      if (k === 0) { tp1At = b.t; tp1First = true; stop = fillPx; }
      k++;
    }
    if (rem <= 1e-9) break;
  }
  if (rem > 1e-9) pnl += rem * sg * (last - fillPx);
  return { status: "FILLED", fill_at: fillAt, fill_price: fillPx, r: pnl / risk, tp1_first: tp1First, targets_hit: k, mfe_r: mfe / risk, mae_r: mae / risk,
    minutes_to_tp1: tp1At === null ? null : (tp1At - fillAt) / 60_000, fill_delay_min: (fillAt - p.start) / 60_000, tp1_reached_from_market: tp1FromMarket };
}

export const LESSON_LABELS = [
  "SUCCESSFUL_IMMEDIATE_ENTRY", "SUCCESSFUL_CONDITIONAL_ENTRY", "WRONG_DIRECTION", "CORRECT_DIRECTION_LATE_ENTRY",
  "CORRECT_DIRECTION_UNREACHABLE_ENTRY", "CORRECT_DIRECTION_POOR_STOP", "INCORRECT_DISAGREEMENT", "CORRECT_DISAGREEMENT",
  "MISSED_CONTINUATION", "EXCESSIVE_CONFIRMATION", "AVOIDED_LOSS", "INCORRECT_REVERSAL_PREDICTION", "UNRESOLVED",
] as const;
export type LessonLabel = typeof LESSON_LABELS[number];
/**
 * Pure: what kind of right or wrong this opinion was. `published` is the
 * signal's own plan replayed from publication (null for level-less M10, where
 * `publishedMovePips` — the 60-minute move in the published direction — is used).
 */
export function classifyLesson(x: { verdict: string; execution: string; aiSide: "BUY" | "SELL" | null; publishedSide: "BUY" | "SELL" | null;
  ai: PlanSim | null; published: PlanSim | null; publishedMovePips: number | null; aiEntryVsPublishedR: number | null }): LessonLabel[] {
  const pubWon = x.published?.status === "FILLED" ? (x.published.r ?? 0) > 0 : x.publishedMovePips !== null ? x.publishedMovePips > 0 : null;
  const labels: LessonLabel[] = [];
  const disagree = x.verdict === "DISAGREE_OPPOSITE";
  if (x.ai?.status === "FILLED") {
    const won = (x.ai.r ?? 0) > 0;
    if (won) labels.push(x.execution === "ENTER_NOW" ? "SUCCESSFUL_IMMEDIATE_ENTRY" : "SUCCESSFUL_CONDITIONAL_ENTRY");
    else if (x.ai.tp1_first === false && x.ai.tp1_reached_from_market) labels.push("CORRECT_DIRECTION_POOR_STOP");
    else if ((x.ai.mfe_r ?? 0) < 0.5 && (x.ai.mae_r ?? 0) >= 1) labels.push(disagree ? "INCORRECT_REVERSAL_PREDICTION" : "WRONG_DIRECTION");
    else if (x.aiEntryVsPublishedR !== null && x.aiEntryVsPublishedR < -0.3 && pubWon) labels.push("CORRECT_DIRECTION_LATE_ENTRY");
    else labels.push("WRONG_DIRECTION");
  } else if (x.ai?.status === "NOT_FILLED") {
    if (x.ai.tp1_reached_from_market) labels.push(x.execution === "WAIT_PULLBACK" ? "CORRECT_DIRECTION_UNREACHABLE_ENTRY" : "EXCESSIVE_CONFIRMATION");
  } else if (x.aiSide === null && pubWon !== null) {
    // A stand-aside is not a win merely because the signal later lost.
    // Record missed TP1 separately from the full management return.
    if (x.published?.tp1_first === true || pubWon) labels.push(x.verdict === "NO_TRADE" ? "EXCESSIVE_CONFIRMATION" : "MISSED_CONTINUATION");
    else if (x.published?.status === "FILLED" && (x.published.r ?? 0) < 0) labels.push("AVOIDED_LOSS");
  }
  if (disagree && pubWon !== null && x.ai?.status === "FILLED") {
    if (pubWon && (x.ai.r ?? 0) <= 0) labels.push("INCORRECT_DISAGREEMENT");
    else if (!pubWon && (x.ai.r ?? 0) > 0) labels.push("CORRECT_DISAGREEMENT");
  }
  return labels.length ? labels : ["UNRESOLVED"];
}

