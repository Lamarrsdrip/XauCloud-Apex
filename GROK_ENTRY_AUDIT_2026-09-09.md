# XauCloud Apex — Entry-Quality Audit + Exact Fix Plan

**Date:** 2026-09-09  
**Auditor:** Grok (after watching the reference-trader videos)  
**Repo:** https://github.com/Lamarrsdrip/XauCloud-Apex  
**Commit:** `24d52956197e95d7b4fb52c260f026fe85f794e5` (`main`)  
**EA:** `ea/XauCloud-Apex.mq5` — v3.8.2 CapacityTruth  
**Scope:** SETUP FINDING + ENTRY DECISION only  
**Out of scope:** risk caps, leverage cuts, daily-loss limits, cooldowns, smaller lots, fewer trades for their own sake

This document is two parts:

1. The audit (what Apex does vs the trader, proven defects, scores, verdict).
2. The exact fix (what to change, in which functions, in what order, with tests). Do not implement until this is accepted.

---

# PART 1 — AUDIT

## Final verdict

**NO — IMPORTANT ENTRY INTELLIGENCE IS MISSING**

If the reference trader disappeared tomorrow, Apex cannot replace his setup-finding + entry decision.

It can copy the **account mechanic** (Exness unlimited, gold, pyramid while green, close at a target). It cannot copy **where and when he clicks sell**.

The smoking gun is architectural:

> He sells the **retest of the displacement / engulfing**.  
> Apex sells the **BOS bar itself**, then `InpRequireFreshTrigger=true` **forbids** waiting one more M1 for the retest.

That is exactly: direction right, entry poor, avoidable initial drawdown.

---

## Reference trader (from the videos)

He shorts gold (XAUUSD) on Exness 1:Unlimited.

Playbook, in order:

1. Gold runs into a **premium / previous-high** zone.
2. **Sweep buy-side liquidity** (take the highs).
3. **Rejection** — price no longer accepts those highs.
4. **Displacement** down (engulfing / large-bodied move back through the area).
5. **Entry on the retest** of that engulfing / displacement origin — not the wick tip, not the close of the dump bar.
6. First ticket sized from live margin (sometimes small, sometimes full margin).
7. **Add sells** only while the basket is already working and gold keeps paying.
8. Close at a round target. Floating is not realized. He blew a $4,000 runner on camera by not closing.

His words (loss video): *“price is coming back to retest that engulfing candle area. That retest is giving me the confirmation I’m looking for.”*

---

## How Apex actually enters today

Canonical path in `ea/XauCloud-Apex.mq5`:

```
OnTimer
  → Observe()           // M1 closed candles only (index 1)
  → Start(snap)         // if CAMP_IDLE and snap.valid
  → FinalEntryGate()    // immediately before submit
  → OpenLayer()         // broker market order
```

Once a campaign is live, adds are `Manage()` → `BuildAddCandidate()` → `OpenLayer()`.

### Detector (`Observe()`, ~line 2055)

| Stage | Code rule | Default |
|---|---|---|
| Impulse | `m1[1].close - m1[8].close` ≥ `impulseAtr` ATR, ≥5 of 7 bars same color | 1.8 ATR |
| Sweep | last closed high/low vs bars 9–79 by `sweepAtr` | 0.05 ATR |
| Watch | freeze extreme, opposite direction to impulse | 12 min expiry |
| Rejection | later bar high still near extreme (`rejectionZoneAtr`) AND close through `prior` | 0.12 ATR, 5 bars |
| BOS | close beyond previous M1 extreme, OR wick variant | `BOS_V371_CLOSE_OR_WICK` |
| HTF filter | M3 candle color | required |
| Score | ranking formula | `entryScore=76` |
| First entry | `rejected && microBreak && m3Gate && m5Gate && score>=threshold` | hard AND |

Sweep bar is skipped for confirmation (good — same-candle V-reversal was a prior bug).

