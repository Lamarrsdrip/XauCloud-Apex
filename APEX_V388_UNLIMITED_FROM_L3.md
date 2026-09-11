# Apex v3.8.8 UnlimitedFromL3 — UNLIMITED sizing state machine

Date: 2026-09-11
Canonical EA: `ea/XauCloud-Apex.mq5`
Versioned EA: `ea/XauCloud-Apex-v3.8.8-UnlimitedFromL3.mq5` (byte-identical)
`#property version "3.880"` / `APEX_VERSION XauCloud-Apex_v3.8.8-UnlimitedFromL3`
`APEX_STATE_SCHEMA` stays **4** (no new persisted fields; the mode is derived from the persisted filled-layer count).

**Sizing only.** Signals, entry score, M3/M5, the M10 engine, Outlook, campaign direction, exits, protections, license, heartbeat, dashboard, API and notifications are untouched. NORMAL sizing is unchanged: its `ComputeVolume()` branch is byte-identical to v3.8.2 (enforced by a test).

## The rule

| Filled layers | Layer | Mode | Size |
|---|---|---|---|
| 0 | L1 | `SIMULATED_1_200` | 15% × simulated 1:200 capacity |
| 1 | L2 | `SIMULATED_1_200` | 50% × **fresh** simulated 1:200 capacity |
| 2 | L3 | `UNLIMITED` | 100% × actual Unlimited executable capacity |
| 3+ | L4+ | `UNLIMITED_PROFIT_FED` | 100% × actual Unlimited executable capacity |

The mode comes only from `layers`. That count only goes up on a broker-confirmed fill (or a late fill promoted from pending), and on restart it is rebuilt from the broker's positions. Every profile that isn't NORMAL uses this table.

## Root cause of the 30-lot L1

In v3.8.7 every UNLIMITED layer went through the UNLIMITED branch of `ComputeVolume()`, which returns *pct × current broker-executable capacity*. On the Exness unlimited account the client margin model reports 0.00 per lot. That makes both `LargestVolumeWithinMargin()` and `OrderCheck()` approve `SYMBOL_VOLUME_MAX`, so the capacity comes out as 200 lots and L1 = 15% × 200 = **30 lots** on $1,000.

The fix: L1 and L2 no longer go through that engine at all. `ComputeLayerVolume()` is now the only function that sizes a layer. It sends `SIMULATED_1_200` to `ComputeSimulated1200Volume()` and every other mode to `ComputeVolume()`.

## Simulated 1:200 capacity (`ComputeSimulated1200Volume`)

MQL5 can't price margin at a leverage other than the account's own, and on this broker `OrderCalcMargin × realLeverage / 200` gives 0. So the 1:200 margin is built from the contract specification. Here, "1:200" means margin is notional / 200:

```
notional/lot  = contract × price                    (account ccy == profit ccy)
              = price × TICK_VALUE / TICK_SIZE       (otherwise)
rate          = SymbolInfoMarginRate(initial, BUY/SELL) in FOREX / CFDLEVERAGE calc modes, else 1.0
margin200/lot = max(notional × rate / 200, OrderCalcMargin(1 lot))
usedAt200     = Σ open positions on the symbol (any magic): volume × margin200/lot at that side's current price
              + margin of positions on other symbols (ACCOUNT_MARGIN − this symbol's actual margin)
free200       = min(ACCOUNT_MARGIN_FREE, ACCOUNT_EQUITY − usedAt200) − owner reserve
capacity200   = largest broker-grid volume ≤ min(free200 / margin200, VOLUME_MAX, VOLUME_LIMIT room,
                basket cap, server-proven ceiling) whose REAL margin fits free margin and OrderCheck() accepts
final         = floor_to_step(capacity200 × pct) → min-lot only if it fits the 1:200 budget
                → OrderCalcMargin check → final OrderCheck()
```

BUY is priced at the ask and SELL at the bid. In any calc mode that doesn't use leverage, the broker's rate is not applied on top of 1:200, because that rate already contains the broker's own leverage.

## Unlimited capacity (L3+)

This is the existing UNLIMITED branch, unchanged except that it now also respects `SYMBOL_VOLUME_LIMIT`. Capacity is the largest grid volume within free margin, capped by the server-proven ceiling, and it is then confirmed by a binary search on `OrderCheck()`. L3+ requests 100% of that capacity, recalculated before every layer. When the capacity is 0 the layer **waits**: the trigger is not consumed, nothing is sent, and the log line `APEX SIZING WAIT` is written at most once a minute. Once profit or free margin increases, the next eligible scan uses the new capacity in the same campaign, still in `UNLIMITED_PROFIT_FED` mode.

## Server rejection (`RederiveAfterSizeRejection`)

When the server rejects a size, the retry keeps the layer's plan: the same engine and the same percentage. The rejection shows that real capacity is below the volume that was refused, so capacity is re-derived below that volume and the same percentage is applied again. An L1 retry is still 15% of 1:200 capacity. An L2 retry is still 50%. At 100%, the capacity estimate is halved when a retry makes no real progress, so the retries converge. The size is never halved blindly, and there is no hardcoded fallback lot.

## Worked examples (gold 4,400, 100 oz)

- **$1,000 L1:** margin200 = 2,200/lot → capacity 0.45 → **L1 = 0.06 lots**. The old engine gave 30.
- **L2** (price 4,410, equity 1,060, 0.06 open): usedAt200 = 132.30 → free200 = 927.70 → capacity 0.42 → **L2 = 0.21**.
- **L3** (Exness model, 0.27 open): Unlimited capacity = 200 → **L3 = 200 lots**, subject to what the server accepts.
- **L4+** (real 1:2000 margin model): 13.58 → 61.85 → 191.22 lots as profit adds free margin. At 0 capacity the layer waits.

## Consequence worth knowing

At gold 4,400, 0.01 lot needs about $22 of margin at 1:200. With 15%, an UNLIMITED account needs roughly **$147 of equity** before L1 can open at all. Below that, L1 is blocked (`SIMULATED_1_200_CAPACITY_ZERO` / `MIN_LOT_SIMULATED_1_200_…`). A $20 account therefore never opens a campaign.
