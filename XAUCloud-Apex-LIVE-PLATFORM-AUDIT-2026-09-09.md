# XauCloud Apex — Full Platform Audit (Site + Live Trading)

**Date:** 2026-09-09  
**Repo:** https://github.com/Lamarrsdrip/XauCloud-Apex  
**Commit audited:** `00f2a8a` (`main`) — EA v3.8.3 EntryLocation, site still labels itself 3.8.2/3.8.0  
**Scope:** Is this stack actually ready to run a live account?

This is a correctness / live-readiness audit.  
It does **not** add daily-loss limits, smaller lots, or a new risk philosophy.

---

## Verdict

**NO — NOT FULLY READY FOR A LIVE ACCOUNT.**

The EA can compile and can open gold. The site can arm a license. That is not the same as “the platform works.”

Three things are true at once:

1. v3.8.2 sizing repairs (NORMAL 15/50/100, fill-before-layers, CLOSING persistence) are real and tested.
2. v3.8.3 **breaks pyramiding** — continuation adds are forced through the first-entry origin box, so the unlimited basket cannot add after the first dump. That is the strategy.
3. The **website does not talk to the EA**. Both talk to `xaucloud.io` through a bridge. If that bridge is missing, delayed, or lying, the dashboard is a toy and the EA trades on last-good cache.

Until the blockers below are fixed, do not put real money on this build and believe the dashboard.

---

## How the platform actually works

```
You (browser)  →  this Node server (apex.xaucloud.io in theory)
                      │
                      │  APEX_BRIDGE_SECRET
                      ▼
                 https://xaucloud.io
                      ▲
                      │  WebRequest (no secret, license in query/body)
                      │
MT5 EA  ──────────────┘
   POST /api/cloud/monitor/heartbeat
   GET  /api/cloud/apex/config?license_key=&account=
   POST /api/cloud/apex/event
```

This repo’s server **does not implement** the three URLs the EA calls.

It implements:

- `/api/apex/heartbeat`
- `/api/ea/config`
- `/api/apex/event`
- `/api/session/config` (dashboard save)

Those EA-facing routes on **this** server are unused by v3.8.3.  
The dashboard saves locally, then **hopes** `syncBridgeConfig()` mirrored it to xaucloud.io, then **hopes** the EA’s next 8-second poll picks it up.

If `APEX_BRIDGE_SECRET` is empty, `syncBridgeConfig()` returns `null` and the UI still reports **DELIVERED**.

That is the split-brain.

---

## BLOCKERS — do not go live until these are closed

### LIVE-001 — v3.8.3 continuation adds cannot fire (pyramiding dead)

**Severity:** BLOCKER  
**File:** `ea/XauCloud-Apex.mq5` `Manage()` ~2935 and `FinalEntryGate()` ~2342  
**Status:** CONFIRMED (source)

First entry correctly requires live price **inside** the origin box.  
Adds then pass the **same** origin box into `OpenLayer()`:

```
bool enforceReclaim=true;
double addOH=campOriginHigh;
double addOL=campOriginLow;
OpenLayer(..., addOH, addOL);
```

`FinalEntryGate` then does:

```
inLocation = (SELL) bid <= originHigh && bid >= originLow
else PRICE_LEFT_ORIGIN_BOX → reject
```

A continuation sell is, by definition, **below** `originLow`.  
So after the first dump, every add is rejected. UNLIMITED 100% then double never happens.

This is a v3.8.3 regression. v3.8.2 could add. The audit spec was:

- still **below** `originHigh` (thesis alive)
- reclaim the swept extreme
- **not** “still inside the first candle”

**Fix:** origin box is first-entry only. Adds pass `originHigh=0, originLow=0` into the gate, and separately require `ask < campOriginHigh` (SELL) / `bid > campOriginLow` (BUY) plus reclaim of `campInvalidLevel`.

Until this is patched, v3.8.3 is a one-and-done entry bot, not the trader.

---

### LIVE-002 — EA never talks to this dashboard

