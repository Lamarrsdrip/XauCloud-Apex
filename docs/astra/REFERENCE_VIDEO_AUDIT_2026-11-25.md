# Apex reference evidence and strategy audit — 2026-11-25

Baseline: dfaef2631c27a120d0748f5147e59835c8412a4c. Canonical EA v3.10.0. Visual inspection of six supplied clips at six-second intervals, with selected close-up frames. Audio not transcribed; no reconstructed tick stream, independently verified trading history or representative profitability sample. The new corpus preserves SHA-256 and video time ranges, not the video binaries or trader identity. Observations are not labelled executable entries.

## Observed patterns
M1 bullish recovery after sharp decline; M3 upper failure following fast markup; M3 failed recovery/continuation; clustered same-direction orders across small price moves. No universal entry/add interval established. Edited clip times are not market times. One clip shows sharp recovery after a favorable sell move; no complete record of failures or margins. Prior October 16 real-tick native replay (88 runs, 2 campaigns) showed severe losses/stop-outs under the unlimited ladder. That is evidence of exposure mechanics, not Astra performance. Do not treat displayed floating P&L as realized P&L or a verified edge.

## Code findings
- README describes v3.8.8 although version.json and canonical EA identify v3.10.0.
- AstraBridge.mqh AstraRequestDue: flat-state requests normally require a new closed M1 bar plus AstraAttention. Active campaigns require new closed bar or a 5-second interval plus event/price change. Backend 6-second provider timeout, 8-second envelope and 2-second request suppression. High effort can miss setup timing. Keep time/snapshot validity and broker preflight; research event-driven local detection plus ahead-of-time model thesis in tick replay before changing live authority.
- service.mjs: fixed OpenAI Responses provider; default low effort; daily 500 requests (10–5000); no Anthropic provider or conversational endpoint at baseline. API-key addition does not prove pattern accuracy.
- contract.mjs: eight actions, semantic validation, expiry, campaign/layer binding, positive basket requirement for adds. EA validates live quote and keeps owner, order, margin and protection logic. Do not convert a chat answer into an order.
- retrieval.mjs: original lexical ranking, direction inferred from recent impulse while flat, max 8 old examples. New observational corpus augments it, with both sides represented when flat and contextual ranking, without inserting outcome labels.
- context.mjs: M1/M3/M5, closed bars, forming candle, recent ticks, account/campaign, local extrema, failed acceptance, micro BOS and counterpush. Not actual market-depth or private trader indicator. No long-horizon history or global news tools in this context.
- No verified Astra-vs-native forward performance: MT5 Strategy Tester cannot call WebRequest; existing exported contexts and independent replay needed to assess the model. October test shows native parity, not model superiority.
- Needed: time-aligned annotation from full recordings/audio, negative and missed examples, event-by-event tick replay, actual spread/slippage/commission/margin, basket liquidation/stop-out measurement, staged shadow/demo tests, model benchmark, provider-specific auth and low-latency capability checks, isolated chart chat and market source redundancy. Use explicit current data and record all forecasts/decisions and fills.

## Change scope
Reference observations and retrieval only; no changes to execution authority, sizing, broker safety, model provider, EA or deployment. The new records are unvalidated hypotheses and must not be treated as trading instructions or backtest labels.
