# XauCloud Apex — strategy specification

Source: direct, Chrome-driven review of @tradingcartel1's public TikTok profile
("TradeWithCartel", 88K followers, active since 2023-06, 190+ posts) on 2026-09-03 —
not guessed, not assumed from the earlier reference clips alone. Three videos watched in
full, position-by-position, reading the actual MT5 mobile screen recordings:

- "$13 → $2,000 Breakfast Setup" (**win**, XAUUSDm, M3)
- "$15 → $42,000 Breakfast Setup" (**win**, XAUUSDm, M1/M3)
- "$7 Breakfast to $4,000 Loss: Full Trading Breakdown" (**loss** — grew to $4,000
  floating and gave it all back)

Plus a wide thumbnail-level survey scrolling the entire profile (130+ distinct posts
identified across a 2023–2026 history), which surfaced more "Breakfast Setup"/"Trade
Recap" videos, raw MT5 position-ledger photo posts (exact prices/lots, no narration
needed), a "R.I.P $2,500,000.00" blown-account post, smaller "R.I.P $1" / "R.I.P 0.01$"
posts, BUY-side XAUUSD ledgers, EURJPY/GBPJPY ledgers (he is not XAUUSD-exclusive —
Apex's XAUUSD-only scope is our own choice, not something copied from a limitation of
his), a bulk-close control panel ("Close All Positions / Close Profitable Positions /
Close Sell Positions / Close XAUUSDm Sell Positions"), and viewer comments confirming
"layer" is his own term for the pyramid adds.

## OBSERVED (seen directly, repeated across multiple posts)

**Setup**
- Fast directional impulse into a recent local liquidity extreme (a prior swing
  high/low), marked with a circle or box on the chart.
- A reversal leg follows; entry is on a pullback/retest into a marked zone just below
  (SELL case) the extreme — not the literal wick tip.
- Confirmed on M1 or M3 (both seen, sometimes in the same video).
- Both BUY and SELL examples exist in his history (bearish-exhaustion→buy is real —
  thumbnail-level XAUUSD buy ledgers were seen, though not narrated in the three full
  videos watched).

**Sizing/account mechanic**
- Starting balance is trivially small ($7–$16 in every video watched) on a broker
  account type he explicitly labels **"Unlimited Leverage"** ("Broker I Use | Create 1:
  Unlimited Leverage Account" appears in his own video outro).
- First position size is whatever that tiny balance's free margin allows at max.
- Realized lot sizes on additions are NOT a clean fixed multiple: three independently
  read sequences were 0.5/0.5/0.5/0.5/0.5 (flat), 0.6/0.6/1.0 (~1.7x on the last step),
  and 0.2/0.5/0.5/2/2 (2.5x, then flat, then 4x). The step size varies a lot between
  adds in the *same* campaign. This is consistent with "the requested percentage of
  margin doubles cleanly on paper each time, but the realized filled lot size is capped
  by whatever the broker actually allows at that instant" — i.e. exactly what
  `OrderCalcMargin`-based sizing produces, since free margin itself is a moving target
  that grows as the floating profit grows.
- Every position is a market order, no S/L, no T/P (confirmed directly in the position
  detail panel: "S/L: -, T/P: -").
- Additions happen only while the basket is already floating profitable and price keeps
  moving in the campaign's favorable direction. Never seen adding into a loser.
- Multiple positions sometimes open at the literal same price/moment — looks like rapid
  re-clicking of the trade button in the excitement of a working setup, not necessarily
  one order per discrete new signal.

**Risk reality**
- The "$7 → $4,000 gone" video is the single most important piece of evidence gathered:
  the basket grew to **$4,000 of floating profit and then gave all of it back to zero**
  because it wasn't closed at a target in time. This happened on camera, in his own
  content — not a hypothetical concern.
- Thumbnail-level evidence separately shows a "R.I.P $2,500,000.00" post and smaller
  "R.I.P $1" / "R.I.P 0.01$" posts — first-person acknowledgment of blown accounts on
  this same no-SL, unlimited-leverage approach. Losses are not hidden; they sit publicly
  alongside the win reels.

## INFERRED

- Exact rejection/BOS thresholds (candle counts, wick ratios, the exact width of the
  retest zone he treats as valid) — the videos show marked-up boxes after the fact, not
  his live decision process in measurable units.
- That "request double the margin %, capped by real-time capacity" is the actual
  underlying sizing rule, rather than some other rule that happens to produce
  similar-looking output. Three data points support it; it is not literally proven.
- Whether he operates primarily off M1 or M3 as his real detection timeframe, or
  switches fluidly between the two depending on the setup — both appeared across the
  three videos.

## UNKNOWN

- Full loss history / rate — public posting is still selective even when losses are
  shown; we don't know what fraction of all his campaigns the visible losses represent.
- Exact broker and whether "Unlimited Leverage" is a real standing offer or a
  promotional/cent-account gimmick.
- The literal chart-feature weights he uses mentally (how much a "good" rejection wick
  matters vs. a clean break of structure, etc.).
- What, precisely, made the loss campaign's reversal different from the win campaigns'
  reversals at the moment of the failure — see below.

## WIN vs. LOSS differential

Both win videos showed the price continuing decisively in the campaign's favor for the
full duration observed — no meaningful give-back was visible in the sampled frames. The
loss video's campaign also moved favorably at first (up to $4,000 of floating profit)
before fully reversing and erasing the gain. In other words: **the entry and the initial
follow-through looked the same kind of "working" in the loss case as in the wins** — the
failure was not visibly a bad entry, it was the market's reversal proving temporary (a
correction inside a larger continuing trend) rather than durable, combined with the
basket never being closed at a target before that correction fully unwound.

This is graded as INFERRED, not OBSERVED, because the exact frame where continuation
evidence should have started to look weaker (if it did) was not captured at high enough
resolution in this review to say for certain the setup, and not just the outcome, was
identical to the wins. What *is* directly observed is the consequence: without a target
lock-in, a temporarily-successful reversal campaign can give back its entire gain.

**Practical implication, consistent with "better opportunity recognition, not smaller
trades":** the fix this evidence justifies is not shrinking position size or adding a
stop — it's making sure the equity-target close path is unambiguously correct (see the
Apex forensic audit below) and, longer-term, having the learning brain specifically
learn to distinguish setups whose reversal holds from setups whose reversal is only a
temporary correction, using the feature vector now captured at campaign start.

