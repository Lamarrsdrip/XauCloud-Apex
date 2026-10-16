# Lifestyle baseline audit

Audit date: 2026-10-16. Repository: `Lamarrsdrip/XauCloud-Apex`. This is a source-identity audit, not proof of profitability or of a historical informal product name.

## Baseline decision and strength of evidence

The strongest reproducible match for the requested Lifestyle behavior is **v3.8.8 UnlimitedFromL3** at commit **`bf970909308db4fc1197b7add9e1215afe9cd068`**, canonical source **`ea/XauCloud-Apex.mq5`**, release copy **`ea/XauCloud-Apex-v3.8.8-UnlimitedFromL3.mq5`**. Its identity is `XauCloud-Apex_v3.8.8-UnlimitedFromL3`, MQL property `3.880`, state schema 4.

The candidate starts from remote main **`a48fffe5ca0d38f8b10077998ee5197ad8ffa7e7`**, which preserves that exact entry/add/sizing/exit implementation with one documented rejection-quality patch: the candle satisfying rejection must have `rejection_wick / max(body, point) >= 0.10`. At that main commit the canonical and v3.8.8 release files are byte-identical, SHA-256 **`9a1945873c1b502995b11442db85abcb2dd9794b9856e897e0f1ccaed6b753a0`**. This is the **patched Lifestyle native comparison baseline**; the original `bf970909…` remains a separate historical comparator.

Why this family fits: it preserves confirmation-is-entry reversal detection, positive-basket pyramiding, the explicit 15%/50%/100% capacity escalation, Unlimited exposure from L3, no default layer cap, and existing profit/exit policies. These match the user's stated lineage and requested aggression. The source history and explicit September rollback establish which implementation is canonical. **They cannot independently prove that the user's informal word “Lifestyle” names this exact build, or that it is objectively the best performer.** No branch/tag/source string named Lifestyle was found in the available refs. That uncertainty must remain explicit; a literal missing label is not permission to substitute a different strategy.

## Search and provenance

Inspected all available local/remote refs, commit messages and EA history; canonical and archived EAs; version metadata; README; `APEX_V388_UNLIMITED_FROM_L3.md`; `APEX_V384_ENTRY_RETEST.md`; `GROK_ENTRY_AUDIT_2026-09-09.md`; `APEX_ASTRA_FULL_AUDIT.md`; `APEX_ASTRA_FINDINGS.json`; `docs/STRATEGY_SPEC.md`; `docs/APEX_V388_REPLAY_IMPROVEMENTS_2026-09-22.md`; and the external September 30 audit's architecture report and fix register. Commands included `git log --all`, `git branch -avv`, `git tag --list`, `git log --all -S ProfitFedCapacity -- ea`, and direct `git diff bf970909… origin/main -- ea/XauCloud-Apex.mq5`.

No tags are present in this clone. The five remote branches named `apex-v3.9-breakout-trend`, `apex-v3.9.1-direction-authority`, `apex-v3.9.2-confirmed-direction`, `apex-v3.9.2-fresh-direction`, and `apex-v3.9.3-confirmed-direction` all currently point to `bf970909…`. Their names are not evidence of the implementation they contain. Local `main` is stale at `f9ed597…`; remote main is authoritative for the starting checkout.

No literal `ProfitFedCapacity` identity was found in tracked source, available commit messages, or a history string search. The confirmed profit-fed behavior is `UNLIMITED_PROFIT_FED` in v3.8.8's `PlanLayerSizing()`, not an independently recovered release named ProfitFedCapacity. An unavailable external/archive build must not be invented.

## Historical lineage and rejected alternatives

