# Apex 4 pullback execution research

The comparisons in this report reuse the 142 opportunities from the original November 2026 replay. November results had already been disclosed before this work. These comparisons serve as development evidence for stop placement, execution timing and basket policies.

## Original stop and runtime behavior

The original stop starts at the farther adverse level of the most recent M1 candle or confirmed M1 swing. For a BUY, Apex takes the lower of the two lows. For a SELL, it takes the higher of the two highs. Apex then places the stop another 0.25 times the 14-bar M1 ATR plus quoted spread in the adverse direction, rounded to $0.01/oz. The entry reference is the ask for a BUY and the bid for a SELL. This sets risk in price units using structure, volatility and spread. The stop is anchored independently of TP1 and TP2.

The replay uses a synthetic executable opening quote, adds entry slippage and divides net P&L by the distance from the filled entry to the initial stop. Exit slippage and round-trip commission reduce P&L. It checks BUY stop and target levels against bid, and SELL levels against ask. Earlier results filled a crossed stop at the stop price with modeled slippage. The new variants use the open after a worse gap, then add slippage. They preserve stop-first ordering inside ambiguous minute bars.

The EA takes the transmitted stop and TP2, checks the actual exit-side quote and rounds both levels to the broker tick size. It checks the broker minimum stop distance before ordering. The original stack placed TP2 and SL on each layer and separately watched those levels and a 20-minute campaign expiry. The original 20-minute research window therefore matches the EA's original configured cutoff for immediate pullbacks. It was a design choice that now has a measured comparison across durations.

The EA freezes its per-order equity-tier lot size at campaign start. It validates broker volume increments and minimums, estimates required margin at the current quote, reserves initial spread cost and a free margin cushion, and checks portfolio loss at the stop. Increasing the dollar stop distance uses more of that risk budget per layer. Actual volume, leverage, liquidity, liquidation, partial fills and execution costs require broker deal and account records.

## Matched comparison design

- Every scenario starts with the same 142 supplied entry timestamps and initial target geometry. In the timing rows, the denominator reports all opportunities and the count of filled opportunities separately.
- A delay reprices the entry at the later minute's open. A prior stop breach invalidates it, a prior TP2 makes it unavailable, and an entry already beyond TP1 is rejected. Delayed studies hold their chosen duration from the hypothetical entry.
- The limit uses an entry improvement of 25% of original stop distance, with a five-minute validity. M1 data records a fill only when the quote crossed the limit or the limit was marketable at the minute's open. An intrabar fill gets no credit for a target in that minute. The stop gets priority.
- The structural stop uses the latest confirmed five-bar adverse swing, buffered by 0.25 ATR and spread. The volatility stop uses 1.5 ATR plus spread from entry. In both scenarios the stop must be on the adverse side and the same targets are retained.
- TP1 partial policies close half at TP1 and send the remainder to TP2. The protected half moves to a modeled cost-adjusted break-even level effective from the following minute. The trailing policy follows the observed favorable extreme by half initial risk after TP1. Momentum and structure exits execute at the next open after deterioration is visible on completed candles.
- Session-bounded replay uses 17:00 New York local time as the next daily close. A truncated dataset can censor unresolved trades. Minute OHLC cannot establish order inside the bar or model quote-by-quote target fills.
- Drawdown is an equal-initial-risk sequence in entry order. Holding periods longer than 20 minutes can overlap. Cumulative R and the drawdown statistic measure the virtual opportunity sequence.
- Lower and higher modeled spread scenarios reprice execution using original geometry. This isolates cost sensitivity from opportunity selection. Spread, per-side slippage and round-trip commission in $/oz are 0.20/0.05/0.07, 0.30/0.10/0.07 and 0.50/0.20/0.10.

## Reproduction

Use the verified November archive files described in the [original November report](APEX_V4_HISTORICAL_VALIDATION.md). The script verifies archive digests, row counts and the matched original P&L before comparing policies. Use Node 22 or later and supply a new private destination filename.

```bash
node --experimental-strip-types scripts/compare-apex4-pullback-policies.mjs \
  --ticks-zip /private/path/Exness_XAUUSD_2026_11.zip \
  /private/path/XAUUSD_M1_2026_11.csv.gz /private/path/november-policy-results.json
```