## What this means for Apex (confirmed against the existing implementation)

1. **Sizing** — keep "request `baseMarginPct * layerMultiplier^layer` of *current* free
   margin, computed via real `OrderCalcMargin`, capped only at 100% of what's free right
   now." Default `baseMarginPct=15`, `layerMultiplier=2`. No artificial secondary cap.
   Already correct in the implementation; account-size-agnostic by construction — the
   same formula produces huge lots on an unlimited-leverage cent account and
   proportionally smaller lots on standard leverage, because `OrderCalcMargin` already
   encodes each account's real leverage.
2. **No SL, no daily drawdown cap, no software risk throttle** — by explicit instruction.
3. **Setup confirmation stays strict.** "No risk management" is not license to skip real
   confirmation — a bad or premature entry is exactly the kind of "small thing that can
   go bad really fast." Keep the multi-stage WATCH → REJECT+BOS CONFIRM → CAMPAIGN state
   machine.
4. **Equity-target close is the single safety-critical path** given the loss video —
   see the forensic audit for the bug found and fixed here.
5. **Learning brain** must track features per completed campaign (impulse magnitude,
   wick rejection ratio, M3/M5 confirmation) joined to outcome, not just an aggregate
   win rate — see the forensic audit for what was fixed.

## Forensic audit: Apex implementation vs. observed trader behavior (2026-09-03)

Answered against the actual EA/backend source, not from memory of the original build.

1. **Detects the same opportunity?** Yes — impulse → sweep of a prior extreme → watch →
   rejection+BOS confirm → campaign matches the observed structure.
2. **Recognizes the setup at the correct stage?** Mostly. Impulse/sweep detection is
   M1-only; the trader visibly operates on M1 *and* M3. This could miss an M3-scale
   setup that doesn't manifest as a strong 7-candle M1 impulse. Flagged, not changed
   this pass — the evidence for exactly how to add an M3-native detection path without
   duplicating/contradicting the M1 path isn't strong enough yet to rewrite core
   detection logic responsibly. Recommend targeted historical-data testing before
   touching this.
3. **Enters too early?** The rejection/BOS scan can, in principle, resolve on the same
   M1 bar that triggers the sweep-watch if that single bar is a dramatic enough
   reversal candle. This is a realistic edge case (V-shaped reversal bars happen) rather
   than a bug — most setups still resolve across multiple bars because `watch` persists
   across ticks until a *later* closed bar shows the rejection. Left as-is; flagged for
   awareness.
4. **Enters too late?** `watchExpiryMinutes=12` is a reasonable default; not directly
   verified against video timing (INFERRED).
5–6. **Confirmation mismatch?** Requiring both a rejection wick *and* a micro-BOS before
   entry matches what's visibly drawn in his breakdowns. No evidence of a required
   confirmation that's missing or spurious.
7–9. **Sweep/reversal/microstructure detection correct?** Directionally matches the
   circled-extreme-then-reversal pattern. Exact lookback windows and buffer sizes are
   INFERRED, not proven; the rejection-zone buffer was a hardcoded magic number
   (`.12*ATR`) — **fixed**: now a configurable, learnable `rejectionZoneAtr`.