| Commit / family | Material behavior and audit conclusion |
| --- | --- |
| `24d52956197e95d7b4fb52c260f026fe85f794e5` / v3.8.2 CapacityTruth | NORMAL margin economics repaired; base confirmation-is-entry trading family. |
| `00f2a8a…` / v3.8.3 EntryLocation; `3d12b23…` / v3.8.4 EntryRetest | Introduced separate displacement-origin/retest entry eligibility. Historical research, **not** the Lifestyle entry engine selected here. |
| `e25a47b…` / v3.8.5 LivePlatform | Platform/persistence/fill improvements alongside the entry experiment. Do not infer current trading semantics from this filename. |
| `c575a71ba78749c6447ad9d40665fcd75a571173`, then `64a3583…` / v3.8.6 HardenedCapacity | Commit explicitly restores untouched v3.8.2 trading with platform fixes: “No MODEL C, no mandatory retest, no dead-thesis filter.” |
| `1a05b612846b82e716db7f9af11be66b3cdc6603` / v3.8.7 UnifiedMarginLadder | Replaces old Unlimited geometric/default 100%-at-L1 behavior with 15/50/100 of actual current capacity; persists server capacity evidence. |
| `36f773a1088bb2bd0848c14700d2d58c8d670a84` | Repairs 100% capacity retry convergence without changing the requested percentage. |
| `bf970909308db4fc1197b7add9e1215afe9cd068` / v3.8.8 UnlimitedFromL3 | Separates L1/L2 simulated 1:200 capacity from actual Unlimited L3+. Exact requested historical anchor. |
| `113654250204bb28a564baf5531da8c71fce5bf6` / v3.8.9 BreakfastTiming | Later entry experiment; removed/rejected on September 22. Not a foundation. |
| `853276c8f206b79e74a3ea065ecccaa69727d307` / v3.9.0 FailedBreakout | Later changed strategy, still archived as an EA; explicitly excluded by current README. Not a foundation. |
| `7a696ed…`, `f8440b6…`, `f38a633…`, through `a48fffe…` | Restored v3.8.8 canonical, added only the 0.10 rejection-wick floor, restored matching tests/config/server and removed rejected v3.8.9 artifacts. |
| `ac66b6b63a64f71734251fcf6e78c7d1a3b27eb4` / September 30 isolated audit candidate | Six engineering fixes, schema 6; not remote main. Reported native compile/261 tests and paired holdout equivalence are prior audit receipts. Do not silently merge the candidate or claim it is the preferred historical strategy. |
| `a3ad957…` / October 1 audit continuation | Fresh ordered level-retest experiment beyond the six fixes; not remote main, not part of the selected native baseline. |
| `experiment/v3.8-astra`, `fix/apex-astra-audit` | Earlier Astra naming/repair work exists. The word Astra in old metadata does not establish the requested reference-trader brain. |

## Exact native strategy behavior

### First entry

`Observe()` reads M1 history and closed ATR. The seven-bar net move from M1 `[8].close` to `[1].close` must reach `C.impulseAtr` (default 1.8 ATR), with at least five of seven directional candles. The latest closed bar must attack the prior high/low across bars 9–79 by `C.sweepAtr` (default 0.05 ATR). This arms the **opposite** direction at a frozen extreme/prior boundary.

A later closed bar within the rejection search (default five, locally clamped to eight) must revisit near the frozen extreme (default 0.12 ATR zone) and close back through the prior boundary. Patched main additionally requires the **same qualifying candle's** rejection wick/body ratio to be at least 0.10. The sweep bar itself cannot count as its later rejection.

Fresh latest-closed-M1 micro structure must also prove the reversal: close beyond the previous bar's extreme, or default legacy wick breach of the third bar's extreme plus close beyond the previous bar's open. M3 directional color/half-range confirmation is required by default; M5 is optional. M3 freshness is optional and off by default. The score is an **uncalibrated rank**, not a probability; mandatory rejection/BOS/M3 already exceed default entry threshold 76.

`OnTimer()` invokes `Start(s)` immediately when `s.valid`; there is **no mandatory retest/origin-box state**. `FinalEntryGate()` rechecks executable quote, reclaim, fresh trigger and optional quote-age/extension rules just before order submission. Trigger-to-fill extension defaults to SHADOW, so it measures without blocking. The native bot may therefore confirm after substantial sweep-to-proof movement; Astra must measure this rather than claim an old retest engine is already present.

### Setup lifetime and invalidation

Default watch lifetime is 12 minutes from arming. Later closed-bar extremes beyond the frozen extreme invalidate the watch and permit a fresh one. Live quote reclaim is checked at submission. Setup lifecycle persistence/recovery exists. The September 30 audit identifies remaining lifetime/current-trigger/fill-accounting concerns; these are documented independent engineering questions, not grounds to silently replace the native strategy.

### Adds and spacing

Native `Manage()` requires armed configuration, available layer room, preflight readiness and **basket floating P/L > 0** before any add. It evaluates three separate families: confirmed same-direction reversal; two consecutive continuation closes beyond previous extremes; or a failed counter-direction candle broken by the next close. Optional M3 filtering for continuation is off by default. Add score defaults to 70.

Favorable executable price must be beyond `lastAdd` by `ATR * C.addSpacingAtr` (default **0.22 ATR**). This is an ATR spacing rule, **not** a fixed $0.45/$0.85/$3.75 schedule. Normally one fill is allowed per distinct trigger (`InpMaxAddsPerTrigger=1`); pending fills preserve trigger identity. Default max layers is zero (no strategy cap). Aggression increases exposure to a proven winner; the positive-basket gate blocks rescue pyramiding.

### Sizing and broker mechanics

| Profile and next layer | Exact capacity basis | Allocation |
| --- | --- | --- |
| NORMAL L1 | Current trusted economic/broker capacity, using configured reference fallback only when broker margin is untrustworthy | Configured NORMAL L1, default 15% |
| NORMAL L2 | Fresh current NORMAL capacity | Default 50% |
| NORMAL L3+ | Fresh current NORMAL capacity | Default 100% |
| UNLIMITED L1 | Simulated 1:200 notional margin, with real margin/OrderCheck still required | Fixed 15% |
| UNLIMITED L2 | Fresh simulated 1:200 capacity accounting for existing exposure | Fixed 50% |
| UNLIMITED L3 | Actual executable Unlimited capacity | Fixed 100% |
| UNLIMITED L4+ | Actual current executable capacity, mode `UNLIMITED_PROFIT_FED` | Fixed 100% |

