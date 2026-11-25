# XauCloud Apex "Final Boss" — continuation handover (addressed to the next AI)

You are continuing a large, in-progress engineering task on **XauCloud Apex** for its owner. Read this whole file before
touching anything. It is the single source of truth for what was asked, what is done, what is verified, and what is left.
Do not re-do completed work; do not quietly drop any requirement. Last updated: 2026-11-25 (by Claude Opus 5.5).

---------------------------------------------------------------------------------------------------------------
## 0. Where the work lives

- Repository: `https://github.com/Lamarrsdrip/XauCloud-Apex` (private). Default branch `main`.
- **Working branch: `feat/apex-final-boss-2026-11-25`** (created from `origin/main` @ `5fea1cb`, i.e. after PRs #8–#11).
  First WIP commit: `d54136e`. Continue on this branch. **Nothing from this effort is merged or deployed yet.**
- Production: `https://apex.xaucloud.io` — Hostinger hPanel Node app that **auto-deploys from GitHub `main` within ~1 min**
  (verify with `GET /health` → `version`/`buildId`). So: merging to `main` == deploying. Only merge verified work.
- Runtime: Node ≥20, ESM, single dependency `web-push`. `npm test` = `node --test tests/*.test.mjs`
  (baseline before this work: 237/237 passing; after: all passing incl. new `tests/apex_brain.test.mjs`).
  Browser test: `node tests/browser-apex-ui.mjs` (Playwright, used by CI `.github/workflows/apex-release-ci.yml`).
- Persistent data in prod: `DATA_DIR=/var/lib/xaucloud-apex` (licenses, vault, usage, learning ledger, chats).
- MT5 / EA compile: Windows VPS `173.212.249.202`, `ssh -i ~/.ssh/xau_vps administrator@173.212.249.202`.
  Apex terminal is a SEPARATE portable install `C:\MetaTrader 5 Apex` (never touch `C:\Program Files\MetaTrader 5`, the live XauCloud bot).
  Headless compile: `Start-Process "C:\MetaTrader 5 Apex\metaeditor64.exe" -ArgumentList '/compile:"<src>.mq5"','/log:"<log>"','/inc:"C:\MetaTrader 5 Apex\MQL5"','/portable' -Wait -WindowStyle Hidden`
  in a scratch folder like `C:\apex_build\` (log is UTF-16LE; exit code 1 even on success — judge by `0 errors` line). Drive PowerShell
  over SSH with `powershell -NoProfile -EncodedCommand <base64 UTF-16LE>`. Never compile onto an attached EA filename.
- Video sources (owner's nine reference clips, in `~/Downloads/`): see `data/brain/reference-episodes.json` (file names + SHA-256).

---------------------------------------------------------------------------------------------------------------
## 1. The owner's objective (verbatim scope, condensed — ALL items remain required)

Build a genuinely intelligent, specialised gold system around the nine reference trading videos, not "a bot with an AI attached":
1. Study all nine videos thoroughly (charts, narration, entries, adds, exits); timestamped annotation separating observed /
   trader-explained / inferred / unknowable. Don't invent conditions.
2. Full first-party audit of the whole project (EA, detection, entries, intrabar, campaign/position mgmt, Astra bridge, AI providers,
   contracts, context, retrieval, research, learning, backend, dashboard, chat, API auth, licenses, account isolation, deploy, compiled EA),
   esp. PRs #8–#11 (did they improve recognition or just add text?). Produce an audit ledger (finding, severity, change, evidence).
3. Permanent structured "Apex Brain" (taxonomy, approach/rejection/failed acceptance/failed recovery/transitions, early vs late entries,
   continuation, false confirmations, positive AND negative examples, campaign lifecycle, contradictions), knowable-before vs after,
   model-independent retrieval.
4. Use XauCloud's real historical gold data (verify coverage); blind replay: show prefix → model predicts → reveal → score → store lesson;
   chronological train/validation/held-out; measure whether knowledge improves recognition on unseen charts. No "fine-tuning" claims.
5. Improve the actual detection engine (too late? closed-bar reliance? intrabar? rigid confirmation? continuation vs reversal? quality?
   context? AI asked too late?). Shadow/research environment before live changes; validate on historical sequences.
6. AI as an independent gold specialist with rich evidence (structure, quotes, ticks, forming/closed candles, history, Brain, similar setups,
   past decisions, outcomes, missed opportunities, entry quality, news/cross-market where useful). Must not parrot the native bot.
7. Multi-model, user-owned keys: OpenAI + Anthropic incl. Astra, Sol, Opus; verify exact IDs from official docs; encrypted keys; provider &
   model & effort selection; connection/text/vision/structured tests; latency; provider error handling; usage visibility; every model gets
   the same Brain automatically; don't expose provider names in main chat; verify real provider responses (not only mocks).
8. Remove unnecessary intelligence limits (6 s timeout, 8 s TTL, daily cap, snapshot frequency, reasoning budget, context size, retrieval
   limits, tools, scheduling) while keeping execution integrity (broker rules, explicit authorization, duplicate prevention, isolation,
   stale-decision protection). Owner-configurable research usage; separate deep research from time-critical execution.
9. Premium AI chat (bubbles, markdown, chart upload + preview, persistent history, new conversation, streaming, copy/regenerate, progress,
   scrolling, modern composer, mobile/desktop). Recognise setup families from uploaded charts; concise verdict-first answers; greetings normal;
   chat isolated from orders.
10. Full dashboard redesign: professional gold command centre (market structure, latest chart, developing setups & progression, latest AI
    decision + evidence, campaign & ownership, positions, weighted entry, account, history, AI connection, data freshness, native vs AI
    performance), dedicated "Apex Intelligence" workspace, real telemetry only, reliable mobile nav; redesign account/settings/history/
    campaign/learning/AI sections. Compact, distinctive (study TradingView/Linear/Vercel), not big cards/whitespace.
11. Strategy Research Lab: replay with hidden future; record detection accuracy, direction, timing, missed setups, false positives, MFE/MAE,
    entry-to-target, post-cost performance, campaign outcomes, calibration, latency; compare Native vs Astra vs Sol vs Opus vs others on
    identical timestamped evidence; don't overfit to the nine videos.
12. Continuous learning: store predictions before outcomes, never hide failures, retrieve lessons, versioned knowledge, no auto-promotion.
13. Verify the actual latest compiled MT5 EA (version, build identity, source↔binary, API compat, snapshot accuracy, config sync, decision
    handling, campaign ownership, acks, reconnect/restart, dashboard sync). If EA changes: MetaEditor compile + real-tick Strategy Tester +
    controlled demo validation. Never ship an unverified binary as production.
14. Mandatory browser testing (desktop + mobile, before/after screenshots): AI tab, uploads, conversations, API credentials, providers,
    settings sync, campaign data, navigation, no broken layouts, no fabricated market data. Use prod where authorised; never open live trades to test.
15. Merge verified improvements to main, deploy website/backend, provide verified EA release where appropriate. Final report: changes,
    screenshots, tests, historical evaluation, provider verification, weaknesses, unknowns. No claims of trader equivalence/profitability.
16. (Added mid-session) Maintain this continuation handover continuously; preserve work on a GitHub branch so another AI can continue;
    never merge unfinished/broken work to main because of limits.

---------------------------------------------------------------------------------------------------------------
## 2. What has been DONE (implemented) — and how far each piece is verified

### 2.1 Video study (DONE, verified by direct viewing + local ASR)
- All 9 clips decoded; frames reviewed (contact sheets every 4 s/6 s/15 s + full-res frames); audio transcribed locally with
  whisper.cpp `small.en` (transcripts were in the session scratchpad; V1 also at `~/apex-astra-reference-2026-10-16/clip8-new/transcript_unverified.txt`).
- Structured annotation: **`data/brain/reference-episodes.json`** (per clip: trader, anchor, timeframe, direction, family, knowable-before
  evidence, trader's own explanation with timestamps, every visible fill, after-entry info, outcome, unknowns, archive replay result) +
  `crossEpisodeFindings`. Video IDs: V1 `…db0l1ivog65prkpe4950 2.MP4` … V9 `v29044…`.
- **Market anchoring (key discovery):** MT5 server time on Exness == UTC. Using the archive: V1 = 2026-10-01 07:12Z, V7 = 2026-09-18 04:12Z,
  V9 = 2026-10-05 11:31Z (on-screen timestamps), V4 = 2026-10-20 15:17Z (unique price-path match). V2/V3/V5/V8 have several candidate
  windows (listed in the JSON); V6 only "Sept 2025 price regime". PR #8's "six clips" hashes do NOT match the owner's files (they were
  re-encoded copies); their observations are retained as legacy only.
- Key findings: two traders (@kvngjames36 = "fair value gap fill"/"trend continuation"; @tradingcartel1 = liquidity zone / rejection /
  break of structure); 8/9 SELL; moves captured 5.5–13 points; all on Exness Unlimited leverage (1 lot on $38) — money results are leverage,
  not evidence of edge; first fills often red; same-price add bursts, adds sometimes above previous fill while basket green; documented
  failure = large late adds at extended lows (V4, V7 10-lot, V9 20-lot); exits = equity target / bulk close.
- **TODO:** a human-readable timestamped annotation doc `docs/astra/REFERENCE_VIDEO_ANNOTATION_2026-11-25.md` generated from the JSON
  (the engine file header already references this path). Not written yet.

### 2.2 Historical archive (DONE, verified)
- XauCloud's archive copied into Apex: `data/gold_history/XAUUSD_M1_YYYY_MM.csv.gz` + `manifest.json` (sha256 per file).
  **60 months, 1,765,848 M1 bars, 2021-11 → 2026-10**, Exness public ticks → UTC minute bars of bid/ask MID, columns
  `epoch_minute,o,h,l,c,spread_avg,ticks`. November 2026 is NOT in it. Same files XauCloud's `goldHistoryArchive.ts` reads.
- Loader `research/archive.mjs` with fixed splits: TRAIN 2021-11..2024-12, VALIDATION 2025, HELD_OUT 2026-01..2026-10.
- No historical tick data / economic calendar is wired into Apex yet (XauCloud has news engines: FMP, BLS, GDELT, CFTC — see XauCloud repo
  `backend_node/src/services`). **TODO** if pursued: intrabar tick replay needs Exness monthly tick files (ticks.ex2archive.com).

### 2.3 Detection engine (DONE v1.0.0 — research/attention layer, NOT execution authority)
- **`astra/pattern-engine.mjs`** `detect({m1, forming, bid, ask})` — causal; M3 rebuilt from M1 incl. forming bar (fires inside forming M3);
  families V_RECOVERY_FAILURE, SPIKE_REJECTION, BREAK_PAUSE_CONTINUATION, RECOVERY_CONTINUATION; BUY via price mirroring;
  stages DEVELOPING/READY; evidence strings; FVG measurement; context (2h drift, range position, hour); one READY per structural leg.
- `research/native-port.mjs` = faithful JS port of the EA's native `Observe()` (v3.8.8 rules) for apples-to-apples comparison.
- `research/outcomes.mjs` spread-aware first-touch (fixed points and ATR pairs 1:1, 2:1, 3:1.5; same-bar ambiguity = loss).
- `research/evaluate.mjs` walk-forward replay per split; `research/hypotheses.mjs` (frozen a-priori H0–H5);
  `research/hypothesis-report.mjs`; `research/feature-study.mjs`; `research/reference-check.mjs`; `research/build-brain-examples.mjs`.
- Frozen-before-held-out hashes: `research/results/FROZEN_BEFORE_HELD_OUT.sha256`. Results JSON in `research/results/`
  (`train_v2.json`, `validation_v2.json`, `held_out_v2.json`, `hypotheses_*.json`). Large `*_signals_*.jsonl` are gitignored — regenerate:
  `node research/evaluate.mjs --split TRAIN --out research/results/train_v2.json --signals research/results/train_signals_v2.jsonl` (seconds–minutes).
- **Measured results (honest):**
  - Reference replay (real archive): engine READY in the trader's direction **before** the trader's fill for V1 (−5 min, 4179.27 vs 4178.35),
    V7 (−27 min, same leg), V9 (−3 min, 4162.94). V4: no same-direction READY (known gap). **Native detector fired in NONE of the 4 windows.**
  - Win rate of +1 M3-ATR before −1 ATR (after spread): Random 0.419/0.466/0.479 (TRAIN/VAL/HELD-OUT); Native 0.369/0.492/0.438;
    Engine all 0.422/0.462/0.471 (~59 signals/day); H5 reference-composite 0.442/0.507/**0.469** (~5/day).
  - Conclusion: shapes are recognised early and reliably, but **mechanically they have no out-of-sample edge**; H5 beat random on TRAIN and
    VALIDATION (~2.8 SE) but not HELD-OUT. Native is worse than random on TRAIN/HELD-OUT. Therefore the engine is used for attention,
    evidence and research — never granted order authority. Whether a reasoning model adds edge on top is exactly what the Lab must measure.
  - Process note: one accidental early HELD_OUT run happened before freezing (only signal counts were seen; output deleted). Disclose this.

### 2.4 Apex Brain (DONE)
- `data/brain/taxonomy.json` (families: story, approach, readiness, early/late, contradictions, false confirmations, invalidation, targets;
  campaign lifecycle & failure modes), `data/brain/base-rates.json` (measured, per split & family), `data/brain/reference-episodes.json`,
  `data/brain/historical-examples.json` (960 TRAIN-only examples, 60 win + 60 loss per family×direction, with 20 pre-entry M3 bars in ATR units).
- `astra/brain.mjs`: `loadBrain`, `similarExamples` (k-NN, balanced wins/losses + neighbourhood win rate), `brainPackage` (identical for all models).
- `astra/brain-instructions.md` (how every model should reason). `astra/retrieval.mjs` `knowledge(context,{lessons,depth})` now returns
  `{instructions, examples, brain}`; instructions = brain-instructions + strategy.md + reference-pattern-guide.md.

### 2.5 Backend AI (DONE in code, unit-tested with mocks; NOT verified against real provider keys)
- `astra/models.mjs` verified catalog (official docs read 2026-11-25): OpenAI `gpt-6.2-astra` (flagship), `gpt-6.2-sol`, `gpt-6.1-terra`,
  `gpt-6-luna`, legacy `gpt-6-astra`; Anthropic `claude-opus-5-5`, `claude-fable-5-2`, `claude-sonnet-5-5`, `claude-haiku-5-5`.
  Effort per model (Sol/Astra reject `none`; all accept `max`); invalid effort → provider default (no 400).
- `astra/contract.mjs`: default model `gpt-6.2-astra`; efforts incl. `max`; daily cap default 2000, max 20000; research settings
  (`researchEnabled`, `researchEffort`, `researchDailyLimit`, `contextDepth`, `executionTimeoutMs` 2000–7500). `KNOWLEDGE_VERSION`
  intentionally unchanged (`tradingcartel-breakfast-v1`) because the deployed EA rejects any other strategyVersion.
- `astra/vault.mjs`: stores research settings; provider default model when key provider changes; masked key per provider; keyAddedAt.
- `astra/providers.mjs`: `callModel` for both providers (fixed URLs, structured output, image, effort, usage, SSE streaming,
  error codes AUTH_ERROR/NO_CREDIT/RATE_LIMITED/MODEL_NOT_AVAILABLE/PROVIDER_REJECTED_REQUEST/PROVIDER_UNAVAILABLE/AI_REFUSAL/AI_INCOMPLETE).
- `astra/context.mjs`: adds `patternEngine` reading + `bridgeVersion` (default 1).
- `astra/service.mjs`: bridge v2 screening (`SCREENED` when flat & no engine candidate — only if snapshot.bridgeVersion≥2), deep async
  **research thesis** (THESIS_SCHEMA, high effort, 180 s, separate daily budget, TTL 10 min, invalid if price drifts >1.5 ATR or setup gone) injected
  into fast execution decisions as `researchThesis`; lessons injected; engine READY + thesis + AI decisions recorded in the learning ledger;
  token usage per day; tests scopes CONNECTION/TEXT/VISION/STRATEGY (vision uses `astra/chart-png.mjs` synthetic chart); `status()` now
  returns `investigation` (engine candidates), `research`, `modelInfo`, tokens; `learningStats()`.
- `astra/learning.mjs` append-only ledger (`DATA_DIR/astra-learning/<sha>.jsonl`): PREDICTION then OUTCOME (±1 ATR first touch / 60 min),
  `lessons`, `stats`, `resolved` (lab). `astra/conversations.mjs` persistent chats (`DATA_DIR/astra-chats`). `astra/chat.mjs` brain-backed
  verdict-first prompt, conversationId, 24-turn history, streaming via `onDelta`, usage.

---------------------------------------------------------------------------------------------------------------
## 3. REMAINING WORK (in recommended order) — none of this is done

1. **Research Lab backend** — file `research/lab.mjs` (was being written when this handover was made). Design:
   `newEpisode(license,{split:'VALIDATION'|'HELD_OUT', mode:'setup'|'random'})` → random minute in split, scan forward until the engine has a
   candidate (setup mode); prefix = 180 closed M1 (+derived M3 + engine reading); future 120 M1 kept server-side. **Blind by default**: hide date,
   re-base prices (offset so models can't recall real 2025/2026 prices). `predict(episodeId,{source:'MODEL'|'ENGINE'|'NATIVE'|'USER'})` sealed
   with timestamp+hash BEFORE reveal (MODEL = `callModel` with brain + prefix + `candlesPng` chart image + LAB schema: direction, family, stage,
   enterNow, entryCondition, invalidationPrice, targetPrice, confidence, reasoning). `reveal` → future bars + scores (1:1 ATR first touch,
   MFE/MAE in ATR, timing) → `learning.resolved` lesson. `benchmark({split,n,includeModel})` async job comparing Native vs Engine vs selected
   model on identical prefixes; per-model comparison requires each model's key (Astra/Sol/Opus). Persist to `DATA_DIR/astra-lab/`.
   Routes under `/api/session/lab/*` (session auth like `/api/session/astra`), throttled.
2. **server.mjs routes**: models list (`ASTRA.models`), conversations list/get/delete/rename, streaming chat (SSE when
   `Accept: text/event-stream`; call `ASTRA.chat(lic, body, {onDelta})`), tests with `scope` text/vision/strategy/connection, learning stats,
   lab endpoints. Raise body size limit for images if needed (check `body()` in server.mjs). Keep CSRF/same-site checks (see existing `/api/session/astra`).
3. **Frontend (public/index.html, public/astra-ui.js, public/premium.css)** — full redesign per §1 items 9–11: Command Centre,
   Apex Intelligence workspace (live `investigation` candidates with evidence & stage, research thesis, latest decision, learning stats),
   premium chat (streaming, markdown, uploads, conversation sidebar, copy/regenerate), Research Lab UI (blind chart, predict, reveal, scores,
   benchmark), AI settings (provider/model/effort/research budget/tests with latency & usage), mobile nav. Take BEFORE screenshots of prod
   first (owner's Chrome may be logged in; never open trades), AFTER screenshots locally + prod.
4. **EA bridge v2** (`ea/AstraBridge.mqh` + version bump in `ea/XauCloud-Apex.mq5`, new versioned copy, version.json): send
   `"bridgeVersion":2`; send 180 M1 bars; when flat request on every new closed M1 bar (not only native AstraAttention); treat
   `status:"SCREENED"` as benign (no AstraFail, no backoff). Keep the 8 s envelope, drift, campaign/layer binding, duplicate-trigger rules.
   Compile on VPS (unique filename in `C:\apex_build\`), run Strategy Tester export mode (`InpAstraExportContexts=true`) as a smoke test,
   then controlled demo. Do NOT publish as stable release until demo-validated. Backend already supports v1 and v2.
5. **Audit ledger doc** `docs/APEX_FINAL_AUDIT_2026-11-25.md` — findings so far (add more as you audit server/dashboard/licensing):
   - HIGH: AI attention gate — when flat the EA only consults the AI when the native impulse+sweep predicate fires, once per closed M1 bar
     (`AstraRequestDue`/`AstraAttention` in AstraBridge.mqh) → the AI can never see continuation / V-recovery setups native misses. Fix = bridge v2 + engine screening.
   - HIGH: native detector has no measurable edge (worse than random on TRAIN/HELD-OUT) and missed all anchored reference entries.
   - MEDIUM: default model `gpt-6-astra` delisted from OpenAI catalog (replaced by `gpt-6.2-astra`); efforts offered `none` (rejected by Sol/Astra) and lacked `max`. Fixed.
   - MEDIUM: PR #8 reference observations came from re-encoded clips (hashes ≠ owner files), visual-only, no audio; PRs #8–#11 added text/
     measurements but no detector change, no historical validation; `reference-pattern-evidence` uses last-12-bar extremes only.
   - MEDIUM: decision requested late in a minute expires at the bar roll (`g_astraRequestClosedBar` check) — by design for safety; document.
   - LOW: README still describes v3.8.8 while version.json says 3.10.0.
   - Chat history capped at 8 turns, no persistence (fixed backend); usage only counted requests (now tokens too).
6. **Docs**: annotation MD (§2.1), research results doc (`docs/astra/HISTORICAL_EVALUATION_2026-11-25.md`), update README/version.json.
7. **Verification & release**: `npm test`, browser test (`tests/browser-apex-ui.mjs` must be updated for the new UI), real provider
   verification (needs the owner's API keys entered in the product — keys are NOT available to the AI; never search the machine for keys),
   PR → owner review → merge → confirm `/health` on prod → prod screenshots.
8. Final report to the owner (changes, screenshots, tests, historical results, provider verification status, weaknesses, unknowns).

---------------------------------------------------------------------------------------------------------------
## 4. Rules & gotchas
- Never claim profitability/edge; quote the measured numbers above.
- Never fabricate live market data in the UI; show "no recent snapshot" when stale.
- Don't touch the live XauCloud MT5 (`C:\Program Files\MetaTrader 5`) or XauCloud repos.
- Owner is OK with you pushing feature branches; merging to `main` deploys production — only verified work.
- Commit messages end with `Co-Authored-By: <model> <noreply@anthropic.com>` style attribution if you are Claude; PR bodies end with the generated-with line.


## 5. GPT continuation — backend milestone (2026-11-25)
Implemented persisted, license-isolated blind replay in `research/lab.mjs`, with server-only future candles, rebased prices, sealed predictions, native/engine/user/model sources and conservative first-touch scoring. Added service model adapter, authenticated lab endpoints, conversation CRUD, model catalog, learning stats, SSE chat and capability test scopes. Added `tests/apex_lab.test.mjs`. This is a code milestone, NOT a verified release. Benchmark jobs, calibration, frontend integration, true provider tests, full EA bridge/compile/demo and original audit/docs remain. Container cannot resolve GitHub; CI must execute tests. No merge or production deployment performed.

GPT UI milestone: existing AI page now has Research Lab controls, a masked chart with reveal boundary, native/engine/model prediction actions, scores, persistent conversation selection/rename/delete, streamed answer display, and copy. Settings expose research controls and expanded reasoning effort. Existing overview, account and campaign redesign remains incomplete; benchmark, independent provider tests, user-entered lab predictions, and full browser validation still outstanding. No release or live orders.

GPT benchmark milestone: persistent per-license asynchronous comparison of native, engine and optionally the configured user model on identical masked windows; coverage, resolved win rates, excursions and model Brier score recorded. Explicit opt-in for paid model calls, no auto-promotion. Removed retrospective clip outcomes and held-out aggregate results from the lab model knowledge payload (the strategy instructions and model training may still contain prior information; not a pristine holdout). Browser test extended to exercise SSE and masked chart predict/reveal. Cross-provider simultaneous comparison still requires a multi-key vault or separate model runs. First CI failed on a new syntax defect and old cache-bust assertion; fixed and next npm test step passed before this additional commit.