10. **Distinguishes genuine reversal from continuation?** Structurally yes at entry
    (requires sweeping an *established* prior level, then real rejection+BOS, not just
    "price moved"). Once a campaign is running, `AddSignal()` has no re-check against
    larger-timeframe trend context before further pyramiding — flagged as the most
    direct link to the loss video's mechanism, but per explicit instruction the fix is
    better *opportunity recognition* (richer confirmation data via the now-expanded
    feature vector, so the learning brain can eventually learn this), not smaller
    exposure.
11–14. **Pyramid logic correct?** Yes — adds require basket profit > 0, don't require a
    new sweep, use continuation-break/failed-pullback confirmation, gated by score
    threshold. Matches the spec and the video evidence.
15–16. **Sizing progression / normal vs. unlimited accounts?** Correct as built —
    percentage-of-current-free-margin via real broker margin math, no hardcoded lot
    table, works on both account types by construction.
17. **Basket target handling correct?** **Bug found and fixed.** The close check used
    raw `ACCOUNT_EQUITY` instead of the campaign's own contribution
    (`cycleStart + BasketProfit()`). Harmless on a perfectly dedicated account with zero
    other activity, but wrong the moment anything else touches the account (another
    EA, a manual trade, a mid-campaign deposit) — and this is precisely the mechanism
    that failed to save the $4,000 in the loss video, so it needed to be unambiguously
    correct rather than "usually correct."
18. **Cycle reset correct?** Yes — next cycle's `cycleStart` is re-based off the new
    account balance after the previous cycle closes.
19. **Is the learning brain genuinely learning?** **No, and this was the biggest real
    gap.** The EA only ever sent `score`, `targetEquity`, `entryPrice` at campaign
    start — never the actual feature values (impulse magnitude, wick ratio, M3/M5
    confirmation) that produced that score. The backend's `learn()` could therefore
    only ever compute one global aggregate win-rate nudge; it structurally could not
    answer "why did this setup work vs. a visually similar one fail," because the data
    to answer that question was never transmitted. **Fixed**: the EA now emits the full
    feature vector at campaign start, and `learn()` joins it to the campaign outcome by
    `campaignId`, bucketing win rate by impulse-strength tercile, wick-ratio tercile,
    and M3/M5 confirmation presence — each bucket only reports a real win rate once it
    has at least 5 samples, otherwise it's explicitly marked
    `insufficient_sample`, so early data can't produce a falsely confident conclusion.
20–21. **Duplicate entries or restart-caused duplicates?** No live duplicate-order bug
    found in the tick-rate/spacing logic. Restart recovery *was* a real bug (fixed in
    the previous audit pass, 2026-09-03 earlier): no local state persistence meant a
    restart mid-campaign reset the layer counter to 0 and froze `lastAdd` at 0 forever,
    silently disabling all further pyramiding. Now saves/loads a local state file and
    recovers from a magic-number-filtered position scan, not a blind
    `PositionSelect(_Symbol)` guess that could grab another EA's position.
22. **Hidden assumptions contradicting observed behavior?** The M1-only detection
    timeframe (#2) and the account-equity-vs-campaign-equity target bug (#17, now
    fixed) were the two real ones found. No BUY/SELL asymmetry — the code is direction-
    symmetric throughout, ready for the BUY-side examples seen in the thumbnail survey
    without further work.

### Changes made this pass
- Basket target check now uses campaign-scoped equity (`cycleStart + BasketProfit()`),
  not raw `ACCOUNT_EQUITY`.
- Rejection-zone buffer is now a configurable `rejectionZoneAtr` (default `.12`, same
  numeric default as before — only the hardcoding was removed) instead of a silent
  magic number.
- Campaign-start telemetry now carries the real feature vector (`impulseMult`,
  `wickRatio`, `m3`, `m5`, `atr`) instead of just the final score.
- Backend `learn()` now joins start/end events by `campaignId` and reports genuine,
  sample-gated per-feature win rates, in addition to the existing bounded aggregate
  score-adjustment mechanism (unchanged).
- Test suite upgraded from pure source-text regex matching to real behavioral tests for
  the backend (`clean()`/`learn()` imported and exercised with synthetic data) alongside
  the existing source-level EA checks.

### Deliberately left unchanged
- Sizing formula and defaults (already correct — see above).
- No SL / no drawdown cap / no cooldown by default.
- Pyramid-add confirmation logic (continuation/pullback-fail + score threshold).
- Add-spacing requirement (`addSpacingAtr`) — video evidence shows some same-price
  re-entries, but requiring real price movement between adds is what prevents the
  documented failure mode of firing duplicate orders off a single stale signal (spec's
  own test case for this), and it's not a risk-limiting change, it's a correctness one.
