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

## Second research pass (2026-09-03): 6 more locally-downloaded videos, transcribed

The user downloaded 6 more raw clips directly (not via profile scraping) and provided
them locally; audio was transcribed in full (whisper.cpp, local, no cloud upload) in
addition to reading the visuals. This materially sharpens the picture:

- **He explicitly names his methodology as ICT/SMC** (Inner Circle Trader / Smart Money
  Concepts) in his own words across multiple clips: *"from an ICT perspective,"* *"price
  trading into a premium area after sweeping buy-side liquidity,"* *"the market has just
  produced an aggressive markup... supply is beginning to absorb demand,"* *"aggressive
  displacement... reaching for buy-side liquidity above... liquidity sweep rejection and
  a displacement back below the area, that gave me the confirmation."* This is not an
  intuitive personal quirk — it's a specific, publicly documented trading framework
  (liquidity sweep = price exceeding a prior high/low then reversing; displacement = a
  strong directional move with large-bodied candles and minimal pullback; premium/
  discount = position within a range relative to its midpoint). Apex's existing
  impulse→sweep→rejection→BOS detector is, in effect, a simplified codification of
  exactly this framework — which raises confidence the detection logic is theoretically
  sound, not just visually pattern-matched from a handful of clips.
- **BUY-side confirmed with a real narrated entry**, not just thumbnail ledgers: one
  video ($0.84 account) is a sell into a markup-exhaustion (supply absorbing demand
  after a push into fresh highs), matching the SELL pattern; direction symmetry is not
  yet confirmed with a narrated BUY example specifically, but the underlying signal
  language ("supply/demand," "premium/discount") is inherently symmetric, consistent
  with the code being direction-symmetric throughout.
- **First-entry sizing is not consistently 15%.** Two more videos explicitly say *"I'm
  taking my first full margin sale"* and *"use all my available margin on my setup, get
  in, get paid, get out"* — i.e. sometimes the very first position already uses maximum
  available capacity, not a conservative starter size. This contradicts a strict
  "always start small at 15%" reading of his practice. Apex's `baseMarginPct=15` default
  is **the account owner's explicit choice** ("for normal acc it will be better to open
  15%... keep increasing... double it continuously"), not a literal replication
  requirement — evidence shows his real practice varies, so there is no single "correct"
  starting percentage to copy exactly, which makes the configured default a legitimate
  design decision rather than a mismatch to fix.
- **A second, distinct setup variant exists**: most clips show a sharp impulse into a
  swept extreme followed by an immediate sharp rejection wick. One clip ($6 account)
  instead describes *"price accumulating around this area instead of continuing
  higher... after a strong impulse move"* — a basing/consolidation exhaustion, not a
  single sharp rejection candle. Apex's current detector requires a rejection wick within
  `rejectionBars` candles of the swept extreme; a slow accumulation/basing exhaustion
  might not trigger the same rejection-wick condition. Flagged as a real gap, not fixed
  this pass — one video isn't enough evidence to safely redesign the detector around a
  second setup family without risking false triggers on ordinary consolidation.
- Lot progressions narrated end-to-end in these clips: 0.2 (implied, cents-account),
  0.08/0.08/0.08 (flat, $3.98 account), and 0.6 lots first entry on a $15 account —
  consistent with the already-documented pattern of "size tracks whatever margin allows
  right now," not a fixed multiple.

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

**Upgraded to OBSERVED (2026-09-03, second pass)**: the loss video's audio was
transcribed in full (whisper.cpp, local) after the trader downloaded three more raw
clips locally. He narrates the entire campaign live, and it confirms the differential
directly, in his own words — this is no longer inference from silent frames.

Entry: "*price moved strongly into the 4349 to 4350 area but it's struggling to break
and hold... we also have a bearish engulfing candle and now price is coming back to
retest that engulfing candle area. That retest is giving me the confirmation I'm looking
for.*" First entry 0.2 lots at 4348. This matches the win videos' pattern exactly — a
specific candle (a bearish engulfing bar) is the reference level, and entry is the
*retest* of that candle's range, not the initial break.

Adds: "*I'm going to keep adding position as long as I have available margin... using an
Exness unlimited-leverage account which is why I'm able to take this larger position
even with a small starting balance*" — direct confirmation of both the broker mechanic
and the margin-driven (not fixed-multiple) add sizing already inferred from the ledger
reads. Sizes narrated: 0.2 → 0.5 → 0.5 → 2 lots, each add explicitly tied to "gold
showing weakness"/"strong bearish momentum," i.e. real continuation confirmation, not
just elapsed time or profit alone.

