# Apex v3.8.4 EntryRetest — implementation proof

Date: 2026-09-09
Canonical EA: `ea/XauCloud-Apex.mq5`
Versioned EA: `ea/XauCloud-Apex-v3.8.4-EntryRetest.mq5` (byte-identical)
`#property version "3.840"` / `APEX_VERSION XauCloud-Apex_v3.8.4-EntryRetest`
`APEX_STATE_SCHEMA` remains **4**.

This patch is **ENTRY QUALITY ONLY**. UNLIMITED 100%-then-double, NORMAL 15/50/100, ratchet, master SL, recovery, basket sizing, leverage, max layers, and GATE_SHADOW were not rewritten.

---

## 1. Files changed

| File | Why |
|---|---|
| `ea/XauCloud-Apex.mq5` | Production entry engine |
| `ea/XauCloud-Apex-v3.8.4-EntryRetest.mq5` | Byte-identical release copy |
| `version.json` / `package.json` | 3.8.4 identity |
| `tests/native/main.cpp` | Real Observe / exec-region / schema / add fixtures |
| `tests/native/build_and_run.mjs` | Extract Observe + location/thesis helpers |
| `tests/native/mt5shim.h` | Detector fields the extract needs |
| `tests/native/extracted.h` | Regenerated from the canonical EA |
| `tests/ea_native.test.mjs` | Behavioural assertions on those fixtures |
| `tests/ea_static.test.mjs` | Source-shape assertions |
| `tests/capacitytruth.test.mjs` | Identity bump; monetary 0.16/0.56/1.13 unchanged |

Sizing functions `ComputeVolume` and `LayerMarginPct` are byte-identical to v3.8.2 CapacityTruth (enforced by test).

---

## 2. Behaviour changed

### True retest lifecycle
```
WATCHING
 → CONFIRMED / ORIGIN STORED          (reason SETUP_CONFIRMED_ORIGIN_STORED)
 → WAITING_FOR_ENTRY_LOCATION         (confirmed, live price not in exec region)
 → RETEST_EXECUTABLE                  (live price in MODEL C region)
 → ENTERED                            (OnTimer: if(s.valid && s.inLocation) Start(s))
```
Confirmation is **not** an entry. A confirmation bar is immediately executable **only if** live price is still in the displacement-origin portion.

### Executable region = MODEL C (not the full dump candle)
SELL dump `H 4404 / O 4403 / C 4390 / L 4389`:
- MODEL A (full range) accepts the close
- MODEL B (body 4390–4403) still accepts the close
- MODEL C (origin/premium: 4403–4404) **rejects** the close, **accepts** 4403.2

BUY displacement is symmetric (origin 4375–4376, close rejected).

### Adds are not forced back into the first-entry box
- Campaign origin → thesis invalidation / reclaim only (`campInvalidLevel`)
- REVERSAL add → that setup’s own `S.execHigh/execLow`, and `rev.inLocation` is mandatory
- CONTINUATION / FAILED_PULLBACK → that trigger bar’s own range
- Proven: add at 4385 with own box 4384–4386 and invalidation 4410 is **allowed**
- Proven: same add with ask 4411 (invalidation reclaimed) is **blocked**

### Schema 3 fail-closed
ACTIVE/CLOSING schema-3 → `anchorsKnown=false` + log `LEGACY_CAMPAIGN_ORIGIN_UNKNOWN_NEW_EXPOSURE_BLOCKED`. `ComputePreflight` then returns `ANCHORS_UNRECONCILED`. Existing positions still manage/close. IDLE schema-3 is left alone. Schema-4 origin fields are preserved (`campOriginHigh=4404.5` after the guard).

### Dead-setup identity, not a cooldown
`g_deadThesis*` remembers dir/extreme/prior/sweep. A slightly higher high of the **same pool** cannot re-arm. A new independent pool can. Cleared only by an opposite impulse ≥ `impulseAtr`. No new timer, no loss pause.

### Liquidity
Swing highs/lows with rolling-window **fallback** if no confirmed pivot exists. Kept after synthetic no-lookahead compare (see §9).

---

## 3. New tests

Native (production logic extracted into C++, not regex):

