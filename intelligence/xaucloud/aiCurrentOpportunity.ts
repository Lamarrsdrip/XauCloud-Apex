// Ported from XauCloud 9e5f137753a9687670ed2105311f72b30891e29e / aiCurrentOpportunity.ts, source blob 429285d0c2a3f0b85ded1abd19c4d0d47bf8051f.
// Provider-free subset; see provenance.json for extraction boundaries.
/** XauCloud Gold convention: 1 pip = $0.10 price movement. */
export const MIN_CURRENT_OPPORTUNITY_PIPS = 50;
export const GOLD_PIP_SIZE = 0.1;
export const CURRENT_OPPORTUNITY_POLICY = "Seek a genuine 50-pip or larger opportunity from the CURRENT executable price (50 XauCloud pips = $5.00 Gold movement). Evaluate BUY at ask and SELL at bid independently, accounting for spread, structural invalidation, realistic adverse excursion and remaining room within the requested horizon. For every new actionable recommendation, TP1 is exactly 50 pips ($5.00) from the current executable entry. Choose TP2/TP3 independently from the same entry using actual structure and remaining room; stronger evidence may justify extending those later targets, never TP1 or the stop merely because confidence is high. State any material expected pullback or bounce in the reasoning, including its likely area only when supported by evidence. A new current-market call is BUY NOW, SELL NOW or NO TRADE; no future conditional entry as the primary recommendation. If price later reaches a different area, reassess using fresh evidence. Do not mechanically add or subtract $5 to invent a target, widen a stop to force a trade, or chase a move that is already spent. If both sides lack a defensible 50-pip opportunity now, say NO TRADE with the specific reason. A possible pullback or bounce is a risk, not automatically a reason to postpone an otherwise viable trade. Combine actual quote, M1–D1 structure, pressure (OHLC proxy, not actual order flow), momentum, exhaustion/extension, support/resistance, volatility, chart evidence when provided, historical lessons and own mistakes, session, news/calendar and cross-market data. Compare conflicting evidence; use available tools to fill missing or conflicting evidence, never invent unavailable inputs or claim certainty.";
export function hasExactCurrentTarget(side: "BUY" | "SELL", executable: number, tp1: number | undefined): boolean {
  if (!Number.isFinite(executable) || executable <= 0 || typeof tp1 !== "number" || !Number.isFinite(tp1) || tp1 <= 0) return false;
  const move = side === "BUY" ? tp1 - executable : executable - tp1;
  // Allow only the half-cent rounding needed for the customer-facing two-decimal price.
  return Math.abs(move - MIN_CURRENT_OPPORTUNITY_PIPS * GOLD_PIP_SIZE) <= 0.00500001;
}

/** A timestamped decision snapshot is not an indefinitely executable quote. */
export type CurrentQuote = { bid: number; ask: number; at: string };
export function usableCurrentQuote(q: CurrentQuote | null | undefined, now: number): q is CurrentQuote {
  if (!q || !Number.isFinite(q.bid) || !Number.isFinite(q.ask) || q.bid <= 0 || q.ask < q.bid || q.ask - q.bid >= 5) return false;
  const age = now - Date.parse(q.at);
  return Number.isFinite(age) && age >= -5000 && age <= 75_000;
}
/** One pip of movement is the maximum publication drift; do not silently rebase targets. */
export function publicationQuoteIssue(original: CurrentQuote | null | undefined, latest: CurrentQuote | null | undefined, now: number): string | null {
  if (!usableCurrentQuote(original, now) || !usableCurrentQuote(latest, now)) return "STALE_OR_UNVERIFIED_QUOTE";
  if (Math.max(Math.abs(original.bid - latest.bid), Math.abs(original.ask - latest.ask)) > GOLD_PIP_SIZE + 1e-8) return "MARKET_MOVED_DURING_ANALYSIS";
  return null;
}

/** One geometry contract for chat/chart and structured automatic opinions. */
export function immediatePlanIssue(plan: { side: "BUY" | "SELL"; entry: number; stop: number; targets: number[] }, quote: { bid: number; ask: number } | null): string | null {
  if (!quote || !Number.isFinite(quote.bid) || !Number.isFinite(quote.ask) || quote.bid <= 0 || quote.ask < quote.bid || quote.ask - quote.bid >= 5) return "NO_VALID_EXECUTABLE_QUOTE";
  const { side, entry, stop, targets } = plan, sg = side === "BUY" ? 1 : -1;
  const executable = side === "BUY" ? quote.ask : quote.bid;
  const closePrice = side === "BUY" ? quote.bid : quote.ask;
  if (!Number.isFinite(entry) || Math.abs(entry - executable) > 0.00500001) return "CURRENT_ENTRY_REQUIRED";
  if (targets.length < 2 || targets.length > 3 || !hasExactCurrentTarget(side, executable, targets[0]) || !hasExactCurrentTarget(side, entry, targets[0]))
    return "TP1_NOT_EXACTLY_50_PIPS_FROM_CURRENT_PRICE";
  if (!Number.isFinite(stop) || stop <= 0 || sg * (closePrice - stop) <= 0 || targets.some((tp, i) => !Number.isFinite(tp) || tp <= 0 || sg * (tp - executable) <= 0 || (i > 0 && sg * (tp - targets[i-1]!) <= 0)))
    return "STOP_OR_TARGET_GEOMETRY_INVALID";
  return null;
}