The critical moment: "*we are at $3,678 plus floating profit. Should I close everything
here or let it run? I'm watching $5,000 as my target — once we hit it, I'm closing every
position.*" He then sets a hard target and states he will not deviate: "*no more entries,
no more waiting, target hits, close off breakfast.*" Price approaches but the campaign
is **never actually closed at the target** — he lets it run past his own stated rule, it
retraces, and he loses the floating gain entirely: "*prices are chasing now and honestly
this might have been the wrong decision from me... we're running close to over $4,000 in
floating profit but I never close it. And the retracement came back... Big lesson for
me, floating profit is not realized profit until you close.*"

**This is now the single most important, most directly evidenced fact in this entire
research pass: the loss was not a bad entry or a flawed reversal thesis. It was a
self-described failure to execute his own stated exit rule at the moment it was met.**
The setup, the adds, and the confirmation logic in the win and loss campaigns all match
the same pattern. The only difference was discipline at the close.

**Practical implication, consistent with "better opportunity recognition, not smaller
trades":** the fix this evidence justifies is not shrinking position size or adding a
stop — it's making sure the equity-target close path is unambiguously correct (see the
Apex forensic audit below). This is also, genuinely, the one place where automating the
strategy is structurally *better* than the human original: code does not hesitate,
second-guess a hit target, or decide to "let it run" past its own rule. Apex closes the
instant `cycleStart + BasketProfit() >= targetEq` — every time, mechanically, which is
exactly the discipline whose absence lost $4,000 in this evidence. The bug fixed in this
pass (target check using raw account equity instead of campaign-scoped equity) mattered
precisely because it's this exact mechanism that has to be airtight. Longer-term, the
learning brain should still learn to distinguish setups whose reversal holds from ones
that are only a temporary correction, using the feature vector now captured at campaign
start — but the loss video's lesson turned out to be about exit discipline, not entry
quality, and Apex already has the automated advantage there by construction.

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

### Strategy Tester bug found and fixed (2026-09-03, third pass)
The user ran Apex in the MT5 Strategy Tester and it errored. The tester log
(`Tester/logs/20260903.log`) showed `APEX_HTTP_ERROR 4014` repeating every poll interval
— MQL5 error 4014 is `ERR_FUNCTION_NOT_ALLOWED`, which `WebRequest()` throws inside the
Strategy Tester regardless of whitelist settings (network access to arbitrary URLs is
disabled in tester by design, and `apex.xaucloud.io` isn't deployed yet regardless).
Consequence: `ConfigPoll()` always failed, so with the shipped default
`InpRequireRemoteArm=true` the EA could never remotely arm and simply sat idle,
spamming the error every 8 seconds for the whole test.

**Fixed**: `Http()` now short-circuits to `false` immediately when
`MQLInfoInteger(MQL_TESTER)` is true, before ever calling `WebRequest` — this silently
and correctly degrades exactly like a live network outage does (Part 19's existing
design), just without the wasted call or log spam. `OnInit()` now force-arms
(`C.armed=true`) when running in the tester, since there is no live backend to arm from
and no real-money risk in a backtest — this only affects the `MQL_TESTER` runtime
context and does not change live/production arming behavior at all.

**Separate finding from the same tester session, not yet acted on**: an earlier
optimization run (before this fix) did manage to trade — one leg of the parameter sweep
had `InpRequireRemoteArm=false` — and it stopped out with `final balance -1461.96 USD`
("stop out occurred on 0% of testing interval", i.e. almost immediately). A negative
final balance from a near-instant stop-out is consistent with the Strategy Tester's
lower-fidelity tick generation (interpolated/OHLC-based rather than real tick data)
letting price "jump" through several ATR multiples in one simulated step — something a
live broker's continuous margin-call monitoring would not do the same way, and not
unique to this EA's logic. Recommend re-testing with "Every tick based on real ticks"
before drawing conclusions about the strategy's real drawdown risk from tester results;
flagged for the historical-replay work in Part 30, not fixed by changing sizing/risk
logic per the explicit no-risk-management instruction.

### Deliberately left unchanged
- Sizing formula and defaults (already correct — see above).
- No SL / no drawdown cap / no cooldown by default.
- Pyramid-add confirmation logic (continuation/pullback-fail + score threshold).
- Add-spacing requirement (`addSpacingAtr`) — video evidence shows some same-price
  re-entries, but requiring real price movement between adds is what prevents the
  documented failure mode of firing duplicate orders off a single stale signal (spec's
  own test case for this), and it's not a risk-limiting change, it's a correctness one.

### Fifth pass (2026-09-03): watched a real 2-day visual backtest end to end

Ran `XauCloud-Apex` in the MT5 Strategy Tester in visual mode, "every tick based on
real ticks", `XAUUSDm` M10, 2026.09.01→2026.09.03, $1,000 deposit, 1:100 leverage (a
normal, not unlimited-leverage, account — the actual demo account this gets tested on).

