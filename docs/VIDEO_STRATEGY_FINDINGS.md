# Video-derived strategy findings

Source: live review of @tradingcartel1's public TikTok profile (2026-09-03), specifically
the "Breakfast Setup" trade-recap series — his own recurring branded format for this exact
setup. Two videos were watched in full:

- "$13 → $2,000 Breakfast Setup" (video 7673717591147351304, posted 8-14)
- "$15 → $42,000 Breakfast Setup" (video 7673330705845226770, posted 8-13)

Both show real MT5 mobile screen recordings (broker symbol `XAUUSDm`, an Exness-style
cent/unlimited-leverage account type per his own comment-section replies), not simulated
or illustrative footage.

## OBSERVED (seen directly, repeated across both videos)

- Starting balance is trivially small ($13.98 and $15.98) on an "unlimited leverage"
  account type — first-position lot size (0.5 and 0.6 respectively) is only achievable
  because of that leverage, not because of a fixed % of a normal-sized account.
- Setup: fast directional impulse into a recent local extreme; he circles/boxes that
  extreme on the chart; a reversal leg follows; he marks a smaller box/order-block just
  below (video 1) or right at (video 2) the extreme as his actual entry trigger zone —
  i.e. entry is not at the exact wick tip, it's on a pullback/retest into a marked zone
  after the sweep.
- Both observed setups were SELL campaigns (bullish exhaustion → sell reversal). No BUY
  example was captured in this session — see UNKNOWN below.
- Every position opened is a market order with no stop loss and no take profit set
  (S/L: -, T/P: - visible in the position detail panel).
- Additions happen only while the basket is already floating profitable and price
  continues moving in the campaign's favor — never while losing.
- **Lot sizing on adds does NOT follow a fixed doubling ladder.** Video 1: five sells all
  sized 0.5 (identical size repeated: 0.5, 0.5, 0.5, 0.5, 0.5). Video 2: 0.6, 0.6, then a
  jump to 1.0 on the third add (≈1.67x, not 2x). The common thread is each add appears to
  use roughly the maximum size the account's currently available margin/equity supports
  at that moment, not a preset multiplier — video 1 didn't need to step size up because
  equity hadn't grown enough yet; video 2's larger jump lines up with equity having
  grown substantially by the third add.
- Multiple positions sometimes open at the exact same price/moment (video 1 shows three
  sells all at 4358.788) — consistent with rapid manual re-clicking of the sell button
  rather than one order per discrete confirmation event.
- The campaign is managed as one basket; the video ends on a "Copy My FREE Signals /
  Link in Bio" monetization CTA rather than lingering on a final closed-basket screen —
  neither watched video captured the literal moment of full-basket close in this session.

## INFERRED (plausible, not directly proven)

- The specific chart features used to time entries (which candle patterns/timeframe
  count as "rejection," how many bars, wick-ratio thresholds) — the videos show the
  drawn boxes and arrows after the fact, not the live decision process. v2's
  rejection/BOS detector is a reasonable codification of what's drawn, not a proven
  replica of his exact internal rule.
- That add sizing is genuinely "max available margin at that instant" rather than some
  other rule that happens to look similar (e.g. a mental percentage he eyeballs). Two
  data points support the margin-driven read but don't prove it.
- Symmetry: whether he trades bullish-exhaustion→buy reversals with the same rules. Not
  observed in this session.

## UNKNOWN

- Full loss history / whether losing setups that never reverse are ever shown (survivorship
  bias in what gets posted is likely but unquantifiable from public content alone).
- Exact broker, account size class, and whether "unlimited leverage" is a real live
  offering or a promotional cent-account gimmick.
- The literal final close price/equity and realized P&L breakdown for either video (not
  captured before the CTA loop in this pass).
- Any BUY-side (bearish-exhaustion→buy) example — none surfaced in the two videos reviewed.

## Implication for the v2 implementation

v2's `layerMultiplier=2` (strict 15%→30%→60%→100% doubling every layer, unconditionally)
is an assumption, not something these two videos support. The evidence instead points to
"size each add near the current max the broker will allow," which is closer to
`baseMarginPct` applied against *current* free margin every time (flat percentage of a
growing number) than to an escalating multiplier on top of that. This needs a decision
from the account owner before changing default behavior — flagged separately, not
silently changed here.
