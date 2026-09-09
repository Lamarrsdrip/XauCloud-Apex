# Apex v3.8.6 HardenedCapacity status

Current identity: `XauCloud-Apex_v3.8.6-HardenedCapacity` / `#property version "3.860"` / state schema 4.
**Main bot:** `ea/XauCloud-Apex.mq5` (compile this → `XauCloud-Apex.ex5`).
Versioned copy: `ea/XauCloud-Apex-v3.8.6-HardenedCapacity.mq5` (byte-identical).
Historical v3.8.2 snapshot (do not compile): `ea/XauCloud-Apex-v3.8.2-CapacityTruth.mq5`.
WebRequest origin: `https://xaucloud.io`.

Trading = v3.8.2 `if(s.valid) Start(s)`. This build does **not** contain MODEL C origin box,
mandatory retest, dead-thesis filter, or the 3.8.3/3.8.4/3.8.5 setup lifecycle.

`FIXED-IN-SOURCE` means a repair exists in this tree. It is **not** the same as
PROVEN LIVE READY. MetaEditor compile, EX5 attach, and a real-license ARM→applied
round-trip are still required on the operator's terminals.

| Finding | Status | Root cause / repair |
|---|---|---|
| 1 PLACED | FIXED | `TRADE_RETCODE_PLACED` → `EXEC_PENDING` / `CAMP_SUBMITTING`. Not a reject. |
| 2 Late fill | FIXED | `ReconcilePending` / `PromotePendingFill` attach the fill to the fenced campaign. |
| 3 Duplicate resend | FIXED | `g_pending.active` blocks OpenLayer / ComputePreflight while unresolved. |
| 4 SUBMITTING | FIXED | `CAMP_SUBMITTING` until broker fill or history cancel/reject/expire. |
| 5 WAF 401/403 | FIXED | HTML/edge is transport. Only XauCloud JSON denial tombstones. |
| 6 Cloud after Manage | FIXED | OnTimer: ReconcilePending + Manage first; CloudSync XOR flush; 1200ms budget. |
| 7 Duplicate manager | FIXED | Cloud lease + same-terminal GlobalVariable. Partition does not mint a second manager. |
| 8 Restart recovery | FIXED | Schema 4 persists campaign + pending + setup. Reconcile against broker before new exposure. |
| 9 Corrupt state | FIXED | LoadState -1 → broker position scan. Foreign ownerKey rejected. |
| 10 Durable outbox | ALREADY IN 3.8.2 | Event queue file restored before recovery emits. |
| 11 Dashboard truth | FIXED | desired vs applied; BRIDGE_NOT_CONFIGURED is never DELIVERED. |
| 12 Revision sync | ALREADY IN 3.8.2 + kept | commandRevision is the sync authority. |
| 13 WebRequest URL | FIXED | `https://xaucloud.io` only. |
| 14 Production secrets | FIXED IN SOURCE / MUST NOT TAKE SITE DOWN | Helper refuses defaults. Listen unless `APEX_STRICT_SECRETS=1`. |
| 15 systemd | FIXED | DATA_DIR unit. Do not set `User=xaucloud-apex` until that user exists. |
| 16 Campaign fields | FIXED | `decorateCampaign` maps real fields. |
| 17 Timestamps | FIXED | unix seconds stay seconds. |
| 18 Seed completeness | ALREADY OK | config seed includes reference leverage / caps. |
| 19 UNLIMITED auth | FIXED | entitlement, not a customer toggle. |
| 20 Close persistence | FIXED | CLOSING until `CountPos()==0`. |
| 21 Broker close/modify truth | FIXED | retcode + live position/deal, not CTrade boolean. |
| 22 Uncertain identity | FIXED | recovered positions `anchorsKnown=false` → no new pyramid. |
| 23 Single-source identity | FIXED | README / package / version.json / EA `#property` / APEX_VERSION all 3.8.6. Main file is `ea/XauCloud-Apex.mq5`. |
| 24 MetaEditor compile | BLOCKED HERE | Linux sandbox has no MetaEditor. Operator must compile `ea/XauCloud-Apex.mq5` and record EX5 hash. |

Sizing functions `ComputeVolume` and `LayerMarginPct` remain byte-identical to archived v3.8.2.

---

# Apex v3.8.5 LivePlatform status (historical, NOT this release)

Current identity was `XauCloud-Apex_v3.8.5-LivePlatform` / `#property version "3.850"` / state schema 5.
That release changed entry rules (origin retest / MODEL C). **Do not compile it.**

| Finding | Status | Root cause / repair |
|---|---|---|
| LIVE-001 | 3.8.4-only | Adds used `a.execHigh/Low`. Not in 3.8.6. |
| LIVE-005 | superseded | Identity is now 3.8.6. |
| SITE-010 | superseded | Tests assert 3.8.6 / 3.860. |

---

# Apex v3.8.0 Fix Status (historical)

Audit base: `0db61f929b006c6834746b7b1096cdf7b2bc7630`
Claude WIP: `6cd304a72fa0823e6385aa0bf17dd944a37d3afd`