**Severity:** BLOCKER (ops)  
**Files:** EA `InpCloudURL="https://xaucloud.io"` + `CloudSync()`; `server.mjs` routes  
**Status:** CONFIRMED (source)

v3.8.3 only WebRequests `https://xaucloud.io`.  
This Node app is not that host. Live arming, UNLIMITED, heartbeat, events all depend on **xaucloud.io code that is not in this repo**.

This audit cannot certify xaucloud.io. If that side is down, delayed, or a different schema, the EA keeps last-good cache and the site shows fiction.

**Fix before live:** prove, with a real license, that:

1. Dashboard ARM → bridge upsert → EA log `APEX XAUCLOUD LINK OK | armed=true` within one poll (8s).
2. Dashboard UNLIMITED → EA `account_profile` in heartbeat is UNLIMITED.
3. EA `CAMPAIGN_START` appears on the dashboard Campaigns page.
4. DISARM stops **new** entries while an open basket is still managed.

If any of those four fail, the platform is not live.

---

### SITE-001 — UI says DELIVERED when nothing was sent

**Severity:** BLOCKER (ops lie)  
**File:** `server.mjs` ~491 and ~1088  
**Status:** CONFIRMED

```
const delivery=await syncBridgeConfig(...)   // returns null if no APEX_BRIDGE_SECRET
delivery: saved.delivery?.queued ? 'QUEUED_FOR_BRIDGE' : 'DELIVERED'
```

`null?.queued` is falsy → **DELIVERED**.  
You can arm UNLIMITED on the site, see success, and the EA is still NORMAL/disarmed on last cache.

**Fix:** if `!bridgeConfigured()` or `delivery==null`, return `NOT_SENT_BRIDGE_NOT_CONFIGURED` and refuse to toast success.

---

### SITE-002 — production secret check is hardcoded bypassed

**Severity:** BLOCKER (security)  
**File:** `server.mjs` ~1236  
**Status:** CONFIRMED

```
console.warn("APEX production secret startup check bypassed");
server.listen(...)
```

`assertProductionSecrets()` is **never called**.  
`deploy/xaucloud-apex.service` does not set `NODE_ENV=production`.  
Published defaults in `.env.example`:

- `ADMIN_TOKEN=change-me-admin`
- `SESSION_SECRET=change-me-session-secret`

Anyone who can hit `/api/admin/licenses` with `Bearer change-me-admin` can mint UNLIMITED licenses and arm them.

**Fix:** call `assertProductionSecrets()` before `listen` when not test. Set `NODE_ENV=production` in the systemd unit. Refuse boot on default/short secrets.

---

### SITE-003 — dashboard tells the user to allow the **wrong** WebRequest URL

**Severity:** BLOCKER (ops)  
**File:** `public/index.html` line 931  
**Status:** CONFIRMED (source + live)

Account setup on the site:

> allow WebRequest for `https://apex.xaucloud.io`

EA `InpCloudURL` default, `version.json`, README, and live `/health.webRequestOrigin` are all `https://xaucloud.io`.

A user who follows **the site they log into**:

1. Allows `apex.xaucloud.io`
2. EA `WebRequest` to `xaucloud.io` fails (MT5 4014)
3. `CloudSync()` transport-fails and **never changes `C.armed`**
4. Dashboard can still show Armed / UNLIMITED

This is the most likely live “I armed it and nothing happens” path.

**Fix:** the Account page must say `https://xaucloud.io`. Never apex.

---

### SITE-004 — live apex.xaucloud.io is already running with rejected secrets and a hung bridge sync

**Severity:** BLOCKER (ops, live probe 2026-09-09 15:40 UTC)  
**URL:** `https://apex.xaucloud.io/health`  
**Status:** CONFIRMED LIVE

```json
"version": "3.8.3",
"webRequestOrigin": "https://xaucloud.io",
"bridge": { "configured": true, "sync": { "status": "RUNNING", "licenses": 0, "finishedAt": null } },
"secretsAcceptableForProduction": false
```

