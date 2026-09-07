# Claude Opus — implement the Apex audit fixes

You are implementing the findings from an independent audit of XauCloud Apex. Fix the implementation properly; preserve the existing reversal strategy unless a change is explicitly specified below. Do not substitute unrelated indicators, increase exposure to disguise drawdown, or claim that the trader or bot can always enter directly into profit.

## Repository-relative locations (use these in a GitHub checkout)

- `APEX_ASTRA_FULL_AUDIT.md` — full report.
- `APEX_ASTRA_FINDINGS.json` — exact findings and acceptance criteria.
- `docs/audit-evidence/2026-09-07/` — published diagnostic scripts, results and source hashes.

The absolute paths below identify the original audit workspace. On another machine, use the current checkout and the repository-relative files above. Original video imagery and transcripts remain local. The audit source hashes describe the pre-publication commit, not this documentation commit. Diagnostic scripts use the original workspace layout; adapt their repository/output path constants when running elsewhere without changing test logic.

## Read these files first

Full report:
`/Users/libertyelectronics/Documents/Codex/2026-09-06/w/outputs/APEX_ASTRA_FULL_AUDIT.md`

Structured findings, including exact source locations, current behavior, fix specifications and acceptance tests:
`/Users/libertyelectronics/Documents/Codex/2026-09-06/w/outputs/APEX_ASTRA_FINDINGS.json`

Evidence and diagnostic scripts:
`/Users/libertyelectronics/Documents/Codex/2026-09-06/w/outputs/evidence/`

Audited isolated repository:
`/Users/libertyelectronics/Documents/Codex/2026-09-06/w/work/XauCloud-Apex`

Audited Apex commit:
`3ebfc49ce67058ab5aa915c6335ed75b10093075`

Inspected XauCloud counterpart:
`/Users/libertyelectronics/Documents/Codex/2026-09-04/fix-only-the-apex-xaucloud-license/XauAI-Sniper`

Inspected counterpart commit:
`a42f6e6ea1b9c10a0adc3fb7a77dfb5ba2eac966`

The user thinks the running EA is3.7.1. Its exact EX5/build, settings and live history are unverified. The audit found28 issues:2 P0,19 P1 and7 P2. Existing76 tests passed despite the defects. The audit covered sampled visuals throughout all seven videos, complete automated narration for V1 and partial V2 only. It did not perform native MT5 compilation or historical broker replay. Do not repeat the audit or transcribe videos again as a prerequisite for fixing confirmed software defects.

## Working rules

1. Read applicable AGENTS.md instructions. Check branch, working tree and current revisions. Work in an isolated branch/checkout; preserve unrelated user edits. Compare newer source against the audited revision before applying findings. A finding is already resolved only if current code and a meaningful test prove it.
2. The audit clone is an implementation starting point, not a verified production checkout. Inspect the counterpart read-only first. Make any required counterpart changes in an isolated branch/worktree, preserving its existing work.
3. Implement and test locally. Do not deploy, place live trades, alter a live account, rotate production secrets or push/merge without a separate explicit instruction. Do not insert real credentials into tests, reports or logs.
4. Keep the sweep/rejection/reversal concept. New price-zone/age thresholds and new setup variants are strategy hypotheses, not known profitable settings. Separate correctness repairs from behavioral experiments. Do not invent “optimal” thresholds from seven selected clips.
5. Do not stop at renaming flags, adding comments or passing source-regex tests. Wire every fix through actual state, broker results, server configuration and UI behavior. Do not mark an issue fixed when only its documentation changed.
6. Maintain a28-row checklist with finding ID, status, changed files and test evidence. Mark unverified native/platform behavior honestly. Continue independent fixes if a particular integration test lacks credentials or platform access.

## Fix in this order

### 1. Broker execution and basket safety — 008,010,011,009,014,027