### Final gate (`FinalEntryGate()`, ~line 2203)

| Check | Default | Effect |
|---|---|---|
| Quote exists | always | block if no tick |
| Stale quote | `InpMaxQuoteAgeMs=0` | **off** |
| Trigger bar still latest closed M1 | `InpRequireFreshTrigger=true` | **on — this is the retest killer** |
| Live quote has not reclaimed the swept extreme | `InpRejectReclaimedExtreme=true` | **on — Bug 1 is fixed** |
| Distance from trigger in ATR | `InpEntryExtensionMode=GATE_SHADOW` | **measured, never blocks** |

### Adds (`BuildAddCandidate()`, ~line 2605)

Three families:

- `REVERSAL` — a new confirmed same-direction setup
- `CONTINUATION` — `close[1] < low[2] && close[2] < low[3]`
- `FAILED_PULLBACK` — up-bar then close through its low

Then: basket floating profit > 0, `addSpacingAtr`, `InpMaxAddsPerTrigger=1`.

UNLIMITED: `baseMarginPct=100`, `layerMultiplier=2`, no max layers. That **does** match him.

---

## Trader vs Apex

| Trader | Apex now | Match |
|---|---|---|
| Gold / XAUUSD | XAUUSD only | Yes |
| Exness 1:Unlimited | `UNLIMITED` profile | Yes |
| ICT: premium, buy-side sweep, displacement, then sell | Impulse → sweep → rejection → micro-BOS | Skeleton only |
| **Entry = retest of engulfing / displacement** | Entry = same M1 that prints BOS | **No** |
| Waits after the sweep | Can confirm on the next closed bar | Premature |
| Does not chase a move that already ran | Extension gate is SHADOW | Chase allowed |
| Significant high / zone | Any 70-bar rolling high + 0.05 ATR poke | Weak liquidity |
| M1 and M3 | Detects on M1 only; M3 is a color filter | Partial |
| Basing / absorption at highs | Requires a rejection wick near the extreme | Miss |
| Adds while gold keeps paying | Adds on any two weak M1 breaks if basket green | Too loose |
| Sometimes first ticket is full margin | UNLIMITED L1 = 100% | Yes |
| Mechanical target close | Code closes at target | **Apex is better** |

---

## Replay proof (no lookahead, closed M1 only)

Synthetic gold, ATR = $2, nearby range high 4349.42, impulse into **4354.40**.

1. During the impulse Apex **armed, invalidated, re-armed three times** as each new high killed the previous watch and started a worse sell. That is the loss-cluster engine.
2. First full reversal bar (high still at the extreme, close through prior): `valid=true`, score **87**, gate **OK** → **Apex sells 4347.92**.
3. Next bar is the retest to **4349.72** (his actual location): still `valid=true`, gate **`TRIGGER_BAR_NO_LONGER_LATEST`**.
4. Immediate MAE vs the retest: **~$1.80** before the drop. Direction was right. Location was wrong.

Apex is not “a bit early.” It is **structurally banned** from taking the bar he actually uses.

Native tests: 20/20 pass for **sizing + FinalEntryGate**. Zero tests call `Observe()`. There is no gold tick replay in the repo. The `$1,000 → $7,465` tester story in `docs/STRATEGY_SPEC.md` is not reproducible here.

---

## Scoring vs mandatory conditions

```
s.valid = rejected && microBreak && m3Gate && m5Gate && score >= threshold
```

Score **cannot** revive a dead structure. Good.

Floor once those gates pass at defaults:

`25 + 24 (reject) + 22 (BOS) + 8 (M3) = 79`

Default `entryScore = 76`. So the score **never blocks** a setup that already passed the booleans. Ranking is cosmetic. Do not “fix entries” by raising 76 to 90. That is a fake restriction and was explicitly forbidden.

---

## Previous known bugs vs current `main`

