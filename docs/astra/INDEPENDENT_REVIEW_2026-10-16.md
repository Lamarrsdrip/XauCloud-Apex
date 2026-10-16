# Independent reference-trader review — 2026-10-16

Reviewer: second engineer (Claude), continuing the Codex research run. Purpose: re-watch the original evidence rather than inherit earlier conclusions, and record what changed.

## Method

- All eight user-supplied MP4s and the unreviewed public X video `2102472067971268712` (Sep 22) were decoded locally.
- Visual pass: 3×3 contact sheets at 6 s (supplied clip 8) or 10 s (all others) over the **full** duration. Every sheet was opened and read. This is sampled viewing, not frame-exhaustive playback.
- Audio pass: every video was transcribed **locally** with whisper.cpp (`ggml-base`). No audio left the machine. ASR mangles prices and lot sizes, so on-screen ticket rows take precedence over spoken numbers.
- Facts below are screen-readable (ticket rows, balances, chart levels). Narration is quoted as the trader's own stated reason. Interpretation is marked as such.

## File ↔ id mapping (Codex ids are used in `data/astra/*.jsonl`)

| File | Codex id | Start balance (displayed) | Outcome shown |
|---|---|---:|---|
| `v14044g50000d9t8jt7og65nj7ini22g.MP4` | clip7 | 7.97 | **Full wipe** (balance/equity 0.00) |
| `v14044g50000d9ilgnnog65reu4g9v00.MP4` | clip4 | 0.84 | Closed ≈ 1,522 floating |
| `v14044g50000d9hbr7fog65vb1cmn0gg.MP4` | clip3 | 10.21 | Closed ≈ 4,260 floating (recording gap) |
| `v1c044g50000d9uib5vog65j25ihv6hg.MP4` | clip1 | 15.98 | Closed ≈ 42,000 claimed |
| `v1c044g50000d9qk0hfog65mfcq2e240.MP4` | clip6 | 6.99 | Closed ≈ 20,700 claimed |
| `v1c044g50000d9gkvqvog65jrmel5qjg.MP4` | clip2 | 3.98 | ≈ 1,462 floating claimed |
| `v1c025g50000d9pug3nog65m3hbdv8rg.MP4` | clip5 | 21.41 | Closed ≈ 6,344 floating |
| `v1c044g50000db0l1ivog65prkpe4950.mp4` | clip8-new | 50.98 | Flat screen 50,730.18 (recording gap) |
| X `2102472067971268712` (Sep 22) | public (new) | 100.80 | ≈ 17,000 claimed |

All balances/outcomes are **displayed or claimed**, not broker-verified. Clips 3 and 8 each narrate a "power outage" gap of several minutes before the result.

## What the trader says he is doing (his own words, ASR)

| Source | Stated entry reason |
|---|---|
| clip7 (4349) | "moved strongly into the 4349–4350 area but it's struggling to break and hold … bearish engulfing … price coming back to retest that engulfing candle area … that retest is giving me the confirmation" |
| clip4 (3336) | "aggressive markup into fresh highs, notice the hesitation, supply is beginning to absorb demand … the explosive move to the highs has already been rejected, price is no longer accepting those higher prices" |
| clip3 (4055) | "premium area after sweeping buy-side liquidity. If sellers begin to show displacement that's where I want to get involved … price has just swept the previous highs" |
| clip1 (4424) | "very aggressive displacement from 4417 towards 4426 … reaching for buy-side liquidity above, instead of accepting above the high price started showing strong rejection … liquidity sweep, rejection and displacement back below" |
| clip6 (4262) | "already aggressively pushed up, but now it's starting to slow down … accumulating around this area instead of continuing higher … after a strong impulse move I'm expecting liquidity to be taken before a possible reversal" |
| clip2 (4456) | "waiting for one thing, a clean sniper setup" (no structural reason stated) |
| clip5 (4189) | "price has already raided the buy-side liquidity above the previous highs and now it's trading back inside the range … premium area … I'm not waiting for the move to happen first" |
| clip8 (4178) | "on the 3-minute, a clear break of structure to the downside with strong bearish displacement taking out the previous lows … small-bodied candles with rejection wicks, price trying to push higher but failing" |
| X Sep22 (4360) | "strong bullish displacement from the lows and pushed back into the previous high area … buy-side liquidity above the recent highs … price has finally entered the exact area I was anticipating" |

Adds, in every narrated video: "I'm going to keep adding as long as the setup continues to hold and I have available margin. Once the margin is exhausted, that's it" (clip7); "until I run out of margin" (clip1, clip8); "use all my available margin on my setup, get in, get paid and get out" (clip2). Exits: a **pre-announced money target** in clips 3, 4, 6, 7, 8 and Sep22, then close everything.