- Replace CTrade Boolean-only success handling with retcode, deal and actual-position reconciliation. Handle pending/partial/rejected outcomes. Advance layers only for actual fills. Update SL state only when the broker confirms the stop. Read back SL and reconcile through trade transactions.
- Add a persistent CLOSING state. Every exit reason must retain campaign identity, original anchors and exit intent until zero owned positions are confirmed. Failed closes must retry safely; never add or start another campaign while closing.
- Persist original master stop, recovery-armed flag, earned floor, closing intent and consumed trigger IDs. Key state by account+broker+symbol+magic; use versioned atomic writes and validate ticket ownership. Recover entry/SL from positions when possible. Unknown historical anchors must be explicit and prohibit further exposure until reconciled.
- Fix minimum-volume sizing: never round an unaffordable budget UP to minimum lot. Validate actual volume step, final margin and OrderCheck. Include nondecimal volume-step tests.
- Enforce supported account mode and single active manager per account/symbol/magic. Initially reject unsupported netting semantics. Add separate configurable basket exposure/margin-reserve limits; do not silently select a new live risk appetite. Preserve already-open positions under protective management when a new preflight blocks entries.

### 2. Entry timing and add eligibility — 001–007

- Separate setup recognition, confirmation and final executable-price eligibility. Persist setup ID, extreme, structural trigger and timestamps.
- Immediately before submission, get a fresh MqlTick. Reject structural invalidation/reclaim, stale quotes/triggers and excessive extension using explicitly named parameters. Never let a stored valid candle pattern authorize an entry regardless of live location. Repeat validation after any blocking operation.
- Invalidate obsolete watches and allow genuinely new candidates. Do not let one frozen watch suppress the scanner for its full expiry after its premise is gone.
- Remove synchronous cloud/event requests from the order/risk-critical path. A second handler on the same EA thread is not asynchronous. Process protection before networking, use a local event queue with a separate transport mechanism where necessary, and measure actual risk-loop gaps. Keep broker-side protection.
- Separate reversal candidates from continuation/failed-pullback add candidates. Enforce an explicit addEligible result. Do not use direction equality or an invalid Observe score as confirmation.
- Consume each add trigger once. If explicit multi-order batching is retained, define its batch ID and total exposure cap; do not implement batching accidentally through repeated timer calls.
- Make the BOS predicate truthful and explicit. Test wick-only breach versus confirmed structural close. Mandatory structure cannot be replaced by unrelated score points. Explain/remove redundant constant score contributions without claiming calibrated probability.
- Request optional M3/M5 data only when enabled. Label candle-color context accurately; define its freshness semantics. Do not blindly require another higher-timeframe close as a cure for late entry.
- Keep a separate exhaustion-pause/failed-recovery first-entry family in shadow evaluation until adequately labeled; do not silently enable an unvalidated new strategy.

### 3. Applied settings and protection policy — 012,013,016,019,023,028

- Wire NORMAL L1/L2/L3 margin, fixed master SL, BE and recovery settings end-to-end. These currently remain local Inputs despite dashboard controls. TP/ratchet were already wired at the audited HEAD: preserve that fix.
- Use one typed, allowlisted configuration schema and explicit precedence. Reject unknown protocol keys, incorrect Boolean types and inconsistent protection settings. Keep server-derived license/revision fields outside editable config.
- Cache ALL configuration, including profile/mode strings and revision. Reject older revisions before applying them. Replace substring JSON parsing with structurally correct validation and atomic apply; malformed responses must not partially overwrite state.
- Snapshot campaign policy. Clearly distinguish next-campaign changes from safe live tightening. Keep earned protection floors monotonic across config changes and restart. Prevent a profile change silently removing active protections.
- Align admin license profile with execution profile, or clearly separate commercial tier from execution mode. Display desired/applied values and effective timing.

### 4. Cloud/control correctness — 015,017,018,020,021,022,024,025