- The 3.8.3 **site** is deployed. The EA EX5 on your terminal is a separate question.
- `secretsAcceptableForProduction: false` means ADMIN_TOKEN and/or SESSION_SECRET is missing, default, or too short **on the real box**.
- Bridge sync started, `licenses: 0`, `finishedAt: null` — either hung or empty. Dashboard may have no live EA mirror.

`https://xaucloud.io/health` returns `{"status":"ok"}` — a **different product**. That is the host the EA actually hits.

---

### SITE-005 — “UNLIMITED Profile Multiplier” does not change size

**Severity:** HIGH (sold as a control, is a no-op)  
**Files:** `public/index.html` ~739; `LayerMarginPct()`  
**Status:** CONFIRMED

UNLIMITED size is:

```
min(100, baseMarginPct * layerMultiplier^layers)
```

`baseMarginPct` default is **100** and the dashboard **never exposes it**.

`min(100, 100 * 2^n) = 100` on every layer. Moving the Settings “multiplier” does nothing.

UNLIMITED then becomes “100% of remaining executable capacity every add” — which is the trader on a tiny account, but it is **not** “double lots” and the label is a lie. First ticket can consume all margin; later adds only exist if floating profit frees margin.

**Fix:** either expose `baseMarginPct` (e.g. first layer 100, then remaining) and label honestly, or hide the dead control.

---

## HIGH

### LIVE-003 — watching setups keep the **first** `prior`, so later highs may never confirm

**Severity:** HIGH  
**File:** `Observe()` new-extreme UPDATE branch  
**Status:** CONFIRMED logic (needs gold tape to measure how often)

v3.8.3 no longer re-arms on a new high. It updates `S.extreme` and leaves `S.prior` as the original swing.

Rejection still requires `close < S.prior`.  
If the first arm was at 4345 with prior 4340, then gold runs to 4354, confirmation now needs a close back through 4340 — a full giveback — not a local rejection of 4354.

The trader rejects **that** high. Original v3.8.2 re-arm would have set prior near the new high.

**Fix:** when updating the watched extreme, set `S.prior` to the previous extreme (the high you just replaced). Local BOS of the running high, not retrace of the whole impulse.

---

### LIVE-004 — confirmed setup is not persisted; MT5 restart dumps the retest

**Severity:** HIGH  
**File:** `SaveState()` — campaign only, no `Setup`  
**Status:** CONFIRMED

v3.8.3 **waits** for the retest. That wait can be minutes.  
`OnInit` calls `SetupReset("INIT")`. A terminal restart, VPS blip, or EA re-attach wipes `SETUP_CONFIRMED` + origin box. The retest prints. Apex is idle.

Campaign state survives. Setup state does not.

**Fix:** persist `S` (id, dir, extreme, prior, origin box, confirmedAt) in the schema-4 state file. Restore on `LoadState` if `CAMP_IDLE`.

---

### LIVE-005 — docs / package / UI still advertise the wrong EA

**Severity:** HIGH (you will compile the wrong file)  
**Files:** `README.md`, `package.json`, `APEX_FIX_STATUS.md`  
**Status:** CONFIRMED

| Place | Says |
|---|---|
| README | v3.8.0, identity `XauCloud-Apex_v3.8.0-AstraFix` |
| package.json | 3.8.2 |
| version.json | 3.8.3-entry-location |
| EA `#property` | 3.830 |
| systemd / health | reads version.json |

If you follow README, you compile the wrong story. On a live box, compile **only** `ea/XauCloud-Apex.mq5` (v3.8.3) and confirm Experts log `APEX_READY XauCloud-Apex_v3.8.3-EntryLocation`.

---

### LIVE-006 — WebRequest can stall the timer for up to ~5s every 8s

**Severity:** HIGH (execution quality)  
**File:** `OnTimer` → `CloudSync` after Manage, `InpCloudTimeoutMs=2500`, two HTTP calls  
**Status:** CONFIRMED

Order is correct (Manage first).  
Then heartbeat + config, each up to 2.5s, **blocking** the MQL thread. Adds/exits on the next timer can be late by several seconds on a slow `xaucloud.io`. Gold does not wait.

