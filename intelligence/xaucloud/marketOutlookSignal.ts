// Ported from XauCloud 9e5f137753a9687670ed2105311f72b30891e29e / marketOutlookSignal.ts, source blob da2ccafa396d3055761c51bd98f70669b77a89d1.
// Provider-free subset; see provenance.json for extraction boundaries.
import { computeConfidence, confidencePct, confidenceCategory } from "./marketOutlookConfidence.ts";
interface HourlyBiasResult {
  direction_label: string;
  direction: number;
  market_regime: string;
  components: ReturnType<typeof computeConfidence>;
  evidence_strength: number;
  confidence: number;
  confidence_category: string;
  directional_conflict: string | null;
  directional_transformation_applied: boolean;
  automated_entry_approved: boolean;
  automated_block_reason: string | null;
}

/** Port of market_outlook.py:1138 `_resolve_hourly_bias` -- pure directional-bias resolver for the Hourly Manual Outlook. */
export function resolveHourlyBias(canonicalM10: Record<string, unknown>, thesis: Record<string, unknown>): HourlyBiasResult {
  const rawDir = String(canonicalM10["direction"] ?? "");
  const actionable = Boolean(canonicalM10["actionable"]);
  const automatedEntryApproved = actionable;
  const automatedBlockReason = actionable ? null : String(canonicalM10["blocker_code"] ?? canonicalM10["execution_status"] ?? "") || null;

  const buyRaw = Number(thesis["buy_pressure"]);
  const sellRaw = Number(thesis["sell_pressure"]);
  const buyP = Number.isFinite(buyRaw) ? buyRaw : 50.0;
  const sellP = Number.isFinite(sellRaw) ? sellRaw : 50.0;
  const pressureGap = buyP - sellP;
  const structureState = String(thesis["structure"] ?? "");

  const MIN_FALLBACK_DIRECTION_PRESSURE_GAP = 12.0;
  const DIRECTION_CONFLICT_PRESSURE_GAP = 15.0;
  let directionalConflict: string | null = null;
  let directionalTransformationApplied = false;
  let directionLabel: string;
  if (["BUY", "SELL"].includes(rawDir)) {
    directionLabel = rawDir;
  } else if (Math.abs(pressureGap) >= MIN_FALLBACK_DIRECTION_PRESSURE_GAP) {
    directionLabel = pressureGap > 0 ? "BUY" : "SELL";
  } else {
    // No canonical direction + balanced/weak pressure is not a BUY signal.
    directionLabel = "NEUTRAL";
  }
  let direction = directionLabel === "BUY" ? 1 : directionLabel === "SELL" ? -1 : 0;

  const structureSupportsCandidate = ["STRUCTURE_STRONGLY_SUPPORTS", "STRUCTURE_SUPPORTS"].includes(structureState);
  if (directionLabel === "SELL" && pressureGap >= DIRECTION_CONFLICT_PRESSURE_GAP && !structureSupportsCandidate) {
    directionalConflict = `buy pressure (${buyP.toFixed(0)}) materially contradicts the SELL candidate without confirming structure`;
  } else if (directionLabel === "BUY" && pressureGap <= -DIRECTION_CONFLICT_PRESSURE_GAP && !structureSupportsCandidate) {
    directionalConflict = `sell pressure (${sellP.toFixed(0)}) materially contradicts the BUY candidate without confirming structure`;
  }
  if (directionalConflict) {
    // Never manufacture the opposite trade from a conflict.  A contradiction
    // means WAIT/NEUTRAL; the next fresh evidence cycle can establish a new
    // canonical direction.  This removes the old flip-flop path.
    directionLabel = "NEUTRAL";
    direction = 0;
    directionalTransformationApplied = true;
  }

  const marketRegime = directionalTransformationApplied
    ? "TRANSITION"
    : String(thesis["market_regime"] ?? thesis["regime"] ?? thesis["direction_stage"] ?? thesis["lifecycle"] ?? "WAITING").toUpperCase();

  const components = computeConfidence(direction, thesis, {});
  const evidenceStrength = confidencePct(components);
  const canonicalConfidence = rawDir === directionLabel && !directionalTransformationApplied ? (canonicalM10["confidence"] as number | null) : null;
  let confidence = canonicalConfidence !== null && canonicalConfidence !== undefined ? Math.round(canonicalConfidence) : evidenceStrength;

  const pressureGapAbs = Math.abs(pressureGap);
  if (pressureGapAbs < 4.0) confidence = Math.min(confidence, 25);
  else if (pressureGapAbs < 12.0) confidence = Math.min(confidence, 45);
  else if (pressureGapAbs < 25.0) confidence = Math.min(confidence, 70);
  if (directionalTransformationApplied) confidence = Math.min(confidence, 65);
  confidence = Math.max(0, Math.min(100, Math.trunc(confidence)));
  const confCategory = confidenceCategory(confidence);

  return {
    direction_label: directionLabel,
    direction,
    market_regime: marketRegime,
    components,
    evidence_strength: evidenceStrength,
    confidence,
    confidence_category: confCategory,
    directional_conflict: directionalConflict,
    directional_transformation_applied: directionalTransformationApplied,
    automated_entry_approved: automatedEntryApproved && ["BUY", "SELL"].includes(directionLabel),
    automated_block_reason: ["BUY", "SELL"].includes(directionLabel) ? automatedBlockReason : (directionalConflict ? "DIRECTIONAL_CONFLICT_WAIT" : automatedBlockReason),
  };
}

