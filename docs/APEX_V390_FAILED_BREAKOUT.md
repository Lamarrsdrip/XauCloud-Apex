# Apex v3.9.0 FailedBreakout

Compile `ea/XauCloud-Apex.mq5`. Versioned copy:
`ea/XauCloud-Apex-v3.9.0-FailedBreakout.mq5`.

## Why 3.8.9 lost the 25 Aug 05:00 tester

XAUUSDm M1 grind higher ~4638 → 4649. Apex sold every dip (0.06 / 0.18 / 0.20 /
0.03) and the basket was red while price made higher highs.

v3.8.9 did three things that stacked:

1. **failedHold** = any bearish close below the swept wick. A 1-bar dip counted.
2. **M3 bypass** when the 8-bar impulse was strong — which it always is in a trend.
3. **Re-arm on every new high** (AUDIT-003). Each higher high killed the watch
   and immediately started a new SELL. First fill went green on the dip, pyramid
   added, grind resumed, account dead.

3.8.8 was stricter (same-bar close through the pre-impulse prior) so it skipped
this tape. That was luck of the filter, not a better breakfast model — but it
was right to skip.

## What 3.9.0 does

| Gate | 3.8.8 | 3.8.9 | 3.9.0 |
|---|---|---|---|
| Liquidity | rolling 9–79 | swing 9–40 | swing 9–40 |
| Rejection | same-bar V through 70-bar prior | wick dip OR close through prior | **close back through the nearby pool** (two-bar OK) |
| M3 | hard | bypassed on strong M1 | **hard again** |
| New higher high | re-arm immediately | re-arm immediately | **dead thesis until an opposite impulse** |
| Late fill | allowed | >1.50 ATR refused | >1.50 ATR refused |
| Score | 76 | 76 | 76 |

Sizing, pyramid-only-when-green, no-SL: unchanged from 3.8.8.

## What this will and will not do

It will still miss some V-shaped breakfasts that never close back through the
pool. That is the cost of not fading a grind.

It will not magically win random tester days. Run 25 Aug 05:00 again: you
should see **no cluster of sells on those dips**. If you still do, send the
Experts log.
