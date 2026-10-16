# Claude continuation prompt: Apex Lifestyle + Astra Brain

You are continuing an in-progress engineering and research task in the XauCloud Apex repository. Read this prompt completely before changing code. The goal is to continue from the current checkout, verify the existing work, and finish the requested task as far as evidence and available infrastructure allow. Do not restart from scratch or assume prior work is correct merely because it exists.

## The goal

The product target is **XauCloud Apex Lifestyle + Astra Brain**. The user considers the aggressive historical Apex Lifestyle behavior the strongest Apex implementation. Preserve that exact strategy and execution behavior as the foundation. Astra is intended to recognize setups and manage strategy decisions using evidence from reference trader @tradingcartel1_; Apex remains the execution layer for MetaTrader, sizing, margin, normalization, fills, persistence, recovery, and broker invariants.

The user wants research before strategy claims or tuning. Study the real original videos and more public X material. Understand context, location, setup formation, first entry, early additions, campaign invalidation, losses, and the difference between a valid decision and a profitable outcome. Then finish the software, test it honestly, and document what is and is not proven. Do not claim 100% knowledge, trader identity equivalence, guaranteed returns, model training, or performance improvements without evidence.

The required architecture is:

- Astra can determine setup/state/action when enabled and available, with strict structured output and strategy/version metadata.
- Apex Lifestyle executes broker mechanics and maintains hard safety/platform rules.
- Astra failures, missing key, disabled state, stale/invalid output, rate limits, timeout, and backend/API errors fall back to native Lifestyle. Campaign ownership must prevent Astra/native direction conflicts. During a live campaign, fallback behavior must be explicit and deterministic.
- Users enter their own OpenAI API key in Apex dashboard/settings. Provide save/remove/masked display and a connection test. The raw key must remain backend-side, encrypted at rest, and never enter MT5, logs, events, frontend responses, or Git. **The user explicitly said: “do not look for key.” Do not inspect machine/environment secrets or seek a developer key.** Use synthetic credentials only in tests.
- Astra should receive useful structured market, structure, account, and campaign context; requests should be event-driven, expire, and be rejected when stale. Use strict schema-constrained output, retrieval/few-shot/negative examples, explicit strategy knowledge version, and real supported configurable OpenAI models/APIs. Do not claim the base model was fine-tuned unless that actually happened.
- Keep the aggressive Lifestyle capacity ladder and winner pyramiding. Adds should be based on market proof while the campaign is behaving as intended, never on adding to rescue a losing trade. Do not replace Lifestyle with a conservative generic indicator strategy.

## Current checkout and state

The intended working checkout is:

`/Users/libertyelectronics/apex-lifestyle-astra-brain`

Current branch observed at handoff: `feat/lifestyle-astra-brain`, based on `origin/main` (`a48fffe5ca0d38f8b10077998ee5197ad8ffa7e7`). The working tree has many intentional uncommitted modifications and new files. **Do not reset, clean, stash, or overwrite them.** First run `git status --short --branch`, inspect the diff, and read this file plus the docs listed below. No commit has been made at handoff. The original checkout `/Users/libertyelectronics/XauCloud-Apex` contains unrelated/user files; work in the named branch checkout.

The previous Codex run reached usage limits while three parallel research/engineering tasks were underway. Their work may have landed in the shared checkout, but do not assume every agent finished its task. Inspect the actual files, test state, and any incomplete TODOs. In particular, reconcile the latest social-video finding below with the written research and structured fixtures.

### Existing work to inspect

The current diff includes, among other things:

- `ea/XauCloud-Apex.mq5`, `ea/AstraBridge.mqh`, and `ea/XauCloud-Apex-v3.10.0-LifestyleAstra.mq5`.
- `astra/` for strategy knowledge, context construction, decision contract, fixtures, retrieval, service, and encrypted key vault.
- `server.mjs`, `runtime-data.mjs`, `public/index.html`, and `public/astra-ui.js` for backend endpoints and dashboard/settings.
- `data/astra/*.jsonl` for evidence-backed setup/add/negative/failure/campaign examples.
- `version.json`, package metadata, tests, and docs.
- `docs/astra/validation/account-capacity-matrix.json` and a native C++ harness under `tests/native/`.