1. Sweep → WATCHING, no entry
2. Same candle cannot confirm
3. Rejection + displacement → CONFIRMED, origin stored, dump is not executable
4. Later retest of origin → `RETEST_EXECUTABLE`
5. Chase through origin → no entry, setup stays confirmed
6. Reclaim of swept extreme → `SETUP_DEAD_RECLAIMED` / state 0
7. Confirmation with live price still at origin → immediately executable
8. Same-run slightly-higher-high through Observe → does not arm
9. New independent cycle through Observe → WATCHING
10. Continuation add outside first box → allowed
11. Continuation add after invalidation reclaim → blocked
12. Reversal add at its own origin → allowed
13. Schema-3 ACTIVE → new exposure blocked
14. Schema-4 ACTIVE → origin preserved
15. MODEL A vs B vs C on the dump candle
16. BUY-side MODEL C
17. Swing vs rolling liquidity refs on the same tape

Static: OnTimer requires `inLocation`; adds use `a.execHigh/Low`; schema-3 fail-closed string; dead-thesis helpers; reversal `rev.inLocation`; `TRIGGER_ALREADY_CONSUMED`; GATE_SHADOW default; LoadState restores origin; ComputeVolume/LayerMarginPct identical to v3.8.2.

---

## 4. Pass / fail

| Suite | Result |
|---|---|
| Native C++ harness compile | **0 errors** (g++ -std=c++17) |
| Native scenario rows | 62 JSON rows emitted |
| `tests/ea_native.test.mjs` | pass |
| `tests/ea_static.test.mjs` | pass |
| `tests/capacitytruth.test.mjs` | pass (canonical == versioned; 0.16 / 0.56 / 1.13 intact) |
| Full `node --test tests/*.test.mjs` | **147 / 147 pass, 0 fail** |

MetaEditor was **not** run in this sandbox (no MT5 compiler). Brace count of the MQ5 is 409/409. Compile it locally; it should be 0 errors. Warnings cannot be certified here.

---

## 5. Sizing unchanged (the $1k / 1:500 incident)

| Profile | v3.8.2 | v3.8.4 |
|---|---|---|
| NORMAL L1 15% | 0.16 | **0.16** |
| NORMAL L2 50% | 0.56 | **0.56** |
| NORMAL L3 100% | 1.13 | **1.13** |
| UNLIMITED $1000 pathological | 200 (full allocation) | **200** |

GATE_SHADOW remains the compiled default. 1.50 ATR is still measurement-only.

---

## 6–7. Replay / MAE-MFE

No live XAU tick archive is in the repo, so this is **synthetic no-lookahead tape**, not a historical gold bake-off. Honest numbers on the dump candle used throughout:

Displacement SELL: origin 4403, close 4390, invalidation 4410, then a retrace to origin.

| Model | Enters at dump close? | MAE if price retraces to origin | Distance to invalidation |
|---|---|---|---|
| A full range | YES | 13 | 20 |
| B body | YES | 13 | 20 |
| **C origin/premium (kept)** | **NO** | **7** (only after a real retest) | **7** |

If the market never retraces and just runs 4390 → 4370, MODEL A/B catch the runner and MODEL C **misses**. That is the reference trader’s actual decision: wait for the origin retest, accept missed non-retest runners, refuse the dump-close chase.

v3.8.2 had no origin box (entered at BOS close). v3.8.3 used the **full** confirmation candle, so the dump close was still inside the box. v3.8.4 is the first build that refuses that close.

---

## 8. Full-candle origin: **changed to MODEL C**

Why: the reference trader enters the **displacement origin**, not the wick-to-wick dump. Full-range (A) and body (B) both treat 4390 as a legal SELL location on a candle that opened at 4403. That is the original bug. MODEL C’s executable region on that bar is 4403–4404.

A confirmation bar may still fill immediately if live price has **not** displaced away from that origin portion. Proven: `obs_confirm_at_origin_executable` → `RETEST_EXECUTABLE`.

Continuation/failed-pullback adds do **not** use MODEL C of the first candle. They use **that add’s trigger bar**. Pyramiding with the move is allowed; chasing the original box is not required; reclaiming campaign invalidation still kills the thesis.

---

## 9. Swing liquidity: **kept, with rolling fallback**

Same tape, no lookahead (bars 9–79 only):

| Detector | Liquidity high |
|---|---|
| Swing (kept) | **4400** (confirmed pivot) |
| Rolling | **4409** (later grind wick that is not a pivot) |

