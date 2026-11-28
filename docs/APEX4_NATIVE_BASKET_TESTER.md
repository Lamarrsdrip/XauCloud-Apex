# Native Apex basket candidate — audit and tester guide

Source lineage: exact XauCloud EA v6.29.1 commit `fc91b97e2ee88eae6b9d4e24c6d74ef522c1ec4c`, SHA-256-pinned source and lease dependencies. XauCloud's original trade and network sends remain intercepted. The original native direction and classification are reused; Apex owns the new basket executor. No modifications to XauCloud main are required.

## Execution contract

- Preferred lot per basket is frozen at initial USD equity: $20 .01, $50 .02, $100 .05, $200 .10, $500 .20, $1000 .50.
- The preferred lot is a ceiling, not a minimum. Try every broker-valid volume increment from that ceiling down to the symbol minimum. OrderCheck success is retcode 0 (or DONE), with sufficient projected free margin. Actual orders use the selected smaller lot. Recheck after each fill, broker rejection or new tick; floating profit may create more capacity.
- 100 ms target pacing. Demo timer and tick path share the same pacing state; tester uses historical tick timestamps. Synchronous fills, market ticks, terminal event queues and broker responses limit actual speed. Do not claim ten fills per second.
- Fixed $5/oz move from original executable entry or independent Outlook entry; all owned positions close together at executable bid/ask crossing. No individual SL, no variable targets, no timed exit or software layer cap. Broker stop-out is still possible.
- One basket at a time. No real account execution. Demo is opt-in and must initially receive a valid bound-license arm. Existing basket management remains local; an offline terminal cannot receive remote revocation. Restart recovery refuses unknown positions and avoids uncertain extra entries.

## Intelligence

The native EA uses XauCloud's existing M10 direction, candidate/retrace thesis, and original setup classifier. The classroom adapter uses the published closed M1/M5/M15 features: EMA/swing trend, 14-period true range, impulse and retracement depth, price recovery, liquidity sweep, rejection, pressure, acceleration and structural reclaim. It identifies developing, late, broken and actionable recovery stages. The original classroom's fixed-SL/TP2 outcomes and zero approved groups are not a fitted edge for this new basket. No outcome labels enter live features.

Apex's backend independently applies the existing vendored XauCloud hourly bias, publication geometry, owner policy and historical quality rules to native evidence and closed history from the Apex terminal. The explicit owner-selected WAT window is 08:00–10:00 (hours 8 and 9); the earlier study is not a profitability guarantee. There is no XauCloud signal bridge dependency. The checked-in historical knowledge contains zero calibrated STRONG rules, so the independent Outlook cannot produce a genuine STRONG signal until a valid chronological knowledge file is supplied. Native pullback testing is unaffected.

## Compile for native pullbacks on Mac

```bash
bash scripts/build-apex4-native-pullback-mac.sh
```

The script uses the exact pinned XauCloud source bytes from a local checkout (or fetches them with GitHub access), verifies hashes, generates the native derivative and compiles using the existing Mac MetaEditor script. It saves a dependency-checksummed EX5 and log to Downloads only after a clean 0 errors, 0 warnings result. A failure is reported, not hidden.

Copy the EX5 to MQL5/Experts, refresh MT5, select it in Strategy Tester, use XAUUSD/XAUUSDm, M1, Every tick based on real ticks, USD hedging, $100 starting deposit and the broker leverage you want to test. Set InpApexNativePullbackEnabled=true, InpApexReplayStrongOutlook=false, InpApexOrderGapMilliseconds=100. No license, API or backend needed in tester. First test a short interval, then an independent period. Inspect actual deals, drawdown, stop-out, margin, elapsed first-to-last fill and position sizes, not the old single-position R report.

Optional offline Outlook replay is separate: export verified original timestamped canonical STRONG records using scripts/export-apex4-strong-outlook.mjs; generate with --outlook-replay; supply the CSV and historical broker UTC offset. No verified historical grade export is bundled.

## Backend and web

APEX4_NATIVE_BASKET=1 selects the candidate mode; APEX4_NATIVE_OUTLOOK_WAT_HOURS=8,9 specifies the window. APEX4_KNOWLEDGE_FILE must reference a valid independent chronological calibration. Demo uses the existing bound Apex license, terminal native evidence, and local dashboard controls. The old candidate execution route and legacy settings are not the new basket authority. Stable version.json and published EX5 are unchanged.

## Audit results and open verification

The 6 isolated JS contract tests (44 assertions) and 17 structural checks of the complete pinned source transformation passed. These are not a MetaEditor compilation, actual broker simulation, full CI, or end-to-end production deployment. The candidate has not yet been run in MT5 here. Native per-deal history and a fitted classroom model for this new margin-exhaustion policy are not demonstrated. No live-money release is authorized by this source merge. Use actual real-tick tester and demo receipts to verify the behavior.
