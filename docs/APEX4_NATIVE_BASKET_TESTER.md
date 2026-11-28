# Native Apex basket candidate — verification and deployment boundary

The generator derives from the exact XauCloud v6.29.1 native source and lease dependencies pinned by the existing M10 observer. The original trade/network paths are fenced. One new basket executor manages native continuation/countertrend recognition, historical canonical Outlook replay, and explicitly authorized USD hedging demo operation. The stable release and existing classroom artifacts remain unchanged.

## Requested policy

- Initial equity determines the per-position tier: 20→.01, 50→.02, 100→.05, 200→.10, 500→.20, 1000→.50 lots; no position below $20.
- Original native executable quote or canonical Outlook entry anchors the $5 price-move basket target. No individual SL, no variable TP2, no arbitrary holding deadline or software basket risk/layer cap.
- Broker margin determines capacity; orders are attempted at 250 ms tick-time intervals when possible. Actual fills and stop-out depend on broker settings. No guarantee of four fills/second.
- One basket at a time. Active baskets continue locally; target closure requires a running terminal. Broker liquidation can consume the deposit. No real-account execution is supported by this candidate.
- Native direction and setup classification reuse XauCloud; closed M1/M5 classroom depth and recovery observations reject broken or late continuation patterns. This is a feature integration, not a newly validated predictive model. The historical classroom outcomes used a different exit policy and cannot establish basket profitability.

## Compile on a Mac

From a clean Apex checkout, use a local XauAI-Sniper checkout at `fc91b97e2ee88eae6b9d4e24c6d74ef522c1ec4c` (the generator verifies exact source and dependency hashes).

```bash
XAU_SOURCE="$HOME/XauAI-Sniper/backend/ea_code"
OUT="$(mktemp -d)"
node scripts/build-apex4-native-basket.mjs "$XAU_SOURCE" "$OUT"
APEX_COMPILE_SOURCE="$OUT/XauCloud-Apex-v4-NativeBasket-TESTER.mq5" bash scripts/compile-apex4-mac.sh
```

Use a USD hedging XAUUSD real-tick tester. Default native pullback mode needs no network or Outlook file. For historical Outlook, export independently verified canonical records with their original stored STRONG grade, identity, publication and expiry (not a retrospective reconstruction). Run:

```bash
node scripts/export-apex4-strong-outlook.mjs canonical-records.json Apex4StrongOutlook.csv
node scripts/build-apex4-native-basket.mjs "$XAU_SOURCE" "$OUT" --outlook-replay
```

Copy the exported CSV into the terminal's MQL5/Files before testing; select replay mode and set the historical broker UTC offset correctly. Split runs across broker DST changes. No canonical historical export is supplied here; source data must come from authorized records. The default 08:00–10:00 WAT window means hours 8 and 9, configurable on export and server. It is the owner-requested window, not a guarantee of profitability.

## Isolated demo/backend

The Apex server feature flag `APEX4_NATIVE_BASKET=1` selects the new candidate dashboard and authenticated native Outlook endpoint. `APEX4_NATIVE_OUTLOOK_WAT_HOURS=8,9` sets the window. The separate XauCloud bridge change must be deployed before canonical Outlook can be returned. The route never creates a replacement signal or grade. The demo candidate needs explicit terminal enablement, bound Apex license and successful initial backend arming; local native recognition can continue on loss of connectivity during that authorized demo session. Remote revocation cannot be received offline. Native basket status is reported separately from the old fixed-SL simulation. Recovery restores the saved basket for closing, not new adds, when ownership is verified. No live-money feature or customer download is changed.

## Verification and outstanding work

The connector-based checks exercised the exact pinned source transformation and isolated JS contract assertions. They do not compile MQL or execute MT5 broker orders. Full repository CI, MetaEditor compile, real-tick native basket run (including margin stress, restart, broker stop-out), demo request and execution tests, actual production records and deployment verification are mandatory before release. Full historical classroom model recalibration for the new execution policy and native deal-level continuous-learning ingestion are not demonstrated by these changes. Do not present old equal-risk P&L as new basket results.