ICT/SMC sweeps a **pool** (swing / equal high), not “any new high of the last 70 bars”. Rolling fires more trend-breakout “sweeps”. Swing without a pivot would go blind, so we **fall back to rolling** when no confirmed swing high **and** low exist.

Not proven on live gold history. If demo shows missed equal-high sweeps or extra grind sweeps, refine the pivot rule — do not silently revert.

---

## 10. Same-run reincarnation: **fixed**

Through the real `Observe()` arming path, not a helper-only test:

- Dead SELL at 4410.2 / prior 4400, next sweep 4412.5 of the same pool → **does not arm** (`state=0`, `deadActive=true`)
- New pool sweep 4380.5 / prior 4370 → **WATCHING**
- Opposite impulse ≥ `impulseAtr` clears the dead identity
- No new time cooldown was added

---

## 11. Continuation adds outside the first box: **yes**

`gate_add_continuation_outside_first_box` at bid 4385, own location 4384–4386, campaign invalidation 4410 → `ok=true`.
First-entry box 4398–4404 is **not** consulted.

---

## 12. Schema-3 ACTIVE: **yes, fail-closed**

`schema3_active_blocks`: `blocked=true`, `anchorsKnown=false`.
Preflight: `ANCHORS_UNRECONCILED` → `OpenLayer` cannot add.
Manage/close of existing positions is not gated by that preflight.

---

## 13. Ready for demo / live validation?

**Entry engine: ready for DEMO validation.**
**Whole platform live-acc: not claimed.** The 2026-09-09 site/live platform audit still stands (WAF disarm, split-brain apex.xaucloud.io vs xaucloud.io, etc.). Those are not part of this patch.

---

## Remaining vs fixed vs still-wrong vs hypothesis

**Fixed**
- Confirmation ≠ entry
- Dump-close is not a location
- Adds have their own location
- Campaign invalidation is separate from add location
- Schema-3 new exposure fail-closed
- Same-run identity
- Observe pipeline is actually executed in the harness
- GATE_SHADOW kept
- Sizing untouched

**Remaining / not claimed**
- No MetaEditor compile in this environment
- No live XAU tick MAE/MFE bake-off
- Continuation trigger-bar range is still the full bar of **that** add (intentional for pyramiding; not MODEL C of the first candle)
- `g_noRearmBeforeBar` one-bar guard still exists next to identity (same-bar only, not a cooldown)
- Existing `C.cooldownMinutes` after a **campaign end** was not touched (pre-existing, not used as dead-setup protection)

**Still-wrong (known, out of this patch)**
- Platform split-brain / WAF / cross-terminal lock from the live-platform audit

**Hypothesis (unvalidated, therefore still SHADOW)**
- 1.50 ATR extension threshold. Measured, never a hard default.

---

## Scores (entry engine only)

| Axis | Score | Note |
|---|---|---|
| SETUP DETECTION | **8.5 / 10** | Same sequential detector + swing pools + identity. Not live-gold counted. |
| ORIGIN / LOCATION | **9 / 10** | MODEL C proven vs A/B on the dump candle. |
| RETEST TIMING | **9 / 10** | Full lifecycle + immediate-at-origin-only. |
| CHASE PREVENTION | **8.5 / 10** | Location box does the work. 1.50 ATR still SHADOW. |
| INVALIDATION | **9 / 10** | Live reclaim kills; add reclaim uses campaign level. |
| ADD INTELLIGENCE | **8.5 / 10** | Own location + original invalidation. Full trigger-bar for continuation. |
| DEAD-THESIS IDENTITY | **9 / 10** | Proven through Observe. |
| STATE SCHEMA | **9.5 / 10** | Fail-closed new exposure; schema-4 origin restored. |
| SIZING NON-REGRESSION | **10 / 10** | 0.16/0.56/1.13 and UNLIMITED 200 unchanged. |
| **OVERALL ENTRY ENGINE** | **8.7 / 10** | |

### Verdict

**MOSTLY**

Architecture is no longer wrong. The missing piece is **live-gold replay evidence**, not another location rule. Demo it. Do not treat this as a platform go-live.

If demo shows Apex still entering dump closes, send the tape — that would be a bug. If it waits for the origin and pyramids at continuation bars while the 4410 invalidation is intact, this patch did its job.
