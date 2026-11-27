// XauCloud pinned 9e5f137753a9687670ed2105311f72b30891e29e / 1d42831de8fb98beb9176f6f0d89bc8933b1f7c3
/**
 * Single source of truth for "is the Gold/forex market open" across the
 * backend. Extracted from notifications.ts's `_market_open_and_bot_connected`
 * (market_outlook.py:515 port) so trial-day counting and notification gating
 * can never define market hours differently from each other.
 *
 * Standard New York XAUUSD trading hours, including DST and weekday rollover.
 * No holiday calendar is available here; live broker evidence is required to
 * avoid interpreting an exchange holiday or broker outage as an open session.
 */
export function isMarketOpen(now: Date): boolean {
  // New York 17:00 Friday close / Sunday 18:00 reopen; DST-aware.
  // Broker-specific holiday closures still require fresh broker evidence.
  if (!Number.isFinite(now.getTime())) return false;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", weekday: "short", hour: "2-digit", hourCycle: "h23",
  }).formatToParts(now);
  const day = parts.find(part => part.type === "weekday")?.value;
  const hour = Number(parts.find(part => part.type === "hour")?.value);
  if (!Number.isFinite(hour)) return false;
  if (day === "Sat") return false;
  if (day === "Sun") return hour >= 18;
  if (day === "Fri") return hour < 17;
  return ["Mon", "Tue", "Wed", "Thu"].includes(day ?? "") && (hour < 17 || hour >= 18);
}

/**
 * Counts distinct UTC calendar days that were at least partly open-market
 * between trialStartedAt (inclusive) and now (inclusive), for the 3-market-day
 * signal trial. A day counts if the market was open at ANY sampled point
 * during it -- checked at 00:00 and 12:00 UTC, which is sufficient given
 * isMarketOpen's only closed window (Friday 21:00 UTC -> Sunday 21:00 UTC)
 * never fully spans a UTC calendar day without covering one of those samples.
 */
export function marketDaysElapsed(trialStartedAt: Date, now: Date): number {
  if (now.getTime() < trialStartedAt.getTime()) return 0;
  const startDay = Date.UTC(trialStartedAt.getUTCFullYear(), trialStartedAt.getUTCMonth(), trialStartedAt.getUTCDate());
  const endDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  let count = 0;
  for (let day = startDay; day <= endDay; day += 86_400_000) {
    const morning = new Date(day);
    const noon = new Date(day + 12 * 3_600_000);
    if (isMarketOpen(morning) || isMarketOpen(noon)) count += 1;
  }
  return count;
}

/**
 * Start of the trading session that contains `now`: the most recent moment
 * the market went from closed (weekend or the daily New York 17:00 break) to
 * open. Null when the market is closed or no reopen is found within 4 days.
 * Reopens happen on the hour, so an hourly backwards scan is exact.
 */
export function currentSessionOpenedAt(now: Date): Date | null {
  if (!isMarketOpen(now)) return null;
  const hourStart = Math.floor(now.getTime() / 3_600_000) * 3_600_000;
  for (let t = hourStart; t > hourStart - 96 * 3_600_000; t -= 3_600_000) {
    if (!isMarketOpen(new Date(t - 1))) return new Date(t);
  }
  return null;
}
