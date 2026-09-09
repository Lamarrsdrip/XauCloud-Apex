# Apex v3.8.5 LivePlatform status

Current identity: `XauCloud-Apex_v3.8.5-LivePlatform` / `#property version "3.850"` / state schema 5.
Canonical source: `ea/XauCloud-Apex.mq5` (byte-identical to `ea/XauCloud-Apex-v3.8.5-LivePlatform.mq5`).
WebRequest origin: `https://xaucloud.io`.

`FIXED-IN-SOURCE` means a repair exists in this tree. It is **not** the same as
PROVEN LIVE READY. MetaEditor compile, EX5 attach, and a real-license ARM→applied
round-trip are still required on the operator's terminals.

| Finding | Status | Root cause / repair |
|---|---|---|
| LIVE-001 | ALREADY FIXED (v3.8.4) | Adds use `a.execHigh/Low`, not the first-entry origin box. |
| LIVE-002 | NEEDS LIVE PROOF | Architecture is xaucloud.io bridge by design. End-to-end ARM proof is operator-side. |
| LIVE-003 | ALREADY FIXED (v3.8.4) | Watching extreme update sets `S.prior = previous S.extreme`. |
| LIVE-004 | FIXED | Schema 5 persists setup; restore only if account/symbol/magic/schema match and snapshot is still valid. |
| LIVE-005 | FIXED | README / package / version.json / EA identity all 3.8.5. |
| LIVE-006 | FIXED | Manage first; CloudSync XOR event flush; 1200ms tick budget; config GET deferred if heartbeat used the budget. |
| LIVE-007 | FIXED | During `CAMP_ACTIVE`, Observe may only arm same-direction (reversal-add). Opposite thesis does not mutate S. |
| LIVE-008 | FALSE POSITIVE / WATCH | Bid-in-box vs ask-reclaim is the intended spread handling. |
| LIVE-009 / LIVE-020 | ALREADY FIXED (v3.8.4) | Schema-3 active → `anchorsKnown=false`, new exposure blocked. |
| LIVE-010 | FIXED | Seed `data/config.json` now includes `normalReferenceLeverage`, `maxBasketLots`, `minMarginLevelPct`, `marginReservePct`. |
| LIVE-011 | ALREADY FIXED | Learning is OBSERVATION_ONLY; adjustments forced to zero. |
| LIVE-012–016 | ALREADY OK | Tester arm, netting, outbox cap, heartbeat license_key. |
| LIVE-017 | FIXED | WAF/HTML 401/403 is transport. Only an authenticated XauCloud JSON envelope tombstones. |
| LIVE-018 | FIXED | Cloud manager lease in config envelope; fail closed on partition; GlobalVariable remains same-terminal fence. |
| LIVE-019 | ALREADY FIXED (v3.8.4) + schema 5 | Confirmed expiry uses `confirmedAt`; `waitingLocationSince` stored. |
| LIVE-021 | FIXED | `TRADE_RETCODE_PLACED` → `CAMP_SUBMITTING` / pending fence; late fill attaches; no resend. |
| LIVE-022 | ALREADY FIXED (v3.8.4) + schema 5 | Dead-thesis identity persisted, not a time cooldown. |
| SITE-001 | FIXED | `BRIDGE_NOT_CONFIGURED` / `QUEUED_FOR_BRIDGE` / `BRIDGE_DELIVERED` / `EA_APPLIED`. Never DELIVERED on null. |
| SITE-002 | FIXED | `assertProductionSecrets()` on `NODE_ENV=production`. systemd sets it. |
| SITE-003 | FIXED | Account setup WebRequest is `https://xaucloud.io`. |
| SITE-004 (live hung bridge) | BLOCKED | Production box not reachable from this sandbox. |
| SITE-005 (multiplier no-op) | FIXED | Hidden; UNLIMITED = 100% of current remaining executable capacity. Sizing unchanged. |
| SITE-005 (persistence path) | ALREADY OK | systemd `DATA_DIR=/var/lib/xaucloud-apex`. |
| SITE-006 (events + campaign fields) | FIXED | `decorateCampaign` maps real fields; missing stays null/—; SETUP_LOCATED rendered. |
| SITE-007 | FIXED | `canonicalizeTimestamp` treats unix seconds as seconds. |
| SITE-008 | FIXED | Revision is sync authority. Hashes are not compared for inSync. |
| SITE-009 | FIXED | Customer cannot set UNLIMITED unless `licenseTier`/`unlimitedEntitled`. |
| SITE-010 | FIXED | Tests assert 3.8.5 / 3.850. |
| SITE-011 | FIXED | systemd `User=xaucloud-apex` + `NODE_ENV=production`. |