**Fix:** keep Manage first (already). Cap total cloud budget. Do not add a third WebRequest on that tick. Event flush already does one more HTTP after Manage (`FlushEventQueue`). Worst tick = heartbeat + config + one event = three blocking calls.

---

### SITE-003 — dashboard “Last EA Sync” is blind unless the bridge reports lastSeen

**Severity:** HIGH  
**File:** `buildMe()` `server.mjs` ~835  
**Status:** CONFIRMED

Current EA never hits `/api/apex/heartbeat` on this server, so local `lic.lastSeen` is only written if something else stamps it.  
`buildMe` prefers `remote.mt5.lastSeen` from the bridge.

No bridge → `dataAvailable:false` → Campaigns page shows empty while the EA may already be in a live basket.

**Fix:** same as LIVE-002 proof. Also parse EA heartbeat on xaucloud.io into bridge status. Do not invent a second heartbeat URL on the EA without changing WebRequest allowlists.

---

### SITE-004 — arm toggle does not show whether the EA applied it

**Severity:** HIGH  
**File:** `public/index.html` `wireDashboardControls` ~608  
**Status:** CONFIRMED

Arming POSTs `/api/session/config` and toasts “Apex armed” from the **desired** config.  
`buildMe` already computes `inSync: appliedRevision===desiredRevision` from heartbeat. The toggle does not wait for that. You can be disarmed on the terminal and green on the phone.

**Fix:** pill must show DESIRED vs APPLIED. Do not toast success until `appliedRevision` catches up, or show “queued, waiting for EA”.

---

## MEDIUM

### LIVE-007 — `BuildAddCandidate()` calls `Observe()`, which can arm a new setup mid-basket

**Severity:** MEDIUM  
**File:** `BuildAddCandidate()` ~2741  
**Status:** CONFIRMED side-effect

During an active campaign, add-scan runs the full detector. That can `ArmSetup` / `SETUP_CONFIRMED` a **new** watch. A REVERSAL add then fires against **campaign** origin, not the new watch’s origin. Can add on a different idea while the original high is still intact.

### LIVE-008 — SELL in-location uses BID, reclaim uses ASK

**Severity:** MEDIUM  
**File:** `Observe()` inLocation vs `FinalEntryGate` reclaim  
**Status:** CONFIRMED, often correct, edge on wide spread

SELL fill is bid — in-box on bid is right.  
Invalidation on ask reclaiming the high is right.  
On a $0.40 gold spread, bid can sit in a tight origin while ask is already back through a nearby extreme. Rare if origin is a real displacement candle. Watch first live entries.

### LIVE-009 — schema 3 campaigns restore with empty origin

**Severity:** MEDIUM  
**File:** `LoadState` accepts schema 3 or 4  
**Status:** CONFIRMED

A v3.8.2 state file loads. `campOriginHigh=0`. Location gate skipped. Adds skip origin-thesis check. After LIVE-001 is fixed this is acceptable for old baskets; new v3.8.3 campaigns must write schema 4.

### LIVE-010 — seed `data/config.json` is missing live-critical keys

**Severity:** MEDIUM  
**File:** `data/config.json`  
**Status:** CONFIRMED

Missing vs schema: `normalReferenceLeverage`, `maxBasketLots`, `minMarginLevelPct`, `marginReservePct`.  
Defaults fill them (leverage AUTO=0). A NORMAL live account on a pathological Exness margin model then hits `NORMAL_REFERENCE_LEVERAGE_REQUIRED` and will **not open**. That is intended — but the seed file does not warn the operator to set 1:500 on the dashboard.

### SITE-005 — README persistence path vs code default disagree

**Severity:** MEDIUM  
**Files:** README `/var/lib/xaucloud-apex`; `runtime-data.mjs` production fallback `~/.xaucloud-apex`  
**Status:** CONFIRMED

