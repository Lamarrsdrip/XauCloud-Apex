// Ported from XauCloud 9e5f137753a9687670ed2105311f72b30891e29e / marketOutlookConfidence.ts, source blob 09b3180c3bae496cd1e1bf801be51a5823228148.
// Provider-free subset; see provenance.json for extraction boundaries.
import { OUTLOOK_SYMBOL, clampGoldStopToMaxDistance } from "./marketOutlookCore.ts";

export interface ConfidenceComponents {
  trend_alignment: number;
  structure: number;
  pressure: number;
  location: number;
  exhaustion: number;
  remaining_room: number;
  liquidity_clarity: number;
  session_news_stability: number;
}

/** Port of market_outlook.py:807 `_score_component`. */

function finiteNumber(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function scoreComponent(value: number, goodAt: number, badAt: number): number {
  if (goodAt === badAt) return 50.0;
  const t = (value - badAt) / (goodAt - badAt);
  return Math.max(0.0, Math.min(100.0, t * 100.0));
}

/** Port of market_outlook.py:816 `_compute_confidence`. */
export function computeConfidence(direction: number, thesis: Record<string, unknown>, _readiness: Record<string, unknown>): ConfidenceComponents {
  const buyP = finiteNumber(thesis["buy_pressure"], 50.0);
  const sellP = finiteNumber(thesis["sell_pressure"], 50.0);
  const pressureForUs = direction === 1 ? buyP : sellP;
  const location = String(thesis["location"] ?? "");
  const structure = String(thesis["structure"] ?? "");
  const exhaustionPct = finiteNumber(thesis["exhaustion_pct"], 40.0);
  const remainingRoom = finiteNumber(thesis["remaining_room_r"], 1.0);
  let trendHealth = 60.0;
  if ("action" in thesis) trendHealth = thesis["action"] === "ALLOW_CORE" ? 75.0 : 45.0;

  const locationScores: Record<string, number> = {
    LOCATION_EXCELLENT: 95.0,
    LOCATION_GOOD: 78.0,
    LOCATION_ACCEPTABLE: 55.0,
    LOCATION_LATE: 30.0,
    LOCATION_EXTREME: 10.0,
    LOCATION_RESET_PENDING: 40.0,
    LOCATION_RESET_CONFIRMED: 70.0,
  };
  const structureScores: Record<string, number> = {
    STRUCTURE_STRONGLY_SUPPORTS: 95.0,
    STRUCTURE_SUPPORTS: 75.0,
    STRUCTURE_MIXED: 50.0,
    STRUCTURE_OPPOSES: 20.0,
    STRUCTURE_INVALIDATED: 0.0,
  };

  return {
    trend_alignment: trendHealth,
    structure: structureScores[structure] ?? 50.0,
    pressure: pressureForUs,
    location: locationScores[location] ?? 50.0,
    exhaustion: scoreComponent(exhaustionPct, 0.0, 100.0),
    remaining_room: scoreComponent(remainingRoom, 3.0, 0.0),
    liquidity_clarity: ![null, undefined, "", "NO_VALID_TRADE"].includes(thesis["action"] as string | null | undefined) ? 70.0 : 35.0,
    session_news_stability: 80.0,
  };
}

/** Port of market_outlook.py:850 `_confidence_pct`. */
export function confidencePct(c: ConfidenceComponents): number {
  const weights: Record<keyof ConfidenceComponents, number> = {
    trend_alignment: 0.2,
    structure: 0.15,
    pressure: 0.2,
    location: 0.15,
    exhaustion: 0.1,
    remaining_room: 0.1,
    liquidity_clarity: 0.05,
    session_news_stability: 0.05,
  };
  let total = 0;
  for (const k of Object.keys(weights) as (keyof ConfidenceComponents)[]) total += c[k] * weights[k];
  return Math.round(Math.max(0.0, Math.min(100.0, total)));
}

/** Port of market_outlook.py:864 `_confidence_category`. */
export function confidenceCategory(pct: number): string {
  if (pct < 35) return "VERY_LOW";
  if (pct < 55) return "LOW";
  if (pct < 75) return "MODERATE";
  return "HIGH";
}

export interface ZoneAndTargets {
  preferred_entry_zone_low: number;
  preferred_entry_zone_high: number;
  chase_limit: number;
  invalidation_price: number;
  suggested_sl: number;
  tp1_price: number;
  tp1_r: number;
  tp2_price: number;
  tp2_r: number;
  tp3_price: number;
  tp3_r: number;
}

/** Port of market_outlook.py:879 `_compute_zone_and_targets`. */
export function computeZoneAndTargets(direction: number, currentPrice: number, thesis: Record<string, unknown>, atrEstimate: number): ZoneAndTargets {
  const atr = Math.max(0.01, Number(atrEstimate ?? 0) || 0);
  const consumedPct = finiteNumber(thesis["movement_consumed_pct"] ?? thesis["move_consumed_pct"], 40.0);
  const pullbackDepthAtr = consumedPct < 60 ? 0.6 : 1.0;

  let zoneLow: number, zoneHigh: number, chaseLimit: number, sl: number;
  if (direction === 1) {
    zoneLow = Math.round((currentPrice - pullbackDepthAtr * atr) * 100) / 100;
    zoneHigh = Math.round((currentPrice - pullbackDepthAtr * 0.4 * atr) * 100) / 100;
    chaseLimit = Math.round((currentPrice + 0.5 * atr) * 100) / 100;
    sl = Math.round((zoneLow - 0.5 * atr) * 100) / 100;
  } else {
    zoneLow = Math.round((currentPrice + pullbackDepthAtr * 0.4 * atr) * 100) / 100;
    zoneHigh = Math.round((currentPrice + pullbackDepthAtr * atr) * 100) / 100;
    chaseLimit = Math.round((currentPrice - 0.5 * atr) * 100) / 100;
    sl = Math.round((zoneHigh + 0.5 * atr) * 100) / 100;
  }

  const midEntry = Math.round(((zoneLow + zoneHigh) / 2) * 100) / 100;
  sl = clampGoldStopToMaxDistance(midEntry, sl, direction);
  let riskDist = Math.abs(midEntry - sl);
  if (riskDist <= 0) riskDist = atr;

  let remainingRoomR = finiteNumber(thesis["remaining_room_r"], 2.0);
  remainingRoomR = Math.max(0.5, remainingRoomR);
  const tp1R = Math.min(1.0, remainingRoomR * 0.4);
  const tp2R = Math.min(2.0, remainingRoomR * 0.75);
  const tp3R = remainingRoomR;

  const tpPrice = (rMult: number): number => (direction === 1 ? Math.round((midEntry + riskDist * rMult) * 100) / 100 : Math.round((midEntry - riskDist * rMult) * 100) / 100);

  return {
    preferred_entry_zone_low: Math.min(zoneLow, zoneHigh),
    preferred_entry_zone_high: Math.max(zoneLow, zoneHigh),
    chase_limit: chaseLimit,
    invalidation_price: sl,
    suggested_sl: sl,
    tp1_price: tpPrice(tp1R),
    tp1_r: Math.round(tp1R * 100) / 100,
    tp2_price: tpPrice(tp2R),
    tp2_r: Math.round(tp2R * 100) / 100,
    tp3_price: tpPrice(tp3R),
    tp3_r: Math.round(tp3R * 100) / 100,
  };
}

/** Port of market_outlook.py:928 `_expected_path`. */
export function expectedPath(direction: number, thesis: Record<string, unknown>): string {
  const location = String(thesis["location"] ?? "");
  const action = String(thesis["action"] ?? "");
  if (direction === 0) return location === "LOCATION_ACCEPTABLE" || location === "" ? "RANGE_ROTATION" : "NO_CLEAR_PATH";
  if (["TRANSITION_WATCH", "OPPOSITE_DISCOVERY"].includes(action)) return "REVERSAL_FORMING";
  if (["LOCATION_LATE", "LOCATION_EXTREME"].includes(location)) return direction === 1 ? "PULLBACK_FIRST_THEN_BUY" : "RALLY_FIRST_THEN_SELL";
  if (action === "ALLOW_CORE") return "DIRECT_CONTINUATION";
  return "NO_CLEAR_PATH";
}

