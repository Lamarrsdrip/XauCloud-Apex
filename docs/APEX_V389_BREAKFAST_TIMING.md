# Apex v3.8.9 BreakfastTiming

Compile `ea/XauCloud-Apex.mq5`. Versioned copy is
`ea/XauCloud-Apex-v3.8.9-BreakfastTiming.mq5` (byte-identical).

Sizing, leverage, pyramid, ratchet and exits are **unchanged from v3.8.8**.
This build only changes **when** a breakfast setup becomes executable.

## What testers saw vs demo

Testers printed occasional full-impulse V-reversals, so the old detector looked
fine. Demo sat on "setup found" for a long time, then entered the one bar that
finally satisfied the old rule — already far from the zone — and lost straight.

The breakfast videos do not wait for that bar. They mark the swept extreme,
take the failed hold / displacement while price is still at that area, then add
only after the basket is working.

## What was actually too strict (score was not it)

Default `entryScore` is still **76**. Once rejection + BOS + M3 pass, the
ranking floor is already ~79, so lowering the score would not have confirmed
faster. The dashboard "waiting" line was almost always `REJECTION` or
`M3_CONFIRM`.

1. **Rejection required a V-reversal of the whole impulse.** One M1 candle had
   to tag the swept extreme **and** close through the pre-impulse prior
   (`close < prior` on the same bar). After a 1.8 ATR run that prior is the
   *start* of the move, not the liquidity pool. Live gold almost never prints
   that candle at the right time.
2. **M3 was a hard wait.** After M1 already reversed, the bot still waited for
   the M3 candle to flip and close beyond its midpoint. That wait killed the
   fresh-trigger bar (`InpRequireFreshTrigger`), so the original confirm was
   missed. The next bar that could confirm was late and usually bad.
3. **Liquidity was max/min of bars 9–79**, not a nearby swing.

## What v3.8.9 does

| Gate | v3.8.8 | v3.8.9 |
|---|---|---|
| Liquidity | rolling 9–79 | swing 9–40, rolling 9–40 fallback |
| Rejection | same-bar tag AND close through prior | tag AND (failed hold of the extreme OR close through prior) |
| M3 | required colour + midpoint | required unless strong M1 displacement and M3 is not strongly against |
| Late entry | allowed (GATE_SHADOW) | refused if confirm close is already > 1.50 ATR from the swept extreme |
| Score | 76 | 76 |
| Watch window | 5 bars / 12 min | 8 bars / 20 min |
| Rejection zone | 0.12 ATR | 0.25 ATR |

Entry is still `if(s.valid) Start(s)` on the confirm bar. We did **not** bring
back MODEL C "wait for a retest of the dump candle" — that would have made
demo even slower.

## Circled chart points

The demand bounces (sweep of lows, then a hold and grind up) now match BUY
rejection: a bar that tags the swept low and closes back above it. The old
rule wanted that same bar to also close above the pre-impulse prior, which a
real bounce almost never does.

If L1 now fires at that bounce, continuation adds can use the later pullbacks
the way the pyramid already works.

## Dashboard

New compiled/server defaults: `rejectionBars=8`, `watchExpiryMinutes=20`,
`rejectionZoneAtr=0.25`. If a live license already has an older saved config,
push these three values (or re-save) so the cloud poll does not keep 5 / 12 /
0.12. The failed-hold + M3-bypass logic is in the EA and works even on old
numbers.

Do not turn `requireM5Context` on unless you want even fewer confirms.