Reported earlier, but independently verify now:

- The backend suite (`tests/astra_backend.test.mjs`) passed once with 17 cases; HTTP tests (`tests/astra_http.test.mjs`) passed once. These are not substitutes for rerunning the full project suite after all changes.
- Full `npm test` previously failed old version assertions; they were edited, but the full suite had not been rerun at handoff.
- MQL5 final compile was still pending after EA edits. Compile the final canonical and versioned EA using MetaEditor where available. Confirm the copies are byte-identical if that is the intended release invariant.
- An isolated MT5 native test run was started but no complete paired report was available at handoff. Do not claim successful tester results without a saved report.
- Do not deploy, publish, or push a live release as part of merely preparing this handoff. The task’s original broad request seeks implementation and deployment, but there is no verified production key/account, no completed verification, and no tested deployment artifact yet. Finish a concrete reviewable candidate and report deployment limitations accurately.

## Lifestyle baseline: preserve and verify

The current audit identifies the most defensible historical source as commit:

`bf970909308db4fc1197b7add9e1215afe9cd068`

Canonical source: `ea/XauCloud-Apex.mq5` at that commit, in the v3.8.8 lineage. Read `docs/astra/LIFESTYLE_BASELINE_AUDIT.md` and verify the Git evidence independently. The current main lineage includes a rejection wick/body floor change; the audit explains differences. The audit is candid that Git alone cannot prove the user’s informal “Lifestyle” name or which version performed best. Do not elevate that caveat into certainty.

The historical sizing behavior described in the audit is material: NORMAL uses executable capacity tiers around 15%, 50%, then 100%; UNLIMITED uses simulated 1:200 capacity for early levels and actual executable Unlimited capacity at L3+ with profit-fed escalation. Preserve existing code and prove parity with source comparisons/tests. v3.8.9 BreakfastTiming and v3.9.0 FailedBreakout were experiments, not a reason to change the baseline. A new 3.10.0 identity was selected to avoid conflicting historical v3.9 identities; verify every metadata/UI/package/file identity agrees.

The existing capacity matrix is a sizing calculation only, not a backtest or performance claim. It indicates that $50 and $100 accounts may not satisfy the preserved 15% minimum-lot budget in some profiles. Do not alter the ladder to force a tiny account to trade or promise a flip. Verify all inputs and limits before reporting its numbers.

## Research files and evidence

Read all current Astra research, not just this summary:

- `docs/astra/LIFESTYLE_BASELINE_AUDIT.md`
- `docs/astra/REFERENCE_TRADER_MASTER_MODEL.md`
- `docs/astra/REFERENCE_TRADER_SETUP.md`
- `docs/astra/REFERENCE_TRADER_ENTRY.md`
- `docs/astra/REFERENCE_TRADER_PYRAMIDING.md`
- `docs/astra/REFERENCE_TRADER_INVALIDATION.md`
- `docs/astra/REFERENCE_TRADER_FAILURES.md`
- `docs/astra/REFERENCE_TRADER_BUY_SIDE.md`
- `docs/astra/REFERENCE_TRADER_PROFIT_FIRST.md`
- `docs/astra/REFERENCE_TRADER_NEW_VIDEO.md`
- `docs/astra/REFERENCE_TRADER_EVIDENCE_INDEX.md`
- `docs/astra/REFERENCE_TRADER_REVIEW_LEDGER.md`
- `docs/astra/SOCIAL_RESEARCH_LOG.md`
- all existing required historical research from the original request, if present: `docs/REFERENCE_TRADER_BREAKFAST_SETUP.md`, `APEX_ASTRA_FULL_AUDIT.md`, `APEX_ASTRA_FINDINGS.json`, `GROK_ENTRY_AUDIT_2026-09-09.md`, `APEX_V384_ENTRY_RETEST.md`, `APEX_V388_UNLIMITED_FROM_L3.md`, `docs/STRATEGY_SPEC.md`, and `docs/audit-evidence/**`.
- all `data/astra/*.jsonl`, `astra/strategy.md`, `astra/fixtures.mjs`, and relevant implementation/tests.