systemd unit **does** set `DATA_DIR=/var/lib/xaucloud-apex`, so a correct service install is fine.  
`node server.mjs` by hand in production without DATA_DIR uses `~/.xaucloud-apex`. Two license databases. Silent split.

### SITE-006 — v3.8.3 events are invisible to the UI

**Severity:** MEDIUM  
**Status:** CONFIRMED (no matches in `public/index.html`)

EA now emits `SETUP_LOCATED`, `WATCH_EXTREME_UPDATED`, `PRICE_LEFT_ORIGIN_BOX` (as gate reason).  
Dashboard has no rendering for them. You cannot see “waiting for retest” from the phone.

### LIVE-011 — learning flag is on, adjustments are forced zero

**Severity:** LOW-MEDIUM  
**Files:** `learningEnabled: true` in seed; EA `learnEntryAdj`; server `adaptationImplemented:false`  
**Status:** CONFIRMED

Not a live blow-up. The switch is on and does nothing. Do not think the bot is learning on live.

---

## LOW / INFO

| ID | Note |
|---|---|
| LIVE-012 | `InpRequireFreshTrigger` default false, telemetry only. Old compiled Inputs with true no longer block. Good. |
| LIVE-013 | Tester forces `C.armed=true`. Strategy Tester is not live. Do not size live from tester. |
| LIVE-014 | Netting accounts blocked unless `InpAllowNettingAccounts`. Exness hedge is required. Correct. |
| LIVE-015 | Event outbox drops oldest at 2048. Telemetry loss, not trading loss. |
| LIVE-016 | Heartbeat JSON uses `license_key`; this server’s unused route accepts `license` or `license_key`. Fine if xaucloud.io matches EA. |
| SITE-007 | Login throttle 20/IP. Admin token timing-safe compare. Cookies for session. Fine once SITE-002 is fixed. |
| SITE-008 | `package.json` still 3.8.2. Health uses version.json 3.8.3. Cosmetic. |

---

## Already OK (do not re-open)

These were real bugs. They are not the reason to stay off live:

| Item | Evidence |
|---|---|
| NORMAL not sending 200 lots / 30-lot incident | Native tests 40/40; `ComputeVolume` uses money capacity |
| UNLIMITED still aggressive | `unlimited_profile_full_allocation` still 200 in harness |
| Reclaim of swept extreme on first entry | `gate_reclaimed_extreme` |
| Fill before `layers++` | static test |
| CLOSING until `CountPos()==0` | source |
| Single-instance lease | observer-only second chart |
| Transport fail keeps last-good config | `CloudFailure` does not clear `C.armed` |
| Authenticated 401/403 disarms new exposure, still manages exits | `RecordDenial` |
| License first-claim binds MT5 account | `validateEa` |
| Ratchet lock > trigger rejected | CloudSync |

v3.8.3 origin **retest first entry** tests pass:

- newer M1 is legal
- retest in box OK
- chase through box rejected

That part is the right idea. LIVE-001 is the add path using that idea in the wrong place.

---

## Addendum — extra confirmed site bugs (deep pass)

These were found after the first write. Same repo, same commit plus live `https://apex.xaucloud.io/health`.

### SITE-006 — Campaign page is wired to the wrong JSON field names

**Severity:** HIGH · CONFIRMED

`projectCampaign()` emits `cycleStart`, `targetEquity`, `layers`, `basketVolume`.  
UI reads `floatingPL`, `progressPct`, `startEquity`, `currentEquity`, `profitPct`, `totalVolume`.

A real open basket can render **0% / $—** on the phone. Heartbeat already has equity, layers, `campaign_active`. `buildMe()` does not use them for `me.campaign`.

### SITE-007 — EA `emittedAt` is unix seconds; dashboard parses it as ISO

**Severity:** HIGH · CONFIRMED on this server’s ingest

`Emit()` sends `"emittedAt": 1725...` (int). Dashboard `Date.parse` → NaN → 1970. Activity feed and “watching last 20 minutes” break even when events arrive. Hypothesis: xaucloud.io may rewrite `ts`; this repo does not.

### SITE-008 — config hash algorithms cannot match