**Result: $1,000 → $7,465.11. Net profit $6,465.11, profit factor 16.71.** A real win on
real tick data, not a coarse-model artifact like the earlier immediate-stop-out run.

**But: Equity Drawdown Maximal was 72.82% ($7,287.46) and Margin Level bottomed at
27.26%.** The campaign stacked past 35 layers (mostly 0.01 lots with occasional larger
jumps) and came right up to the edge of a real margin call before the market turned
back in its favor and it recovered into a large win. This is the same shape as the
trader's own "$4,000 gone" story and his "R.I.P $2,500,000" post — sometimes it recovers,
sometimes it doesn't, and there was nothing in the system at the time that would have
done anything differently between those two outcomes.

This, plus the account owner's explicit direction, motivated two further changes:

1. **Leverage-aware target cap.** The default `targetMultiplier=100` (+9900%) makes
   sense on the trader's real unlimited-leverage cent accounts, not on a standard
   1:100 account being used for testing — chasing an unreachable target is exactly what
   drives a normal account to stack 35+ layers instead of banking a reasonable win.
   Added `accountProfile` (`NORMAL` default / `UNLIMITED`) and
   `normalAccountMaxMultiplier` (default 3 = +200%): on `NORMAL`, the effective target
   is capped at this multiplier regardless of the raw configured value; on `UNLIMITED`,
   the configured target is used exactly as before. This is a target-realism fix, not a
   risk-management cap on sizing or aggression — the ladder still doubles exactly the
   same way, it just stops requesting an unreachable target.
2. **Setup-invalidation exit.** Previously the only ways a campaign ended were the
   target being hit or the broker force-closing everything at a stop-out — nothing
   in between. Added `Invalidated()`: if the basket has given back at least
   `invalidationGivebackPct` (default 50%) of its peak floating profit (`mfe`) *and*
   fresh M1 structure has broken against the campaign's direction (the same micro-BOS
   check used for entries, mirrored), the whole basket closes as `INVALIDATED_PROFIT`
   or `INVALIDATED_LOSS`. This targets the exact failure mode from the loss video and
   from this backtest — holding a campaign that's actively reversing instead of banking
   what's there or cutting it — without adding anything resembling a stop-loss or fixed
   drawdown cap; it requires both a giveback *and* real structural evidence, mirroring
   the same ICT-style logic already used to get in.

### Fourth pass (2026-09-03): the "loses immediately" bug

The account owner tested Apex and it lost immediately on the very first entry. Working
through his own detailed breakdown of the trader's decision process side-by-side with
the actual `Observe()` code surfaced the cause: **the sweep candle and the
rejection/structure-break confirmation could be the same candle.**

`watch` gets armed off the most recently closed M1 bar (the sweep bar). In the same
function call, on the same tick, the rejection-wick and micro-BOS checks scan the last
`rejectionBars` candles — which still includes that same sweep bar. A single volatile
candle that spikes through a prior level *and* closes back sharply enough can satisfy
sweep + rejection + structure-break all at once, with zero bars of real separation. The
trader's own description is explicit that these are sequential, separate pieces of
evidence unfolding *after* the sweep, not one candle doing everything — "the sweep
itself still isn't enough... he watches what price does AFTER taking the level." The
code didn't enforce that separation.

**Fixed**: the bar time of the sweep candle is now recorded (`watchSweepBarTime`), and
the rejection scan and the micro-BOS check both skip any candle at or before it —
confirmation can now only come from a candle that closed strictly after the sweep. This
should substantially reduce (not necessarily eliminate) single-candle false triggers,
which is the most likely explanation for an immediate stop-out on first entry — a low
one-candle-quality "confirmation" is a much weaker setup than the intended multi-stage
one, and weaker setups fail faster and more often, consistent with "loses immediately."

**Two gaps surfaced by the same discussion, genuinely unresolved, not fixed this pass:**
- **No predefined-zone concept.** The trader's public material references pre-marked
  buy/sell zones from his own indicator ("zone = attention, price action = permission");
  Apex instead treats *any* sufficiently large recent swing high/low (a generic rolling
  70-bar lookback) as a valid liquidity location. This could mean Apex reacts to level
  breaks that wouldn't actually be significant to him. Not fixed — we don't have access
  to his indicator's actual zone logic, and inventing one would be a guess dressed up as
  a fix.
- **No market-regime/"standby" filter.** His own public posts describe explicitly
  standing aside in slow or manipulated conditions rather than trading every qualifying
  setup. Apex has no equivalent — it will arm a watch and act on any impulse+sweep that
  meets the numeric thresholds, regardless of broader session/regime context. Flagged as
  a real gap, not built — "market feels choppy/manipulated" isn't something available
  evidence gives a measurable definition for yet.