| # | Bug | Status | Evidence |
|---|---|---|---|
| 1 | SELL after rebound above rejected high | **ALREADY FIXED** | `ask >= extreme` blocked. Native test `gate_reclaimed_extreme` passes. |
| 2 | Add/open twice from the same completed candle | **ALREADY FIXED** (one EA instance) | `CAMP_IDLE` gate + consume-once `triggerId`. MT5 is single-threaded. |
| 3 | Basket “finished” while a broker position remains | **ALREADY FIXED** | `CAMP_CLOSING` until `CountPos()==0`. Source-only; no close-retry test. |

Do not re-open these unless a live log proves a regression.

---

## Confirmed current entry defects

1. **No retest / location state.** Setup has a direction and an extreme. It does not have an origin box (engulfing/displacement range) to buy/sell back into.
2. **`InpRequireFreshTrigger=true` makes waiting illegal.** The only legal submit moment is “the BOS bar is still the latest closed M1.” One minute later the correct location is rejected as stale.
3. **Anti-chase is telemetry.** 5 ATR through the trigger still submits (`GATE_SHADOW`).
4. **Invalidated setups reincarnate immediately.** `SetupReset` → `SETUP_NONE` inside the same `Observe()` call, then `canArm` is true. Same thesis, worse high.
5. **Continuation adds ignore the original sweep.** Two lower M1 closes is enough if the basket is green. Original extreme can already be reclaimed.
6. **Liquidity is a rolling 70-bar high, not a pool.** 0.05 ATR poke counts as a sweep.
7. **Micro-BOS ≠ displacement.** `close < previous bar low` is common noise.
8. **Second setup family missing.** Basing / absorption at highs never arms.
9. **`Observe()` is untested.** All detector claims in prior audits were source-reading, not fixtures.

---

## Hypotheses (not proven)

- Exact 1.8 / 0.05 / 0.12 / 5-bar / 12-minute numbers vs his eye.
- How often live MAE looks like the $1.80 synthetic case.
- Whether M3-as-filter vs M3-as-detector is the bigger miss.

Do not invent new numeric thresholds from seven clips. The fix below adds **missing state**, not new magic numbers, except where a number is already measured and currently ignored (extension ATR, already in the gate).

---

## Scores (entry engine only)

| Area | /10 | Why |
|---|---|---|
| Setup detection | 5 | Right family, wrong location model |
| Market structure | 4 | 1–2 bar BOS ≠ structure |
| Directional intelligence | 6 | Impulse polarity is clear; no regime |
| Liquidity understanding | 3 | Rolling 70-bar high is not a pool |
| Displacement detection | 4 | Close beyond previous M1 low is not displacement |
| Pullback/retest intelligence | **1** | Not implemented; gate forbids it |
| Entry location | **2** | Sells the impulse close |
| Entry timing | 3 | Next-bar confirm or miss |
| Confirmation quality | 5 | Sequential sweep≠confirm is fixed; still too little |
| Anti-chase | **2** | Shadow only |
| Invalidation | 5 | Reclaim works; re-arm undoes it |
| Setup identity | 4 | IDs exist; dead setups reincarnate |
| Stale-state protection | 4 | Trigger freshness yes; thesis freshness no |
| Duplicate protection | 8 | Solid for one instance |
| Live broker execution | 8 | Fill truth, capacity truth, CLOSING persistence |
| Reference-trader similarity | **4** | Same sport, different shot |
| Initial-drawdown quality | **3** | Built to enter where drawdown starts |
| **Overall entry engine** | **4 / 10** | |

---

# PART 2 — EXACT FIX

Do not add: daily loss limits, pause-after-loss, reduced leverage, smaller lots, “only 1 trade/day”, “raise score to 90”, “require every TF to agree”, “disable continuation”, session blacklists.

Do add: location, legal wait, dead-setup identity, thesis-bound adds, tests of `Observe()`.

The goal is **fewer bad entries + more correctly timed valid entries**, including entries Apex currently **misses** (the retest).

---

## The model that must exist