Check which requested historical documents actually exist in this repository; record missing files instead of silently implying they were reviewed. Search the full repository for `reference trader`, `Breakfast Setup`, `tradingcartel1`, `video`, `pyramid`, `sweep`, `rejection`, `failed reclaim`, `BOS`, `microBreak`, `entry`, `add`, `spacing`, `MFE`, `MAE`, `profit first`, `ProfitFed`, `UnlimitedFromL3`, `Lifestyle`, and `Astra`.

### Original user-supplied video files

Review the original media files directly wherever they remain available, not just extracted stills, captions, summaries, or old agent conclusions. The files supplied by the user are:

1. `/Users/libertyelectronics/Downloads/v14044g50000d9t8jt7og65nj7ini22g.MP4`
2. `/Users/libertyelectronics/Downloads/v14044g50000d9ilgnnog65reu4g9v00.MP4`
3. `/Users/libertyelectronics/Downloads/v14044g50000d9hbr7fog65vb1cmn0gg.MP4`
4. `/Users/libertyelectronics/Downloads/v1c044g50000d9uib5vog65j25ihv6hg.MP4`
5. `/Users/libertyelectronics/Downloads/v1c044g50000d9qk0hfog65mfcq2e240.MP4`
6. `/Users/libertyelectronics/Downloads/v1c044g50000d9gkvqvog65jrmel5qjg.MP4`
7. `/Users/libertyelectronics/Downloads/v1c025g50000d9pug3nog65m3hbdv8rg.MP4`
8. `/Users/libertyelectronics/Downloads/v1c044g50000db0l1ivog65prkpe4950.mp4`

The evidence extraction artifacts currently in `docs/astra/evidence/` are review aids; check them against each original. If a source has moved or is unavailable, document that and use available original media copies. For every example, distinguish directly visible facts from inferred interpretation; record source, timestamp, direction, phase, confidence, and invalidation. Deduplicate a repost of the same campaign; do not count it as an independent setup.

### Preliminary findings that must be checked against the originals

These are leads, not ground truth:

- Most reviewed supplied examples appear short-side. BUY-side empirical evidence remains much weaker; preserve “derived symmetry pending equivalent evidence” unless more actual BUY examples establish otherwise.
- At least one successful short campaign starts after price has already displaced materially from a remote high, so “upper wick/sweep of the session high” cannot be a universal entry rule.
- At least one winning campaign begins deeply red and later rebounds; a universal “must show profit quickly / never red” filter would reject it. Model execution quality separately from result and distinguish an initially adverse but eventually successful campaign from an unconfirmed/revenge entry.
- One video shows a seemingly good first sell followed by later adds near a rebound and account collapse. This is evidence to investigate late-add/campaign-management failure, not proof that the initial setup was bad.
- Some adds cluster closely and one or more prices may be slightly worse than the immediately preceding fill. The decision may reflect campaign/state/proof and timing rather than “every add must be at a fresh lower price.” Confirm from actual chronology and market bars; do not infer too much from screenshots.
- Clip 8 (`v1c044g50000db0l1ivog65prkpe4950.mp4`) was reported as a descending M3 campaign, first SELL around 4178.353 at about video 58 seconds, followed by early adds and then larger exposure. The visible screen later showed balance/equity about $50,730.18 versus a displayed initial $50.98, but this is a claimed/displayed outcome, not independently verified broker history. Inspect exact add times/prices, floating drawdown, and closure sequence from the original.

### X and TikTok research

The user specifically said X is available and asked for more research there; TikTok may be blocked. Research the public profile deeply where accessible, including historical media, and cite direct post URLs. Search Breakfast Setup, breakfast, XAUUSD, gold, flip, entry/confirmation, liquidity/rejection/displacement, positions/adds, losses, and account challenges. Record posts actually studied with what they added and what remains unavailable. Do not imply that search results equal complete account history. Do not bypass login or use private credentials.

