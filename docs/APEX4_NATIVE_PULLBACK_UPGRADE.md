# Apex native pullback 4.110 — audit and challenger

## Baseline under test
The user's tester export identified XauCloud-Apex-v4-NativeBasket-TESTER-86124e093b1d, Exness XAUUSDm, M1. The prior 4.100 source reused the original XauCloud classifier but allowed candidate/retrace signals on the preferred M10 direction only; it did not use the classifier's immediateConfirm result. It reused classroom recognition features, not a fitted profitable full-margin strategy. Native chart diagnostics and inherited tester inputs were misleadingly branded as XauCloud.

## Challenger changes
- Same 100 ms execution pacing, equity-tier preferred volume with broker-checked fallback, fixed $5 basket exit, no individual SL, no arbitrary holding deadline. No real-account execution in this candidate.
- Compare BUY and SELL on the same closed M1/M5/M15/H1 evidence. Use the XauCloud native classifier, pressure, momentum, acceleration, EMA trend, RSI/divergence, sweep, rejection, structure and classroom impulse/depth/recovery. Reject late/failed structures, contradictory pressure and insufficient target room. Strong native countertrend requires the original immediate-confirmation condition (5 of 6 plus reclaim); four of six does not suffice. Weights and score floor are challenger hypotheses, not calibrated probabilities.
- Do not recycle broker stop-out margin into additional positions in the same failed basket. Manage remaining owned positions to their existing target. Record entry decisions and native deal details in the MT5 journal.
- Three strategies: PULLBACK, OUTLOOK, BOTH. Tester mode is selected locally (default PULLBACK); Outlook replay requires verified CSV. Demo selects mode through the authenticated per-license backend, and reports the actual applied mode. Switching sources does not close an existing basket. Previous native wire clients are disarmed rather than pretending they support source switching.
- Native dashboard is the production default unless explicitly disabled by APEX4_NATIVE_BASKET=0. Native UI hides legacy strategy configuration and exposes independent strategy selection and advisory AI chat. Older published EX5 and manifest are not replaced.
- AI chat uses native diagnostics and fresh quotes when available, the XauCloud-derived research context and the actual basket policy. AI has no execution authority; its scores/analysis do not authorize orders.
- Independent Outlook still requires genuine historical STRONG calibration. The checked-in artifact has zero qualified grade rules. Do not substitute a manufactured grade. The prior classroom had zero forward-qualified pullback groups.
- Mac compile command saves the generated MQ5 and all includes in Downloads in addition to EX5/log. Generated original trade/network sends remain fenced; chart shows Apex status.

## Reproduce
Run `bash scripts/build-apex4-native-pullback-mac.sh` in this checkout. Use the new EX5 in MT5 Strategy Tester; set InpApexStrategy=APEX_PULLBACK_ONLY, real ticks, USD hedging, same deposit and leverage as baseline. Compare identical September and November ranges, then independent dates. Inspect first-fill/last-fill time, basket-level returns, liquidation count, adverse movement before target, and both directional diagnostics. Do not infer profitability from the old fixed-SL classroom results.

## Verification boundary
The 8 isolated contract tests (59 assertions) and 18 structural source checks passed. HTTP mode integration tests are included. These are not MetaEditor compilation or actual real-tick basket results; those must be rerun for 4.110. The production website configuration changes are source changes, not proof of live deployment. Actual model key connections and actual independently calibrated Outlook grades are not verified.