A setup is not a score. It is an object with a lifecycle:

```
DETECTED (sweep of a real extreme)
  → WAITING (rejection + displacement after the sweep bar)
  → LOCATED (origin box stored: displacement/engulfing high, low, close, bar time)
  → ARMED_FOR_RETEST (setup is valid; price may come back)
  → ENTERED (live price is inside the origin box, extreme not reclaimed)
  → DEAD (extreme reclaimed, displacement fully retraced, expiry, or consumed)
```

DEAD never becomes ENTERED because a score went up.

---

## Fix 1 — Store a location box (the engulfing / displacement origin)

**Why:** He does not sell “direction.” He sells a **level**. Apex has `S.extreme` and `S.prior`. It does not have the candle he actually retests.

**Where:** `struct Setup` (~line 360) and `ArmSetup` / confirmation block in `Observe()` (~2176).

**Add fields to `Setup`:**

```
double   originHigh;      // max(open,close) of the displacement bar, or the bar high for SELL origin
double   originLow;       // min(open,close) of the displacement bar
double   originClose;
datetime originBarTime;
double   invalidLevel;    // already conceptually S.extreme — keep as the HARD invalidation
bool     displacementDone;
bool     dead;            // immutable once true for this id
string   deadReason;
```

**When confirmation currently sets `SETUP_CONFIRMED`:**

Today it stores `triggerBarTime = m1[1].time` and `triggerPrice = m1[1].close`.

Change that to also freeze the origin box from **that confirming bar**:

- SELL: `originHigh = m1[1].high` (or max(open,close) if you want the body only — start with the **full bar range**, because that is the engulfing he draws). `originLow = m1[1].low`. `originClose = m1[1].close`. `originBarTime = m1[1].time`.
- BUY: mirror.

Do **not** enter on this bar. Confirmation means “the setup now has a location.” Entry is Fix 2.

**Do not** invent a new indicator. The confirming bar Apex already requires (rejection + BOS) **is** the engulfing/displacement candle. You already find it. You just submit on it instead of waiting for price to come back into it.

---

## Fix 2 — Make waiting legal (this is the main bug)

**Why:** `InpRequireFreshTrigger=true` says: the confirming bar must still be the latest closed M1 at submit time. That is the opposite of a retest.

**Where:** `FinalEntryGate()` ~2219–2228, and `OnTimer` / `Start()`.

**Replace the meaning of freshness.**

Delete this as a hard submit rule:

```
if(InpRequireFreshTrigger && lastClosed != triggerBar) → TRIGGER_BAR_NO_LONGER_LATEST
```

Replace with three hard checks (all already almost present):

1. **Setup still alive:** `S.state == SETUP_CONFIRMED` and `!S.dead`.
2. **Extreme not reclaimed:** existing reclaim check (`ask >= S.extreme` for SELL). Keep this. It is Bug 1 and it is correct.
3. **Price is in the location, or still at the origin on the confirm bar without having run away.**

**New executable-price rule (SELL):**

```
inLocation = (bid <= originHigh && bid >= originLow)
             || (bid is within a small buffer of originHigh — optional, start at 0)
extended   = (originClose - bid) / atr   // already computed as extensionAtr vs triggerPrice
```

Submit only if:

- `inLocation == true`, AND
- extreme not reclaimed, AND
- quote is live.

On the **same bar that created the origin**, `bid` will usually already be near `originClose`, which is inside the box. That still allows a V-reversal fill if price is still in the box — the trader does take those when the dump bar IS the location. It **stops** a fill after price has already left the box by 2–3 ATR.

**Turn extension from SHADOW into a location fail, not a new policy number.**

`InpMaxEntryExtensionAtr` already exists (default 1.50) and is already measured. Native tests already cover SHADOW vs ENFORCE.

Change default of `InpEntryExtensionMode` from `GATE_SHADOW` to `GATE_ENFORCE` **only if** Fix 2 location box is live. If you enforce extension without the box, you just block late BOS bars and **miss** the retest entirely (because those retests currently fail the stale-trigger rule first).

