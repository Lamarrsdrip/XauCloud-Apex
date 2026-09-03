# XauCloud Apex v2.0.0

Private XAUUSD campaign EA and control plane built around the repeated pattern visible in the supplied trade videos: strong impulse into a recent liquidity extreme, sweep/failure, rejection, micro-structure break, initial entry, then increasingly large additions only while the basket is profitable and fresh continuation or failed-pullback confirmation appears.

## Important implementation correction from v1

v1 was too shallow. Its `learningEnabled` flag only logged telemetry and did not actually learn, its add logic re-ran the original sweep detector (making later pyramid additions unlikely), and its default lot ladder was not the requested 15%-then-double behavior.

v2 fixes those architectural problems:

- multi-stage WATCH -> CONFIRM -> CAMPAIGN state instead of requiring every condition on one candle;
- first layer uses 15% of **current free-margin capacity** by default;
- each profitable confirmed add doubles the capacity request: 15%, 30%, 60%, 100%, then 100% of remaining free-margin capacity, always bounded by what the broker will accept at that instant;
- no broker SL and no daily drawdown cap by design;
- basket exits when the campaign's own contribution to equity (`cycleStart + basket floating P/L`) reaches the configured target/multiplier — not raw account equity, so this stays correct even if something else ever touches the account mid-campaign;
- additions do not require a second liquidity sweep; they use continuation breaks or failed pullback confirmation and must occur after favorable price movement;
- actual persistent learning service records campaign outcomes, MFE/MAE/layers and applies only bounded score adjustments after a minimum sample; before then it is observation-only;
- remote arm/disarm and account binding.

## Strategy state machine

`IDLE -> IMPULSE/SWEEP WATCH -> REJECTION + BOS CONFIRM -> PROBE -> PROFIT-SIDE PYRAMID -> EQUITY TARGET CLOSE`

The implementation does not assume that every large move must reverse. It requires a prior extreme/liquidity violation and then evidence that continuation failed.

## Lot semantics

Without a stop loss, “15% risk” cannot be converted into classical risk-to-stop lot sizing. Apex therefore interprets it as **15% of currently available free-margin capacity** for the first layer. The next confirmed layer requests 2x that percentage of the then-current free margin, etc. `maxLayers=0` means no software layer cap; the broker, available margin, and equity target become the practical limits.

## Learning brain

The EA sends the real feature vector at campaign start — impulse magnitude, wick rejection ratio, M3/M5 confirmation, ATR — not just the final score. The backend joins that to each campaign's outcome by `campaignId` and reports genuine, sample-gated win rates per feature bucket (impulse-strength tercile, wick-ratio tercile, M3/M5 present or not) via `featureInsights` in `/api/admin/status` — a bucket only reports a real number once it has at least 5 completed campaigns, otherwise it's marked `insufficient_sample`, so early data can't produce a falsely confident read. This is what actually answers "why did this setup work vs. a visually similar one fail," rather than one blind aggregate.

Separately, the existing bounded score-adjustment mechanism is unchanged: before `learningMinCampaigns`, learning is observation-only. After that it can nudge entry/add score thresholds within `learningMaxScoreAdjustment`; it never changes direction, lot multiplier, target, or creates trades by itself.

This is intentionally bounded because social-media videos — including the ones this strategy was built from — cannot establish a guaranteed edge or reveal every losing attempt. See `docs/STRATEGY_SPEC.md` for the full forensic audit and evidence this build is based on, including a losing campaign, not just wins.

## Run

Node 22+:

```bash
cp .env.example .env
ADMIN_TOKEN=... EA_TOKEN=... node server.mjs
```

Set MT5 WebRequest whitelist to the deployed Apex URL. Compile `ea/XauCloud-Apex.mq5` in MetaEditor and require zero errors before attaching it.
