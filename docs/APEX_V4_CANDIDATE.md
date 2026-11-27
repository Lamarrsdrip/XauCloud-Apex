# Apex 4 independent Outlook and pullback — DEMO candidate

This supersedes the earlier direct XauCloud published-signal transport. Do NOT merge XauAI-Sniper PR #128 as a dependency. The candidate runs on the Apex backend, using the attached MT5 account's M1 bars and executable bid/ask. The old EA, stable release manifest and dashboard layout are unchanged. This is a source candidate, not a verified production release.

## What was copied
Pinned XauCloud commit 9e5f137753a9687670ed2105311f72b30891e29e. See intelligence/xaucloud/provenance.json for the exact source blobs and extraction boundaries. The deterministic opportunity engine, feature extraction, current quote checks, Outlook core/owner policy/confidence/zone and hourly bias resolver, case education, opinion replay and grading are local. No model or remote published signal needed for these functions.

**Parity blocker:** original XauCloud EA M10/market-thesis producer source was not available through the accessible repository. The exact backend bias resolver can run from real canonical evidence; the local OHLC pressure-derived outlook is explicitly research-only, never labeled the original generator. The copied subset also does not reproduce all DB-dependent production filters and lifecycle. Do not claim 100% parity. Obtain the original MQL source and its build provenance from the existing Mac/VPS, port its evidence producer, then verify identical input/output fixtures and outcomes. The local adapter below is not a substitute for that source.

**Historical-data blocker:** Atlas MCP access was disabled. No actual production case export or pullback training result was obtained here. The source includes historical negative results for basic exhaustion reversals and countertrend corrections; preserve these lessons. The candidate must not invent successful pullback groups or hours.

## Run the local historical pipeline (Node 22)
From this Apex worktree:
```sh
node scripts/export-xaucloud-v4-knowledge.mjs /absolute/path/to/XauAI-Sniper/backend_node "$HOME/apex4-history-private" 2021-11-01 2026-11-27
node --experimental-strip-types scripts/train-apex4-knowledge.mjs "$HOME/apex4-history-private" "$HOME/apex4-knowledge.json" 0.30 0.10
node --experimental-strip-types --test intelligence/tests/*.test.ts
npm ci && npm test
```
First command requires the existing XauCloud compiled backend, existing authorized DB environment and archive files. Read-only; no secrets or raw keys are exported. Use a NEW private export directory, never commit it. Verify actual date coverage; the end date is exclusive. The second command uses XauCloud's saved education cases and Exness MID M1 archive converted to synthetic BID under explicit fixed spread and slippage; no actual commission or sub-second path. Distinct chronological splits for Outlook and pullbacks; outcome windows purged at train and validation boundaries, final holdout not used to pick groups. Report real sample counts, TP2, adverse movement and expectancy, including zero qualifying groups. No proven profitable setup inferred from a successful compile.

## Independent staging server
Use a separate test instance with an existing authorized demo license bound to its account, existing secure test configuration, isolated persistent data directory and Node 22. Do not set this flag on production or use a real-money account.
```sh
APEX4_CANDIDATE=1 APEX4_KNOWLEDGE_FILE="$HOME/apex4-knowledge.json" NODE_OPTIONS=--experimental-strip-types node server.mjs
```
The new POST /api/apex/v4/market route validates local license binding and armed state, accepts broker data, and returns the compact APEX4 wire (id, side, entry, SL, TP1, TP2, published/expiry epoch, kind). Existing stable mode unchanged when flag absent. Candidate-mode legacy paid order decisions and model lab predictions are disabled; manual chat uses local evidence and knowledge and is read-only. Connection tests may still consume tokens when explicitly requested. No automatic LLM costs from the new engine.

For canonical Outlook parity, integrate original local M10 producer and set APEX4_LOCAL_EVIDENCE_DIR and APEX4_CANONICAL_SOURCE_COMMIT. This operator-owned directory must be private and writable only by the trusted local producer. File name is SHA256(license + "|" + account) + ".json"; never log license keys. Schema XAUCLOUD_CANONICAL_M10_EVIDENCE_V1, account, symbol XAUUSD, exact sourceCommit, canonicalM10, thesis, htfComplete, observedAt (epoch ms), quote {bid,ask,atMs}, optional brainRecommendation. Freshness and same-broker quote checks required. Use the actual original producer; never manufacture this object or use published Outlook as a proxy. No canonical file means no executable Outlook; local research output remains available in chat. A qualified Outlook uses actual STRONG grade and empirically selected hour. 08/09/10 WAT are owner candidate hours, not asserted measured winners.

## EA
Compile ea/XauCloud-Apex-v4.0.0-DEMO-Candidate.mq5 in MetaEditor. Do not replace installed stable EA. Attach to XAUUSD M1 on authorized USD hedging DEMO only. EnableDemoExecution requires explicit opt-in. Set ApexBackendURL to the verified HTTPS staging endpoint and allow that host in MT5 WebRequest. Never send a license to an unknown endpoint. Source is not compiled here.

Equity clip frozen at basket start: $20=.01, $50=.02, $100=.05, $200=.10, proposed $500=.20, $1000+=.50. Below $20 no entry. Normal and unlimited demo accounts use broker-reported margin, volume step/min/max and actual acknowledgements. Default 250ms local pacing, no request per order, synchronous broker confirmation may take longer. Optional DemoMarginStress mode allows adding before profit and resuming when free margin recovers, including after TP1 but not past TP2. MaximumDemoLayers=0 removes the software layer count cap in demo; risk-bounded default mode remains. Equity/spread cushion, valid broker geometry, current authorization and ownership checks remain. Common broker SL/TP2 for all positions, no additions after invalidation, expiry or TP2, time exit 60 min Outlook/20 min pullback. Full-margin accumulation can liquidate even a directionally correct basket. Do not enable it on live accounts. Restart preserves broker SL/TP; full automatic campaign reconstruction and cross-terminal claims not implemented. No sub-second latency guarantee.

## Release gates
Full CI + MetaEditor compile 0/0 + actual broker demo with normal/unlimited leverage, rejected and delayed/partial fills, margin recovery, restart, market close, TP2 basket and disarm. Compare actual original Outlook outputs on identical broker evidence and validate best WAT windows. Train and test on real historical data, compare with existing Apex including costs, adverse excursion, drawdown and liquidation risk. Extend durable per-account market/decision/outcome telemetry and continuous retraining before production. Runtime currently caches live bars in memory and reads offline knowledge snapshots; no continuous persisted training cycle yet. No production deployment, release binary or profit claim.