**Order of implementation:** location box first, then stale-trigger removal, then ENFORCE extension as a backup “left the box” check. Not the other way around.

**What “fresh” should still mean:**

Keep a weaker freshness: origin bar must be **after** the sweep bar (already true) and the setup must not be older than `watchExpiryMinutes` (already true). That is enough to kill zombies. Do not require “this candle is still the last one.”

---

## Fix 3 — Enter in the box, not on the print

**Why:** `Start()` is called the moment `snap.valid` becomes true, which is the BOS close.

**Where:** `OnTimer()` ~3039: `if(s.valid) Start(s);`

**Split “confirmed” from “executable.”**

```
Observe()
  if newly confirmed → store origin box, stay CAMP_IDLE, emit SETUP_LOCATED
  if already CONFIRMED → do not Start() unless FinalEntryGate says inLocation
Start() only when gate.ok && inLocation
```

Concretely in `OnTimer`:

```
Snap s = Observe();
if(s.valid) {                    // means CONFIRMED, not “fire now”
  Gate g;
  if(FinalEntryGate(..., inLocation=true, g) && g.ok)
     Start(s);
}
```

`s.valid` today means “rejected && BOS && M3 && score.” Keep that as **confirmation**. Stop treating it as **permission to submit**.

On the confirm bar, if bid is still inside the origin box, Start() may still fire immediately. That is correct — some of his entries are that bar. The bug is firing when the close has already left the box, or being unable to fire when price comes back.

---

## Fix 4 — Dead setups stay dead

**Why:** Loss clusters are the same failed high reincarnated at a worse price. `Observe()` ~2091–2108 invalidates on `newExtreme`, then `SetupReset` sets `SETUP_NONE`, then `canArm` is true in the **same function call**, so the new high becomes a new sell watch immediately.

**Where:** `Observe()` invalidation block + `ArmSetup`.

**Change:**

1. On `NEW_EXTREME_BEYOND_SWEPT_LEVEL`, mark this setup `dead=true` and push `{dir, extreme, sweepBarTime, deadUntil}` into a small **graveyard** (ring of last N, e.g. 8).
2. `SetupReset` may clear the live slot, but `canArm` must refuse to arm a new setup whose extreme is beyond a graveyard extreme **in the same direction** until:
   - a **new opposite displacement** has printed, OR
   - price has traded back through the old origin and built a fresh sweep from a new structure, OR
   - `watchExpiryMinutes` has passed **and** a new impulse+sweep exists that is not just “the next tick of the same run.”

Minimum correct rule, no new philosophy:

> Do not arm a SELL at a higher high while the previous SELL watch for this run died because of that higher high, on this same impulse.

Implementation that matches the code you already have:

- When invalidating for `NEW_EXTREME`, do **not** allow `canArm` in the same `Observe()` call.
- Set a flag `S.suppressRearmUntilBar = m1[1].time` (the bar that broke the extreme).
- Next bars may arm only if a **new** impulse+sweep occurs **after** that bar, and preferably after a pullback (at least one bar that does not make a new extreme).

This does not pause after a loss. It stops cloning a failed idea mid-impulse.

---

## Fix 5 — Continuation adds must belong to the live thesis

**Why:** He adds because **the same sell is working**. Apex adds because two M1 closes broke prior lows. That can be a new random dump after the original high was reclaimed.

**Where:** `BuildAddCandidate()` ~2630 and `Manage()` add block ~2785.

Keep all three families. Do not disable continuation.

**Add hard requirements for CONTINUATION and FAILED_PULLBACK (SELL):**

