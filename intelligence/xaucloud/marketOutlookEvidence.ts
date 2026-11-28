// Pinned pure normalization from XauCloud fc91b97e2ee88eae6b9d4e24c6d74ef522c1ec4c.
import { BLOCKED_DECISIONS, EXECUTION_READY_DECISIONS, EXPIRED_DECISIONS } from "./marketOutlookCore.ts";

/** Port of market_outlook.py:376 `_canonical_m10_signal`. */
export function canonicalM10Signal(evidence: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const ev = evidence ?? {};
  const m10 = (ev["m10_signal"] as Record<string, unknown> | undefined) ?? {};
  const readiness = (ev["entry_readiness"] as Record<string, unknown> | undefined) ?? {};
  const thesis = (ev["market_thesis"] as Record<string, unknown> | undefined) ?? {};
  const decision = String(m10["decision"] ?? m10["final_decision"] ?? readiness["final_action"] ?? readiness["action"] ?? thesis["final_action"] ?? thesis["action"] ?? "").toUpperCase().trim();
  const preferred = String(m10["preferred_direction"] ?? m10["direction"] ?? readiness["preferred_direction"] ?? readiness["direction"] ?? thesis["preferred_direction"] ?? thesis["direction"] ?? "").toUpperCase().trim();
  const freshness = String(m10["freshness_state"] ?? "FRESH").toUpperCase().trim();
  const execution = (ev["execution"] as Record<string, unknown> | undefined) ?? {};
  const finalDecision = String(execution["final_decision"] ?? m10["execution_status"] ?? m10["execution_decision"] ?? readiness["final_decision"] ?? "").toUpperCase().trim();
  const blocker = String(execution["final_blocker"] ?? m10["blocker_code"] ?? m10["blocked_by"] ?? readiness["final_blocker"] ?? readiness["blocked_by"] ?? "").toUpperCase().trim();

  let direction = "";
  if (decision === "BUY_CANDIDATE") direction = "BUY";
  else if (decision === "SELL_CANDIDATE") direction = "SELL";
  else if (decision === "ALLOW_CORE" && ["BUY", "SELL"].includes(preferred)) direction = preferred;

  if (direction && ["BUY", "SELL"].includes(preferred) && preferred !== direction) direction = "";
  const candidate = ["BUY", "SELL"].includes(direction);
  const stale = !["", "FRESH", "CURRENT"].includes(freshness);
  const explicitAllowed = execution["final_execution_allowed"] === true;
  const explicitBlocked = (execution["final_execution_allowed"] === false && (Boolean(blocker) || BLOCKED_DECISIONS.has(finalDecision))) || BLOCKED_DECISIONS.has(finalDecision);
  const expired = stale || EXPIRED_DECISIONS.has(finalDecision) || ["CANCEL", "EXPIRE", "TIMEOUT"].some((p) => finalDecision.startsWith(p));
  const executionReady = Boolean(candidate && !expired && !explicitBlocked && (explicitAllowed || EXECUTION_READY_DECISIONS.has(finalDecision) || decision === "ALLOW_CORE"));

  let confidence: number | null = null;
  if (m10["confidence"] !== undefined && m10["confidence"] !== null) {
    const n = Number(m10["confidence"]);
    if (Number.isFinite(n)) confidence = Math.max(0, Math.min(100, n));
  }

  return {
    candidate,
    actionable: executionReady,
    execution_ready: executionReady,
    blocked: Boolean(candidate && explicitBlocked),
    expired: Boolean(candidate && expired),
    direction,
    decision,
    execution_status: finalDecision || (executionReady ? "READY" : candidate ? "PENDING" : "NO_CANDIDATE"),
    // A READY/allowed decision cannot simultaneously expose a blocker. Some
    // EA payloads retain the previous blocker text beside a later ALLOW; the
    // executable decision is authoritative and the stale label must not make
    // the UI say both "execution-ready" and "Blocked".
    blocker_code: executionReady ? null : (blocker || null),
    confidence,
    freshness_state: freshness,
    bar_time: String(m10["bar_time"] ?? m10["candle_time"] ?? ev["ts"] ?? ""),
    source: Object.keys(m10).length > 0 ? "M10_SIGNAL" : "READINESS_FALLBACK",
    candidate_id: String(m10["candidate_id"] ?? m10["signal_id"] ?? readiness["candidate_id"] ?? ""),
  };
}