- Handle structured authenticated denials on heartbeat and config consistently. Persist denial so restart cannot restore an old armed cache. Temporary timeout/500 must retain approved local-resilience behavior. Malformed200 is a protocol error, not fabricated license denial. Existing trades must still be managed.
- Enforce canonical expiry and consistent account binding on EA routes. Preserve atomic first-claim. Do not let legacy endpoints bypass binding/expiry. Reconcile deployed counterpart before claiming integration complete.
- Project current campaign, history and command ACK from canonical events. Use stable event IDs and durable pagination/checkpoints; latest60 events are not full history. Distinguish desired armed state from applied state and unknown/stale state.
- Report real terminal connectivity, broker trading readiness, open positions, free margin, applied revision/hash and last scan gate. Reconcile realized deals, commissions, swaps and partial closes separately from floating P/L. Add decision/submission/fill timestamps and per-entry quote evidence.
- Fix concurrent config/revision writes using transactional/optimistic concurrency and a durable outbox/idempotent bridge sync. Reject revision rollback at both ends. Treat corrupt/unreadable files as explicit failures, not empty databases.
- Bound bridge requests with deadlines; startup/local status must not wait indefinitely for remote sync. Show pending/error honestly.
- Reject absent/default production secrets. Add least-privilege service configuration and appropriate authentication throttling. Do not assume production currently uses the default secrets.
- Correct WebRequest instructions to canonical https://xaucloud.io for the current EA. Unify build/version metadata and publish source/binary hashes. Remove stale3.7.0 installation claims from current guidance.

### 5. Learning and proof — 026 plus all findings

Keep learning explicitly observation-only until a real validated adaptation pipeline exists. Do not turn audit heuristics into automatic live score adjustments. Produce a reliable entry-quality dataset before claiming improved MAE, faster profit or trader replication.

## Required validation

Run the existing suite, then add tests that fail on the original defects and pass after fixes. At minimum:

- Same closed bars: valid in-zone quote versus reclaimed extreme versus extended chase quote.
- Same completed add trigger across multiple ticks, restart and delayed fills: no accidental duplicate exposure.
- True Boolean request with rejection/partial fill; SL modification refused; transaction reconciliation.
- Every exit path with failed/partial close and restart: closing intent persists, no additions.
- Minimum lot exceeds budget; .25/nondecimal steps; changing margin; unsupported account mode; two EA instances.
- Recovery/BE/ratchet state across restart, missing/corrupt file and account/symbol changes.
- Previously earned floor cannot loosen; active profile/TP changes follow documented timing.
- Every dashboard field changes actual runtime behavior and survives offline cache reload.
- Canonical event-only campaign/ACK/history flow, not just legacy endpoint tests.
- Heartbeat403, timeout/500, malformed200, stale revision and expiry crossing.
- Concurrent saves, bridge failure, local write failure and startup with black-holed bridge.

Use the supplied extracted C++ diagnostics as reproducible evidence, but do not treat them as native MQL certification. Compile the EA in MetaEditor when available and record build output. Exercise broker semantics on a demo/test environment only. If the platform is unavailable, finish the source/tests and explicitly mark native validation outstanding; do not fabricate a pass or claim release-ready.

For strategy changes, replay the same bid/ask tick stream with costs, fixed risk, chronological holdout and no future information. Measure early MAE/MFE, time to meaningful favorable response, entry distance/age, missed setups and net outcomes. If data is unavailable, ship the shadow/replay instrumentation and label performance unverified. Never claim the reported live losses have been causally explained without matching logs.

## Deliverables

Save these alongside the audit under:
`/Users/libertyelectronics/Documents/Codex/2026-09-06/w/outputs/`

1. `APEX_FIX_STATUS.md` — all28 IDs: fixed/already fixed/partial/blocked, changed files, exact tests and remaining limitations.
2. `APEX_FIX_VALIDATION.md` — commands/results, native compile/demo status, schema/cache migration and release/rollback notes.
3. Updated code in the isolated implementation branch, with a reviewable diff and no unrelated rewrites.
4. Concise final response: what changed, which findings remain, what was tested and whether native validation is still outstanding.

The objective is a bot whose actual execution, protection and entry timing match its documented rules—not a cosmetic report or a promise of zero drawdown.