1. Campaign still exists (`CAMP_ACTIVE`).
2. Live `ask < campaign originHigh` (still below the displacement origin). If price reclaimed the origin, this is not “the same idea.”
3. Live `ask < S.extreme` (existing reclaim idea, currently only applied to REVERSAL adds via `enforceReclaim=(a.family=="REVERSAL")`). **Apply reclaim to ALL add families.** That is not a new risk cap. That is “the thesis is dead.”
4. Keep `p > 0`, spacing, consume-once trigger.

Line that is wrong today (`Manage()` ~2812):

```
bool enforceReclaim=(a.family=="REVERSAL");
```

Change to:

```
bool enforceReclaim=true;
double invalidLevel=S.extreme;   // persist the campaign’s original extreme on the campaign object
```

You must **copy `S.extreme` onto the campaign** at `Start()`, because `SetupReset("CONSUMED_BY_CAMPAIGN")` currently wipes `S`. That is why continuation cannot see the original high. Store on campaign:

```
double campInvalidLevel;
double campOriginHigh, campOriginLow;
datetime campOriginBar;
```

Set them in `Start()` from `S` **before** `SetupReset`. Use them for every add gate and for reclaim.

---

## Fix 6 — Displacement quality (do not pile on indicators)

**Why:** `close < m1[2].low` is not “aggressive displacement.” He described large-bodied move with little overlap.

**Do not** add RSI, MACD, or “10 things must agree.”

**Tighten the existing BOS using data you already compute:**

You already compute `body`, `up`, `lo`, `wickRatio` on the confirmation bar.

Hard requirement for the origin bar (SELL), in addition to current BOS:

- body / (high-low) ≥ some floor, **or** keep current BOS and require `close < prior` (already in rejection).

The current rejection rule (`high near extreme AND close < prior`) is already a real displacement if `prior` is the pre-impulse high. After a long impulse that bar is huge (correct). After a 0.05 ATR poke, `prior` is sitting right under the sweep, so a tiny bar qualifies (wrong).

**The actual liquidity fix (small):**

Sweep must clear a **swing** high, not “max of bars 9–79.” Practical version with no new indicator:

- `ph` must be a swing high: `m1[k].high > m1[k-1].high && m1[k].high > m1[k+1].high` for some k in 9..79, and the sweep clears **that** swing, not the max of a trend grind.

If you only do one liquidity change, do this. Leave `sweepAtr=0.05` until you have labeled data. Do not retune 0.05 from seven videos.

---

## Fix 7 — Tests that must exist before claiming this is fixed

Today `tests/ea_native.test.mjs` extracts `ComputeVolume` + `FinalEntryGate` only. `Observe()` is untested. That is why previous audits over-claimed.

Extract `Observe()` + setup struct into the native harness (same pattern as `tests/native/extract.mjs`) and add fixtures:

| Fixture | Must assert |
|---|---|
| Sweep bar itself | `SETUP_WATCHING`, `valid=false` |
| Next bar V-reversal still inside origin box | `CONFIRMED`, gate OK (immediate entry allowed) |
| BOS close then next bar retest into origin | **gate OK on retest bar** (this fails today) |
| BOS close then price 3 ATR through, no retest | gate FAIL (extended / not in location) |
| Ask back above swept extreme | `RECLAIMED_INVALIDATION_LEVEL` (already passes) |
| Score high, rejection false | `valid=false` (already true in logic, untested) |
| New extreme mid-impulse | does **not** arm a worse sell on the same call |
| Continuation add after origin reclaimed | add blocked |
| Continuation add while still below origin, basket green, spaced | add allowed |
| Same closed M1, two OpenLayer attempts | one fill (already true) |

Do **not** optimize thresholds against a test window. These are architecture tests.

If gold M1 history is available later, measure per entry: MAE, MFE, time to +1 / +2 gold, distance from origin. That is the drawdown audit. It is not required to ship Fix 1–5.

---

## Implementation order (do not skip)