Useful X leads already found (verify independently; one repost may duplicate a user video):

- https://x.com/tradingcartel1_/status/2100656662075859305 — reported Sep 17 public campaign; first sell after a recovery under a prior high rather than a clean remote-high wick; initial drawdown, then favorable movement and clustered adds.
- https://x.com/tradingcartel1_/status/2107356317455118677 — reported Oct 6 campaign with M3 drop and recovery; several adds at clustered prices, including a small adverse-price increment; displayed return is not independently verified.
- https://x.com/tradingcartel1_/status/2107124791513624926 — reported Oct 5, likely duplicate/continuation of the supplied ~545-second clip 8; avoid double counting.
- https://x.com/tradingcartel1_/status/2103897023774667012 — reported Sep 26 retrospective loss explanation; compare against any mirrored TikTok to avoid treating the same narration as independent evidence.
- Review the public account itself: https://x.com/tradingcartel1_?s=11

Important later TikTok discovery from a public video mirror/search lead, which may not yet be reflected in the existing files: https://www.tiktok.com/@tradewithcartel/video/7697180689812163860 (reported Oct 16, ~321.8 seconds). Initial research notes incorrectly labeled its shortlink as a losing setup; the retrieved actual video was reported to be a **winner** that initially showed deep adverse floating P/L on a very small account, recovered, then added at several clustered prices. Review the exact public video/source and correct the evidence index/data if confirmed. Search the account @tradingcartel1 and related public @tradewithcartel posts, but explain account-handle differences and do not assume they are identical without evidence. TikTok restriction or link mismatch must be documented.

The social researcher’s task was interrupted by the prior run’s usage cap. Therefore the written X/TikTok investigation may be incomplete. Continue this work and never claim “research saturation” until independent review passes produce no materially new setup, entry, add, invalidation, or failure rule. Describe actual coverage, not an invented number of reviews.

## Engineering principles and unfinished proof

Audit the code paths yourself. Core invariants:

1. No request per tick; meaningful event triggers only, request pacing, unique snapshot ID, decision expiry and maximum age.
2. Structured schema validation only. Casual model prose must never be translated into an executable order.
3. Entry/add/hold/stop-add/reduce/exit/invalidation actions have clear state and campaign ownership semantics.
4. An Astra add requires positive/proving campaign evidence and continuing thesis, never a losing basket rescue. Do not introduce martingale behavior.
5. Native fallback preserves Lifestyle logic. Failure mid-campaign must not spawn an opposite direction or hand campaign between owners unpredictably. Restart/reconciliation must preserve deterministic ownership.
6. MQL calculates symbol/broker volume, margin, normalization, orders, fills, and platform invariants. The LLM never calculates exact broker execution mechanics.
7. Only backend contacts OpenAI. Do not expose raw keys to EA or client. Verify encryption, permissions, rotation/loss behavior, masking, errors, deletion, logs, telemetry, and event payloads.
8. User-facing “Test connection” should distinguish a successful API connection from the synthetic strategy checks. Synthetic checks validate prompts/schema/action interpretation; they do not prove the model trades like the trader or that the strategy is profitable. API tests can incur user API costs and must be clearly represented.
9. Show model, latency, last decision, state, campaign owner, strategy knowledge version, and fallback reason without leaking secrets.
10. Model choice is configurable and based on currently supported APIs. Verify current official OpenAI documentation before modifying API/model assumptions. Do not hardcode a model that may not exist. Never use a deprecated endpoint.

Potential issues noted before handoff that require inspection:

- An EA code review found `ASTRA_ENTRY` could be emitted on a pending rather than confirmed fill. Verify event semantics and fix so telemetry distinguishes request/intent from executed order.
- The `REDUCE` path reportedly closes the newest non-master position and may mark the request applied before close confirmation. Reconcile only after confirmed execution; handle partial/rejected closes correctly.
- Confirm native and Astra lifecycle behavior across fallback and restart, all account profiles, and asynchronous/stale decisions.
- A context field named `meaningfulHigh/Low` represents locally computed rolling/confirmed extrema, not a proven trader-defined level. Preserve that label caveat in schema/docs.
- Existing `MFE/MAE` in currency must not be described as Gold-distance excursions; name or separately calculate each unit.
- MQL5 `WebRequest` is synchronous and unavailable in Strategy Tester. Do not claim the AI can be called on every tester tick or report an AI historical backtest unless you build a proper reproducible replay method. A fixture/replay pipeline or exported market contexts plus preregistered offline decisions can test behavior, but is not equivalent to a live API backtest.
- The tester-only context export option must not include any key or license secret. If simulated server time differs from UTC, label the time basis.
- Unlimited-account testing must exercise the actual Unlimited capacity branch; 1:200/1:500 leverage alone does not automatically test an Unlimited profile.

## Continue in this order

1. Inspect repo instructions (`AGENTS.md` and nested instructions), Git status/diff, branch, version metadata, existing docs, and every relevant implementation file. Preserve the working tree.
2. Check all eight original videos and independently extend X/TikTok review. Update evidence index, review ledger, structured JSONL records, negative examples, campaign sequences, and strategy model with corrections. Separate facts, inference, and unknowns. Add explicit coverage gaps and avoid unsupported numeric constants.
3. Verify the Lifestyle source commit and compare baseline code to candidate. Demonstrate native strategy/sizing/exits still match the selected baseline except for intentional intelligence integration and metadata. Keep all existing product features intact.
4. Complete a focused code audit of Astra schema, context, retrieval, prompts, async service, encrypted user-key storage, dashboard, API endpoints, backend authorization/identity isolation, EA polling/execution/fallback, campaign ownership, state recovery, telemetry, and profile sizing. Fix real defects; do not just document them.
5. Finish meaningful deterministic fixtures for at least: good sell, too early, too late, reclaim, early winner add, another small proof, losing basket/no add, revenge/no setup, valid setup later fails, no key/API failure fallback, stale decision, malformed schema, owner conflict/restart. Exercise both expected Astra decisions and hard EA invariants.
6. Run the full appropriate automated suite after changes, including `npm test`, syntax/type checks, security tests, and MQL compile. Run tests requested in the original task. Do not use generated mocks to claim external API success.
7. Run safe, isolated MT5 native tester/replay runs only where possible, across varied/out-of-sample dates and $50/$100/$1,000 at 1:200, 1:500, and actual Unlimited profile. Compare Lifestyle native with the candidate using the same source baseline and data. Clearly state if AI comparison requires offline fixtures or cannot be run. Report skipped setups, entry freshness/extension, MFE/MAE with units, early adverse behavior, additions before each Gold movement milestone, drawdown, exposure, survival, and blow-up frequency. Never cherry-pick a favorable day.
8. Check docs against actual test outputs, `git diff --check`, artifact identities, no secrets, no stray test artifacts, and version consistency. Produce an honest final report with remaining uncertainties and the final commit SHA only if a commit is actually made.

## Final deliverable expected from you

Continue implementation and validation in the existing checkout, producing a reviewable repository state. Your final response must answer the user’s requested A–O report where evidence supports it: exact baseline and file, trader decision model, X posts/media reviewed, TikTok findings/limitations, original video observations, entry and add model, failure model, changed files, key security, fallback, 1:200/1:500/Unlimited results, native-vs-Astra tester/replay results, uncertainties, and actual commit SHA if committed. Distinguish observed facts, claims shown in promotional videos, engineering assertions, test outputs, and conclusions. If a requirement cannot be completed because a source or environment is unavailable, say exactly what blocked it and leave a reproducible next step.

Start by reading this prompt and the current research docs, then inspect the repository. The user’s priority is to understand the trader correctly and protect the real Lifestyle baseline before you tune or claim Astra understands anything.
