# Native replay results — 2026-10-16

Rig: portable MT5 `C:\ApexReplay388` on the VPS, Exness-MT5Trial9 demo data, XAUUSDm, M1 chart, **Model 4 (every real tick)**, one trading day per run. Dates were drawn with a seeded RNG (seed 20261016) from June–September 2026 weekdays, **excluding every date used by earlier Apex research**: 2026-06-11, 07-17, 07-30, 08-06, 08-19, 08-26, 08-31, 09-28. EA input defaults only, plus `InpTesterAccountProfile`. Runner: `run_astra_matrix.ps1`. 88 runs total, all complete.

**What this measures:** native Lifestyle, plus parity between candidate v3.10.0 and baseline v3.8.8. MT5 Strategy Tester forbids `WebRequest`, so Astra cannot run inside it. **No Astra-vs-native performance comparison is claimed here.**

## Parity (baseline v3.8.8 vs candidate v3.10.0)

Identical end balances and deal counts on all 16 paired runs ($1,000 1:200 and $50 1:500, all 8 dates). On 2026-06-11 the normalised setup/sizing/campaign event streams are line-for-line identical (388 lines). Enabling context export did not change trading.

## Results by profile (start → end balance; only days with trades shown, all other days flat)

| Profile | 07-17 | 07-30 | Other 6 days |
|---|---|---|---|
| $1,000 NORMAL 1:200 | **1,996.46 (+99.6 %)**, 10 legs | 956.72 (−4.3 %), 3 legs | no trade |
| $1,000 NORMAL 1:500 | 690.80 (−30.9 %), 4 legs | **−90.18 (wiped)** | no trade |
| $1,000 UNLIMITED (tester 1:2000) | **−1,596.13 (stop-out)** | **−2,235.18 (stop-out)** | no trade |
| $100 NORMAL 1:500 | 67.89 (−32.1 %) | **−3.10 (wiped)** | no trade |
| $100 NORMAL 1:200 | no trade (min-lot margin > 15 % budget) | no trade | no trade |
| $100 UNLIMITED | no trade (simulated 1:200 min-lot margin > budget) | no trade | no trade |
| $50, every profile | no trade (min-lot block) | no trade | no trade |

Negative balances are a tester artefact; a real broker with negative-balance protection would floor at zero.

## Mechanism

The **same two BUY setups** produce opposite results across leverage, because the capacity ladder scales with leverage:

- 07-17 at 1:200: L1 0.07, L2 0.21, L3 0.23 … the basket survives a pullback and runs ≈ +18 for +99.6 %.
- 07-17 at 1:500: L1 0.18, L2 0.54, L3 0.61, L4 0.30 within ≈ 4 of L1; a ≈ 4 pullback triggers the protective basket exit (−30.9 %).
- 07-17 UNLIMITED: L1 0.07 and L2 0.21 (simulated 1:200), then **L3 4.86 lots after ≈ 1.9 favourable** and L4 4.37 lots; a ≈ 4 pullback → broker **stop-out at −84 %**.
- 07-30 UNLIMITED: L3 4.70 lots; ≈ 6.5 adverse → stop-out at −220 % (gap through the stop-out level).

This is the risk the reference trader also runs (margin level 80–150 % in clips 5, 6, 8, and the clip-7 wipe), now reproduced on real ticks. It is **native Lifestyle behaviour, preserved unchanged**, not something Astra introduced.

## Limits

Only 2 of 8 days produced a native setup, so this is two campaigns seen at several leverages: a mechanism demonstration, not a performance estimate. Tester 1:2000 approximates but does not reproduce Exness "unlimited" margin. No commissions/swap modelling beyond the tester defaults.