Every non-NORMAL profile follows the Unlimited plan. Simulated leverage is derived from contract notional and margin-rate economics, not by rescaling a zero broker margin. Layer count advances on confirmed fill and is reconstructed from broker positions. `ComputeLayerVolume()`, grid normalization, volume limit, free-margin checks, `OrderCalcMargin`, `OrderCheck`, server-proven ceiling and same-percentage re-derivation remain the execution authority. L3+ capacity zero waits without consuming the trigger. `baseMarginPct * layerMultiplier^layers` is retired for sizing; stale config labels must not resurrect it.

**Small account feasibility:** with Gold at 4,400, 100 oz/lot, 0.01 minimum lot and 1:200 simulated margin, minimum margin is $22/0.01 lot. A 15% starter needs roughly **$147 equity** before one minimum lot fits its budget. The original document explicitly says a $20 Unlimited account cannot open; the same economics block $50 and $100 under those assumptions. A $50→$5,000 campaign cannot be demonstrated under that exact preserved Unlimited ladder/specification. NORMAL actual 1:500 may have different feasibility. Account size, broker contract, quotes, spread and leverage must be reported; never bypass the budget to manufacture a result.

### Exits and protections

`Manage()` services closing/pending fills and broker reconciliation first. NORMAL retains master-leg disappearance whole-basket closure; fixed master SL (default Gold distance 30); broker-verified break-even move (default +50% campaign P/L); recovery-to-entry after an adverse move reaching 40% of original SL distance; and monotonic profit ratchet (default starts at +180%, locks +100%, then +100% steps). These profile-specific protections are not silently extended to Unlimited.

The hard target is campaign-scoped (`cycleStart + basket P/L`). NORMAL percentage TP defaults disabled; Unlimited default target is start balance multiplied by 100 unless explicit equity target is selected. Closing latches and retries until flat. The native source has no comprehensive reference-trader thesis exit; Astra can manage its own thesis while hard broker/platform protections still take precedence.

## Differences from current main and preservation boundary

The historical `bf970909…` source differs from `a48fffe…` canonical by the 0.10 rejection-wick floor and explanatory comments only (27 changed lines). No changes to native first-entry timing, BOS, scoring, adds, capacity ladder, stops, break-even, ratchet, exits, licensing or cloud bridge appear in that EA diff. Canonical and v3.8.8 release copies are identical at `a48fffe…`.

Preserve the v3.8.8 release file and its SHA as historical evidence. The new candidate may change the canonical identity, add a rich-context/decision adapter and persist campaign ownership, but must retain native `Observe()`, `BuildAddCandidate()`, capacity functions, native fallback entry/add predicates and profit policies. Test Astra disabled/unavailable against patched native on the same stream. Astra campaign management may bypass native strategy eligibility only when a current machine decision has sole ownership; execution normalization, licensed preflight, non-martingale checks and emergency protections remain deterministic. A native-owned campaign must never become an Astra-owned campaign halfway through; loss of Astra should cause a one-way native takeover until flat.

## Existing performance evidence and limits

`docs/APEX_V388_REPLAY_IMPROVEMENTS_2026-09-22.md` reports 20 native real-tick days at **$1,000, 1:2000**, 20 entries, 19 eventually executable-price profitable, median first-positive time 6.142 seconds and median confirmation-to-fill 0.25 seconds. It also reports substantial losses and equity givebacks. These are historical document claims tied to that study; they are **not this task's freshly run results**, not $50 tests, not 1:200/1:500/Unlimited comparisons, and not proof of Astra improvement. The document still calls the 0.10 guard provisional while the later main commits adopt it; retain this provenance difference instead of inventing an unavailable complete acceptance receipt.

The external audit reports six engineering fixes with unchanged paired baseline/candidate deals on three holdout dates. That supports a bounded correction study, not a broad strategy or performance conclusion. No current claim that Lifecycle+AI is better may rely on those fixes alone.

## New identity recommendation

Use **XauCloud Apex Lifestyle + Astra Brain v3.10.0**, build identifier `3.10.0-lifestyle-astra-brain`, EA identity `XauCloud-Apex_v3.10.0-LifestyleAstra`, MQL property `3.100`. This avoids occupied/rejected v3.8.9/v3.9.0 identities and the existing v3.9.x remote experiment names. Existing package metadata is stale at 3.8.6 while version.json/EA are 3.8.8; update all candidate references together. Use a new persistence schema for ownership, retain reads of historical schema 4, and never relabel the immutable v3.8.8 archive as v3.10.0.

The informal Lifestyle identity remains a bounded inference from the user's supplied lineage and the recovered source. The concrete preserved baseline is exact and reproducible regardless of that unresolved label.