## Observed sequence (screen facts)

1. **Location.** All 9 are SELLs. Eight follow a strong, often near-vertical push into a new high or a prior-high/supply box: clip6 4249→4267 wick top; clip4 spike to ≈3341.5; clip1 4417→4426.8 double top; clip3 circled double top ≈4060.8; Sep22 V-recovery into a 4360–4365 box. Clip5 is a lower high under two drawn supply boxes (4192–4193.5, 4190–4191). Clip8 is the exception family: a **continuation** after an M3 break of the prior lows.
2. **First entry.** Inside a small stall/hesitation box just under the spike top (clip4, clip6, clip1, Sep22), on a shelf break (clip5 4189.247, clip8 4178.353), or on an engulfing retest (clip7 4349.062). Distance below the spike top ranges from ≈0.3 to ≈5. L1 is often a **small probe** (0.2 / 0.08 / 0.02) relative to what follows; some L1s go straight to size (clip8 2 lots on $50, Sep22 3 lots on $100).
3. **Loading.** Most exposure is opened **within 0–2.5 of L1, in clusters at identical or near-identical prices**, often within a minute or two. Examples: clip1 four 0.6 at 4424.308; clip6 two **20-lot** sells at 4261.901 right after a 0.2 probe at 4262.695; clip8 six 2-lot at 4176.042; clip4 dozens of 0.02 from 3336.36 to 3335.2 (67 tickets); Sep22 eight 3-lot within 2.1 of L1. Some fills are slightly *worse* than the previous fill (clip7 4347.855 after 4347.538; clip8 4177.188 after 4177.070).
4. **Basket at add time.** In every readable add snapshot the **basket was already ≥ 0** (clip8 +1.40 narrated then +10.60; clip1 +56; clip6 +0.36; clip5 +145; clip3 +10.65; Sep22 +268) while the **newest legs could be red** (Sep22 two legs −134.70 each). The positive-basket rule in Apex is therefore **consistent with the evidence**, not a conservative deviation from it.
5. **Size follows equity.** Larger lots appear only after floating equity funds margin: clip7 0.2→0.5→2; clip1 0.6→1→20; clip8 2→5; Sep22 3→5→10.
6. **Hold, then target.** After loading, the trader mostly stops adding while the move extends (clip8: no visible ticket for the last ≈15 of an ≈18 move) and closes at a money target.
7. **Leverage regime is fragile.** Margin level during winners: clip6 **81 %** with free margin **−1,589** while +5,976 floating; clip5 138 %; clip8 142–149 % after broker margin jumped from 0.01 to 6,890 then 13,780 mid-trade (consistent with an equity-dependent leverage cap, cause not shown). A small counter-move at these levels ends the account.
8. **Failure.** Clip7: valid-looking L1, adds down to 4342.938 including two 2-lot late adds, floating ≈ +3,400 to +4,000, then retracement and a **0.00 balance** while the last visible price (≈4344.7) is still below L1. The trader: "floating profit is not realized profit until you close." The exact cause of a total wipe at that price is not visible.

## Corrections to the earlier research package

- `clip4-failed-recovery` and `clip6-exhaustion-pause` were labelled continuation families. The trader's narration and the screen show a **spike → hesitation → rejection** setup. Both records are relabelled `UPPER_SWEEP_REJECTION` / evidence family `SPIKE_HESITATION_REJECTION`, with the quote attached.
- Added `new-clip8-full-exposure-ladder` (campaign sequence) and `clip7-full-wipe-below-entry` (failed campaign).
- The earlier framing "adds follow proof one event at a time" understates the trader: one piece of proof is exploited by a **burst** of same-price tickets, then exposure is frozen. Apex achieves comparable concentration through the L1 15 % / L2 50 % / L3+ 100 % capacity ladder rather than ticket count; no ticket-burst feature was added.
- The Sep22 X video is now reviewed (it was pending).

## What this means for Astra (applied in `astra/strategy.md`)

- Recognise two dominant SELL locations: **spike/sweep → hesitation box → rejection**, and **M3 break of lows → failing small-bodied pullback → continuation**. Engulfing-retest is a variant of the first.
- Early adds belong close to L1 while the basket is green and the proof is fresh. Once exposure is loaded and price has extended, prefer HOLD/STOP_ADDING; **late large adds near extended lows are the documented failure**.
- Account leverage and broker margin regime decide survivability, not the setup. Apex sizing and protections, not the model, own that.

## Limits that remain

Edited promotional clips; no tick paths; no full broker statements; no successful BUY campaign recorded on screen; unknown private indicator ("cartel sniper"). Practical saturation of the trader's full history is **not** claimed. The conclusions above repeated across nine independent recordings and did not change on the last three reviewed, which is the strongest statement the evidence supports.