Sizing functions `ComputeVolume` and `LayerMarginPct` remain byte-identical to v3.8.2.

---

# Apex v3.8.0 Fix Status (historical)

Audit base: `0db61f929b006c6834746b7b1096cdf7b2bc7630`
Claude WIP: `6cd304a72fa0823e6385aa0bf17dd944a37d3afd`

`FIXED-IN-SOURCE` means a repair exists in the v3.8 source; it does not mean the
production EX5/runtime has been independently certified.

| Finding | Status |
|---|---|
| 001 | FIXED-IN-SOURCE — final executable-price / reclaimed-extreme / stale-trigger checks |
| 002 | PARTIAL — telemetry queued and risk first; same-EA MQL WebRequest remains single-threaded |
| 003 | FIXED-IN-SOURCE — explicit setup invalidation/re-arm lifecycle |
| 004 | FIXED-IN-SOURCE — add trigger identity/consumption |
| 005 | FIXED-IN-SOURCE — separated add eligibility families |
| 006 | FIXED-IN-SOURCE / POLICY UNCHANGED — explicit BOS; no invented reweighting |
| 007 | FIXED-IN-SOURCE — optional M3/M5 no longer fatal when filter is off |
| 008 | FIXED-IN-SOURCE — broker deal/position/SL reconciliation |
| 009 | FIXED-IN-SOURCE — volume-grid/budget/preflight + 200-lot regression |
| 010 | FIXED-IN-SOURCE — persistent CLOSING until zero owned positions |
| 011 | FIXED-IN-SOURCE — versioned/checksummed account+broker+symbol+magic state |
| 012 | FIXED-IN-SOURCE — NORMAL L1/L2/L3 and approved controls wired to runtime config |
| 013 | FIXED-IN-SOURCE — monotonic persisted earned floor |
| 014 | OWNER POLICY NOT ENABLED — no new exposure rule enabled by default |
| 015 | FIXED-IN-SOURCE — authenticated denial tombstone; transient failure keeps last-good |
| 016 | FIXED-IN-SOURCE — typed config parsing, staged apply, stale revision rejection |
| 017 | FIXED-IN-SOURCE — canonical event/ACK projection |
| 018 | FIXED-IN-SOURCE — real readiness/margin/positions/config telemetry |
| 019 | FIXED-IN-SOURCE — allowlisted config schema / protected envelope |
| 020 | PARTIAL — atomic files/outbox/revision/in-process serialization; distributed transaction proof remains deployment-dependent |
| 021 | FIXED-IN-SOURCE — bounded bridge calls; startup not bridge-blocked |
| 022 | FIXED-IN-SOURCE — shared expiry/account-binding policy |
| 023 | FIXED-IN-SOURCE — execution profile aligned; NORMAL default |
| 024 | PARTIAL — production weak-secret refusal + auth throttling; deployment secret/service-user proof is operational |
| 025 | FIXED-IN-SOURCE — xaucloud.io bridge + current routes + canonical v3.8 metadata |
| 026 | FIXED-IN-SOURCE — learning explicitly OBSERVATION_ONLY |
| 027 | FIXED-IN-SOURCE — single-manager lease / observer-only second instance |
| 028 | FIXED-IN-SOURCE — campaign policy snapshot / predictable effective-from behaviour |

## Post-audit live finding

`POST-AUDIT-LIVE-001`: v3.7.1 attempted `BUY 200.00` and `SELL 200.00` XAUUSDm
on an Exness demo NORMAL account and received `[not enough money]`.

v3.8 removes the `SYMBOL_VOLUME_MAX` shortcut, derives NORMAL size from actual
capacity and configured percentage, runs broker preflight, logs sizing locally, and
does not advance campaign/layer state without a broker-confirmed fill.

## Owner constraints

- Apex remains independent from XauCloud trading intelligence.
- The xaucloud.io bridge remains intentional.
- NORMAL default / explicit UNLIMITED preserved.
- No daily-loss cap, pause-after-loss, arbitrary fixed lot cap, new indicator,
  Outlook dependency or other unrelated risk policy is enabled.


## Post-audit operational fix — persistent license login

The previous service default stored `licenses.json` and related state under the
application directory. A release replacement could therefore erase the apparent license
database. The final package moves runtime state to `/var/lib/xaucloud-apex`, migrates the
old local data on first use, keeps long-lived license sessions, and revokes a session only
when the user signs out/changes license or the license is no longer ACTIVE.