**Severity:** MEDIUM · CONFIRMED

Server: SHA256 16-hex. EA: FNV-1a 8-hex. Never equal. Dashboard `inSync` uses revision only (OK). Do not add a hash-equality gate.

### SITE-009 — customer Settings can flip UNLIMITED with no admin step

**Severity:** HIGH · CONFIRMED

Any logged-in license can Save `accountProfile=UNLIMITED`. Admin `licenseTier` stays NORMAL. EA follows config, next campaign. One tap on a phone is the unlimited capacity path.

### SITE-010 — `npm test` identity is already stale

**Severity:** HIGH · CONFIRMED

`tests/capacitytruth.test.mjs` still asserts version `3.8.2` / `XauCloud-Apex_v3.8.2-CapacityTruth` / `#property "3.820"`. Source is 3.8.3. The test that was supposed to stop version drift is now itself drift.

### SITE-011 — systemd unit runs as root, no NODE_ENV=production

**Severity:** HIGH · CONFIRMED

`deploy/xaucloud-apex.service` has no `User=`, no `NODE_ENV=production`. Combined with SITE-002 (secret check bypassed), a default `.env` is a public license factory.

---

## Scores (live platform, not entry-theory)

| Area | /10 | Why |
|---|---|---|
| First-entry location (v3.8.3) | 6 | Right model, origin not persisted, prior-update wrong |
| Pyramiding / UNLIMITED adds | **2** | Origin box on adds kills them |
| Sizing truth | 8 | CapacityTruth holds in tests |
| Broker execution hygiene | 8 | Fill/CLOSING/lease |
| Cloud config correctness | 4 | Depends on unseen xaucloud.io + false DELIVERED |
| Dashboard honesty | 3 | Desired state presented as live state |
| Secrets / admin | 2 | Production check bypassed |
| Docs / version identity | 3 | Three versions in one repo |
| **Live go-live** | **3 / 10** | |

---

## Live go-live checklist (after blockers are patched)

Do not skip. In order.

1. Compile **v3.8.3** (`#property version 3.830`). Experts log must say `XauCloud-Apex_v3.8.3-EntryLocation`.
2. One chart only. XAUUSD/XAUUSDm, **hedging** account, Algo Trading on.
3. WebRequest allow `https://xaucloud.io` only.
4. Paste license. Do not set `InpRequireRemoteArm=false` to “just start.” That bypasses the dashboard.
5. Server: `NODE_ENV=production`, real `ADMIN_TOKEN`, real `SESSION_SECRET`, real `APEX_BRIDGE_SECRET`, `DATA_DIR=/var/lib/xaucloud-apex`.
6. Dashboard: set profile **UNLIMITED** or **NORMAL** deliberately. Set NORMAL reference leverage **1:500** if Exness reports 1:2000000000.
7. Arm. Confirm EA log `armed=true` and `account_profile` matches. Dashboard APPLIED revision = DESIRED.
8. Demo first, same broker as live. Watch one full setup: `SETUP_LOCATED` → fill **in the box** → **adds after continuation** → target close.
9. Kill MT5 mid-wait-for-retest. Confirm setup still exists after restart (LIVE-004 must be fixed first).
10. Only then a live account. Same EX5. No mixing v3.8.2 EX5 with v3.8.3 source.

---

## Fix order (if you want this live)

1. **LIVE-001** — origin box first entry only; adds use reclaim + still-below-originHigh.  
2. **SITE-001 + SITE-002** — stop lying about delivery; stop booting with published secrets.  
3. **LIVE-003** — update `prior` when the watched high runs.  
4. **LIVE-004** — persist the confirmed setup.  
5. **LIVE-002 proof** — one real license through xaucloud.io, four checks.  
6. Docs/version identity so you cannot compile 3.8.0 by accident.

I have **not** patched these in this audit. Say the word and I apply 1–4 in the EA/server and send a new `.mq5`.

Until LIVE-001 is fixed, **do not run v3.8.3 UNLIMITED live**. It can take the first ticket and then refuse every add.