1. Persist origin box + campaign copy of extreme/origin (`struct Setup`, `struct` campaign, `Start()`, `SaveState`/`LoadState`).
2. Tests that currently **fail**: retest bar is `TRIGGER_BAR_NO_LONGER_LATEST`.
3. Remove stale-trigger-as-submit-rule; add in-location submit rule.
4. Split `snap.valid` (confirmed) from `Start()` (executable).
5. Graveyard / no same-call re-arm.
6. `enforceReclaim=true` for all add families, using **campaign** extreme.
7. Optional: swing-high sweep, origin-bar body quality, extension ENFORCE as backup.
8. All new tests green; existing native sizing tests still green; no change to UNLIMITED 100% / double / no max-layers.

**State schema:** bump `APEX_STATE_SCHEMA` (currently 3) because you are adding fields. Unreadable old files should not resume a campaign with empty origin (treat as `anchorsKnown=false` — already a concept). That blocks new exposure and keeps protection. Do not guess origin after restart.

---

## What not to touch

- `LayerMarginPct()` UNLIMITED formula
- `p<=0` never-add-into-a-loser
- `CAMP_CLOSING` persistence
- Reclaim-on-first-entry (Bug 1)
- Consume-once triggers (Bug 2)
- Fill-before-`layers++`
- NORMAL 15/50/100 capacity-truth
- Profit ratchet / master SL / recovery-to-entry (owner policy, not this audit)
- `entryScore` default (cosmetic; do not raise it as a fake fix)
- M3 required flag (leave default on; do not add M5 as mandatory)

---

## After the fix, expected behavior vs the videos

**$7 breakfast / 4349–4350 area**

- Sweep of 4350 → WATCH, no order.
- Bearish engulfing → CONFIRMED, origin box = that candle, no order yet unless price is still inside it.
- “Coming back to retest that engulfing” → **this is now a legal entry**. Today it is `TRIGGER_BAR_NO_LONGER_LATEST`.
- Adds while gold is weak and still below that origin, margin allowing.
- If he never closes at target, Apex still will. That part is already better.

**Impulse that keeps making new highs**

- Today: arm / kill / arm higher / kill / arm higher, then sell the first dump.
- After: one watch for the run; new highs update or kill **without** cloning a worse sell every minute.

**Dump already 3 ATR through the origin**

- Today: can still sell (SHADOW).
- After: skip until (if) price returns into the box. If it never returns, **miss**. That is correct. He would not chase that either.

---

## Files to change

| File | Why |
|---|---|
| `ea/XauCloud-Apex.mq5` | Setup/campaign fields, Observe, gate, OnTimer, Start, BuildAddCandidate, Manage, Save/LoadState |
| `ea/XauCloud-Apex-v3.8.2-CapacityTruth.mq5` | Keep versioned copy in sync **or** bump to v3.8.3 and point `version.json` at it |
| `version.json` | New build id, note: entry location/retest, strategy sizing unchanged |
| `tests/native/extract.mjs` | Also extract Observe / Setup / ArmSetup |
| `tests/native/main.cpp` | Fixtures above |
| `tests/ea_native.test.mjs` | Assertions for retest-legal, same-call rearm forbidden, continuation reclaim |
| `tests/ea_static.test.mjs` | Source-order: Start only after in-location gate; campaign stores origin before SetupReset |
| `docs/STRATEGY_SPEC.md` | Append a short “entry location” section so the next audit does not rediscover this |

Do not rewrite `server.mjs` for this. Learning stays observation-only.

---

## Done when

- Retest bar of a confirmed SELL is **accepted** by `FinalEntryGate`.
- 3 ATR chase with no return to origin is **rejected**.
- Reclaim of swept high still **rejected** (no regression of Bug 1).
- Same-candle double fill still **impossible** (no regression of Bug 2).
- Failed close still leaves `CAMP_CLOSING` (no regression of Bug 3).
- UNLIMITED still opens 100% then doubles off live margin.
- Native tests include `Observe()`, not only sizing.

Until those are true, Apex is an aggressive gold pyramid bot with an ICT-shaped scanner. It is not a replacement for his entries.
