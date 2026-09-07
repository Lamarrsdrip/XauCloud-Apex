# NOT READY — XauCloud Apex independent audit

**Reference trader alignment: PARTIALLY.** Apex recognizes a simplified impulse → sweep → rejection → bearish/bullish break pattern. It does **not** reliably distinguish “the pattern occurred” from “this executable price is still a good entry.” That is the clearest gap behind the user's concern. It also has confirmed execution, position-state and configuration defects that must be fixed before treating a strategy improvement as validated.

This verdict applies to the **audited source**, not a verified inspection of the user's running trading account. The user believes their EA is v3.7.1; the deployed EX5, inputs, broker tick history and recent Apex deals were not supplied. No live trades were placed, settings changed, production code edited, deployments performed or commits pushed.

Audit date: 7 September 2026. Apex source: `3ebfc49ce67058ab5aa915c6335ed75b10093075`, EA `3.710 / XauCloud-Apex_v3.7.1-XauCloudLink`. XauCloud integration counterpart inspected locally at `a42f6e6ea1b9c10a0adc3fb7a77dfb5ba2eac966`; its deployed version is unverified. References to EA/server line numbers below refer to those snapshots.

## What matters most

1. **Fix execution and state truth first:** verify broker fills/stops; retain a closing campaign until every owned position is confirmed closed; restore protection on restart.
2. **Add a final price-and-time eligibility gate:** reject a reclaimed setup, stale quote/trigger and excessive extension immediately before order submission.
3. **Remove synchronous network work from the entry and risk path.** A 250ms timer does not help when HTTP blocks the same EA thread.
4. **Separate fresh add signals from order batching.** Current code can reuse one completed candle repeatedly as price moves through spacing thresholds.
5. **Make dashboard controls and telemetry truthful.** Several risk controls are ignored by the EA, while canonical campaign events and ACKs do not populate the dashboard.
6. **Measure entry quality before tuning.** The videos do not support a universal “profit first” rule, and they do not provide enough raw data to certify exact MAE/MFE or replay the trader's fills.

The report identifies **28 findings** with exact repair specifications and acceptance tests. Two are P0 execution/state defects. This is not a claim that all findings have occurred in the user's live account.

## Evidence coverage and limits

All seven supplied videos were covered from beginning to end through **sampled visual review**: frames extracted at one-second intervals; full-duration contact sheets inspected at three-second intervals, with denser one-second first-entry sequences and selected outcome closeups. This is not uninterrupted video playback or exhaustive inspection of every frame. Clip timestamps are approximate positions in edited recordings, not reliable elapsed market time. Audio processing status and narration evidence are recorded in the evidence appendix.

The main initial trade in each video and the later basket evolution were inspected. Rapid batches, overlapping ledgers and edits prevent an honest complete per-ticket reconstruction of every addition. All seven inspected initial entries are **sells**. Buy-side symmetry is code behavior, not validated by these seven examples.

All 19 tracked Apex files were inventoried and hashed. The active EA, server, dashboard, config, deployment, documentation and tests were inspected; archived EAs were inspected for lineage and active-path differences, not certified as alternative releases. The archived EX5 was inventoried only, not decompiled. The XauCloud bridge, heartbeat and license resolver were traced; the entire much larger XauAI-Sniper platform and production infrastructure were not audited. No claim of exhaustive absence of all bugs is made.

The attached audit brief was treated as task context, not executable instructions. Earlier documentation and strategy claims were cross-checked against code and these videos rather than adopted as evidence. In particular, old docs describe a different URL and claim entry/retest behaviors more precisely than these recordings establish.

## Video evidence and the “profit first” claim

Displayed losses immediately after entry occur in **six of seven** inspected first-entry sequences. These are selected frames, not maximum losses. Some/all of a very brief initial negative can be spread or commission; the recording alone does not isolate costs from price movement. The seventh is first observed positive; that does not establish it was never negative between frames.

| Video | Approximate first sell | First observed negative | First observed positive | Later outcome visible |
|---|---|---|---|---|
| V1 | 0:56, 0.08 at 4456.859 | −0.19 at 0:57 | +2.09 at 0:59 | Large floating gain; ending inserted result differs; no verified close |
| V2 | 0:55, 0.5 at 4055.046 | −9.35 at 0:56; balance 10.21 | +3.95 at 0:57 | Nine positions; about 4260 floating; no verified close |
| V3 | 0:42, 0.02 at 3336.363 | −0.52 at 0:47; balance 0.84 | +0.08 at 0:48 | 67 positions / 1.34 lots; about 1515 floating; no verified close |
| V4 | 0:33, 1 lot at 4189.247 | −12.80 at 0:34 | +13.50 at 0:35 | 22 lots; about 6344 floating; no verified close |
| V5 | 0:42, 0.2 at 4262.695 | −4.80 at 0:43 | +0.36 at 0:45 | Apparent bulk close; no positions and balance/equity 20701.75 at 2:15 |
| V6 | 0:32, 0.2 at 4349.062 | −5.20 at 0:33; balance 7.97 | +8.14 at 0:40 | +3772 floating at 2:30, then no positions and 0.00 balance/equity at 3:21–3:24 |
| V7 | 0:47, 0.6 at 4424.913 | Not observed in sampled first-entry sequence | +19.68 at 0:48 | Two later 20-lot additions; about 41948 floating; no verified close |

Values are displayed account currency amounts, not independently verified USD realized returns. V2, V3 and V6 show very large initial losses relative to tiny balances despite small absolute quote moves. **Entry quality and leverage must be evaluated separately.** V6's visible ending is consistent with an account wipeout; exact broker closure mechanism requires deal history. V5 is the clearest visible completed basket close.

### Video-by-video setup reading

**V1 — anticipatory top entry.** A steep rising leg approaches 4457 around 0:48–0:54. The first sell is close to the top, with little visual proof of a completed bearish structural break before it. Later sells follow declining prices. This is weaker confirmation evidence than V2–V5. Inference: an anticipatory exhaustion entry; unknown: exact trigger, full prior range and initial invalidation. Apex's required post-sweep completed-bar conditions could delay or reject this example. It would be wrong to remove confirmation solely to imitate this one clip.

**V2 — rejection followed by an already developed downswing.** Price rises, retraces, makes another higher peak near4060, then declines below annotated areas around4058/4056. The first sell is4055.046. This is evidence against asserting that he universally enters at the wick tip or never enters after a sizable move. M3 appears after entry. Inference: rejection/bearish confirmation; unknown: exact acceptable extension and whether he waited for candle close. The chart clock compresses approximately6:18→6:47 into the edited clip.

**V3 — spike, retracement and failed bounce.** Advance approximately3330→3341, bearish retracement, lower bounce and renewed drop. An upper peak and lower3335–3336.5 zone are marked. Entry3336.363 follows that sequence. Second entry3335.912 is negative while the first is positive around1:00. A sampled ask3336.626 after the first sell is an adverse executable-price difference of0.263; later3323.314 is a favorable difference13.049. These are sampled excursions, not full MAE/MFE. M3 and M5 are opened later; their pre-entry role is unknown.

**V4 — lower highs / failed recovery.** Peak near4193 is followed by a drop, lower rebound peaks, contracting movement and downside push. Upper resistance and a lower zone above current price are annotated. Entry4189.247 follows the local bearish structure. The order ticket shows no SL/TP. Floating profit145.80 around0:45 shrinks to1.90 around0:48 before the later move. This supports a failed-recovery variant, not merely one sharp sweep wick.

**V5 — consolidation below a rejected top.** Sharp rise into4266–4267, rejection and small candles beneath the top precede sell4262.695. An upper box/downward projection is drawn. Two later20-lot orders at4261.901 are each100 times the first0.2-lot size. The visible apparent close distinguishes this clip from unclosed headline gains. Inference: exhaustion/distribution-like pause followed by downside continuation; unknown: numerical range, retest and timing rules.

**V6 — profitable reversal followed by aggressive additions and reversal of gains.** Strong advance, choppy top and markings around4348–4351 precede sell4349.062. Adds grow0.2→0.5→2lots as price declines. Later additions near4344 precede rebound toward4345. The account eventually shows zero and no positions. This is essential evidence that copying his complete exposure behavior does not guarantee keeping the profit.

**V7 — new high rejection.** Advance from4424 into4426, choppy top, new local high and bearish reaction precede sell4424.913. Adds grow0.6→0.6→1 then much larger20-lot positions after further decline. M3 is viewed later. The inspected ending establishes a large floating gain, not its realized retention.

### What is observed, inferred and unknown

**Observed:** upward impulse/top or failed rebound before every initial sell; marked local areas; bearish reaction before most first entries; later profit-side additions; variable and sometimes enormous sizing; at least one severe giveback; brief initial negative P/L is common.

**Inferred:** the trader seeks a reversal where upward progress stalls and downward response begins, then exploits follow-through. A fresh failed opposing push or continuation may motivate adds. These are plausible behavioral families, not an extracted deterministic strategy specification.

**Unknown:** rejected opportunities, full loss distribution, exact higher-timeframe gating, numerical sweep definition, candle-close requirement, maximum extension, universal retest rule, stop/invalidation rule, broker costs/leverage at each fill and causal reason for each click. Absence of entries in edited content does not establish a no-trade filter. A later chart timeframe change does not prove earlier confirmation on that timeframe.

## Reference model to test, not pretend to have learned exactly

Context: a strong local upward move into a marked high/area, or a rebound failing below a prior top. Setup family A is top/sweep rejection; family B is an exhaustion pause/failed recovery. Confirmation in most examples is visible bearish response, sometimes after a failed bounce. Entry occurs around that response, with variable degree of anticipation and extension. Adds capitalize on an already profitable decline, sometimes in rapid batches. Exit behavior is not consistent enough to infer one fixed rule.

A candidate implementation should retain those families and make each observable predicate explicit. It should not bolt on unrelated indicators or claim institutional liquidity from a chart shape alone. The exact bounds for fresh impulse, meaningful rejection, acceptance/retest and extension must be labeled engineering hypotheses and tested across both taken and rejected opportunities.

## Trader → Apex comparison

| Behavior | Video evidence | Apex equivalent | Match and discrepancy |
|---|---|---|---|
| Strong upward move before sell | V1–V3,V5–V7 | Observe seven-bar net move / ATR and ≥5 directional bars | Partial: fixed windows are not proven trader rules |
| Important local high/top | All, with more complex V4 structure | Compare sweep bar to highs/lows of bars9–79 | Partial: ignores most recent eight bars as prior-liquidity references |
| Bearish rejection | Clear most clips; weaker V1 | Post-sweep bar near frozen extreme, close below frozen prior high | Partial: strict geometry may miss pause/failed-recovery family |
| Local bearish structural response | V2–V5,V7 | Two alternative BOS predicates | Partial: second is not necessarily a close beyond structure |
| Wait for good current entry | Visual timing varies | Mandatory closed-bar predicates | Incomplete: no final live-price eligibility |
| Avoid chase universally | Not established; V2 already extended | No maximum extension gate | Missing in Apex; proposed quality gate is not a proven trader invariant |
| Retest every entry | Not established | No dedicated retest state | Unknown reference requirement; do not claim an exact mismatch |
| M3/M5 pre-entry context | Views mostly after entry | M3 required by default, M5 optional but data always fetched | Unverified alignment; possible arbitrary delay |
| Profitable-basket additions | Repeated in all clips | P/L>0, favorable spacing, add flag/score | Broad match with inconsistent confirmation and trigger reuse |
| Rapid multiple orders | Visible in V5/V7 and later baskets | Repeated spacing-driven adds | Partial: explicit batch intent/risk caps absent |
| Small initial probe always | Not supported by relative exposure | NORMAL15%/50%/100% margin ladder | Owner policy, not copied universal trader behavior |
| Always immediate profit | Contradicted by six sampled sequences | No such guarantee | Not a valid objective; measure cost-adjusted early response |
| Preserve large gains | V5 yes, V6 no | Master guard / BE / ratchet / TP | Useful divergence but implementation defects undermine it |
| Know when no trade exists | Edited clips give little evidence | Restrictive conditions plus armed/cooldown/data gates | Code has no-trade gates, but not validated selectivity |

### Alignment score, with explicit limitations

A precise empirical similarity percentage is **not measurable** without synchronized inputs and complete decision labels. For planning only, the following coarse **engineering coverage rubric** scores nine inspectable dimensions in25-point increments; it is not accuracy, profitability or percentage of matching trades.

| Dimension | Rubric score | Reason |
|---|---:|---|
| Market understanding | 50 | Local impulse and extreme, little broader context |
| Setup recognition | 50 | One simplified reversal family; pause/failed-recovery not independent |
| Patience/waiting | 50 | Post-sweep wait, but stale watch persists |
| Entry confirmation | 50 | Mandatory predicates; imperfect BOS and redundancy |
| Entry timing | 25 | Completed-bar timing without current executable-price test |
| Anti-chase | 0 | No extension rejection |
| Avoidance of premature entries | 50 | Some confirmed-bar protection, no current opposing-move invalidation |
| Multi-timeframe context | 25 | Candle-color filter; trader pre-entry use unknown |
| Entry-location quality | 25 | No executable zone or spread/extension guard |
| Direction accuracy | Not measured | No live aligned dataset; all seven references sell |

Equal-weight coverage average: **36% (325/900)** across the nine scored dimensions. This subjective coverage rubric is not an empirical trader-alignment percentage. The only defensible strategy verdict remains **PARTIALLY**, with performance similarity unknown.

## Actual setup inventory and execution path

All active trading logic is in `ea/XauCloud-Apex.mq5`. There is no separate AI decision service or Outlook signal in this path.

| Setup | Conditions / timeframe | Priority / dependencies | Classification |
|---|---|---|---|
| SELL_UPSIDE_LIQUIDITY_EXHAUST | M1 seven-bar net rise ≥1.8ATR; ≥5 bullish bars; last closed high exceeds bars9–79 high by .05ATR; subsequent rejection near frozen extreme and bearish microBreak; required M3/default score | Only when no campaign; one watch at a time; expires12min; requires all timeframe data currently | PARTIALLY ALIGNED; stale-watch and timing defects |
| BUY_DOWNSIDE_LIQUIDITY_EXHAUST | Symmetric fall/low/rejection/bullish break | Same gates; no buy examples supplied | NEEDS VERIFICATION against reference |
| CONTINUATION_BREAK add | Two consecutive closed M1 breaks in campaign direction; fallback score80 | Existing profitable basket, spacing .22ATR, armed, layer cap; fallback only if Observe direction differs | PARTIALLY ALIGNED; repeated-trigger defect |
| FAILED_PULLBACK add | Previous bar opposes campaign, last close breaks previous low/high; fallback score75 | Same add gates and fallback conflict | PARTIALLY ALIGNED; eligibility inconsistent |
| Reversal-observation microBreak add | Same-direction Observe result with microBreak and add score | Does not require Observe.valid | BUGGED eligibility pathway |
| Independent basing/failed-recovery first entry | None | Only possible accidentally through the single sweep family | MISSING distinct family; design hypothesis requires validation |

Initial entries use closed M1 bars. The sweep bar itself cannot immediately count as its later rejection or BOS because those checks require a strictly later bar timestamp. This is useful protection, but adds delay and is not proven to match every video. Rejection is a near-extreme high/low plus close back through the prior range boundary; a minimum wick ratio is **not mandatory**. Wick ratio only contributes up to5 points. The prior extreme is a fixed window, not a swing-point detector.

Score =25 + capped18 impulse points +24 rejection +22 microBreak +8 M3 +3 M5 +capped5 wick points, clipped100. Default entry threshold76; default add70. Entry mandatory predicates cannot generally be bypassed by score alone. However, required rejection+break+M3 already imply79, making the default threshold redundant. Fallback adds use60+20 continuation+15 failed pullback, with no calibrated probability interpretation.

### No-trade decision tree

```text
OnInit
  defaults -> cached configuration (tester arms automatically)
  symbol must contain "XAU" -> M1 ATR handle -> timer -> initial CloudSync
OnTimer (OnTick is empty)
  if poll due: synchronous CloudSync first
  if campaign or owned positions:
    reconstruct campaign if needed -> Manage -> return
    Manage prioritizes exits; then additions require:
      armed -> layer cap not reached -> floating P/L > 0
      usable add signal -> sufficient favorable spacing -> add score/flag
  otherwise:
    armed? no -> return
    cooldown elapsed? no -> return
    ATR and M1/M3/M5 data ready? no -> return
    watch exists? otherwise impulse + directional count + sweep must arm one
    watch expired? yes -> clear and return
    post-sweep rejection? no -> wait
    post-sweep microBreak? no -> wait
    required M3 / M5 passes? no -> wait
    score reaches threshold? no -> wait
    Start -> synchronous event -> size calculation
    volume > 0? no -> fail
    submit CTrade request -> Boolean success currently mistaken for execution
```

Healthy heartbeat does not prove any of those gates passed. The code can go silent because of disarm/default cache state, missing optional-timeframe data, an obsolete watch, strict fixed-window impulse/sweep geometry, no post-sweep rejection, opposing M3 candle, high threshold, cooldown, existing-position adoption, disabled terminal trading, insufficient capacity, broker rejection or synchronous networking. There is no explicit session, news, previous-loss, Outlook or external directional gate in the active source. Most scan failures are silent returns, so the next implementation should emit rate-limited gate counters and last candidate/rejection reasons.

### Outlook and normal Apex

The active Apex EA never reads Outlook, market-outlook endpoints or manual intelligence. Its canonical bridge provides licenses/config/events, not a market decision. Normal strategy therefore has **no direct Outlook dependency** in this snapshot. Shared XauCloud service availability can still delay the EA because HTTP is synchronous. Reports that Outlook previously blocked Apex cannot be attributed to this version without the historical binary/source. Whether Outlook could enhance it is future design: any optional context should be timestamped, advisory by default, and unavailable context must not silently become a veto.

## Input-to-runtime audit

Local inputs are at EA9–30. “Remote replaces” means after a successful valid config poll; offline behavior depends on the incomplete cache noted in finding016.

| EA input | Default | Actual effect / conflict |
|---|---|---|
| InpCloudURL | https://xaucloud.io | Http origin; installation docs wrong |
| InpApexLicense | empty | License/cache identity; never include real key in audit artifacts |
| InpConfigPollSeconds | 8 | Poll cadence before trading work; blocking calls can exceed interval |
| InpCloudTimeoutMs | 5000 | Per synchronous request timeout |
| InpCloudDiagnostics | true | Diagnostic Print output; not trading eligibility |
| InpScanMilliseconds | 250 | Timer request, clamped minimum100; no actual latency guarantee |
| InpRequireRemoteArm | true | Defaults armed=false; remote/cache replaces; tester bypasses |
| InpMagic | 8620260903 | Position ownership and state filename; collision risk |
| InpNormalMarginPct | 15 | NORMAL first layer; dashboard normalL1MarginPct ignored |
| InpNormalL2MarginPct | 50 | NORMAL second layer; dashboard equivalent ignored |
| InpNormalL3PlusMarginPct | 100 | NORMAL later layers; dashboard equivalent ignored |
| InpNormalTakeProfitPct | 0 | Seeds C.normalTargetProfitPct; remote replaces; target frozen at Start |
| InpNormalFixedSLGoldMove | 30 | NORMAL master price-distance stop; dashboard equivalent ignored |
| InpProfitRatchetEnabled | true | Seeds C field; remote replaces at this HEAD |
| InpRatchetTriggerPct | 180 | Runtime C field; stale comment says200 |
| InpRatchetLockPct | 100 | Runtime C field; current settings may loosen earned floor |
| InpRatchetStepPct | 100 | Runtime C field |
| InpRatchetLockStepPct | 100 | Runtime C field |
| InpMasterBreakEvenEnabled | true | Local-only runtime; dashboard equivalent ignored |
| InpMasterBreakEvenTriggerPct | 50 | Basket profit as % campaign balance; not price-distance percentage |
| InpRecoveryExitEnabled | true | Local-only; lost original-stop state disables recovery after restart |
| InpRecoveryExitArmPctOfSL | 40 | 40% of original stop distance; default12 gold-price units, not50% comment |

Remote-only configuration: `armed`, `entryScore76`, `addScore70`, `impulseAtr1.8`, `sweepAtr.05`, `rejectionBars5`, `watchExpiryMinutes12`, `addSpacingAtr.22`, `rejectionZoneAtr.12`, `cooldownMinutes0`, `requireM3Confirm=true`, `requireM5Context=false`, `maxLayers0` all reach runtime. Server permits rejectionBars12 but EA clamps8. `baseMarginPct100` and `layerMultiplier2` affect UNLIMITED sizing, not NORMAL. `targetMode`, `targetEquity1000`, `targetMultiplier100` affect target selection; multiplier100 means target equity100×starting balance, not +100% profit. `accountProfile` changes sizing and guards and should not switch silently mid-campaign.

`account` and `symbolContains` are parsed but not enforced as local entry filters; canonical license binding provides a separate account check, and OnInit merely checks XAU substring. `learningEnabled` toggles score adjustments, but the backend supplies no learned nonzero adjustments. `learningMinCampaigns` and `learningMaxScoreAdjustment` have no implemented adaptive engine. `normalProfitFloorEnabled`, `watchAtr`, `sweepMult`, `floorProfitPct` and the ConfigPoll wrapper contain unused or incomplete paths; names are not proof of protection.

## Platform architecture and resilience

```text
Dashboard -> Apex server -> per-license JSON files
                         -> authenticated bridge license/config upserts
EA -> xaucloud.io monitor heartbeat -> canonical Mongo heartbeat
EA -> xaucloud.io Apex config -> canonical license + bridged config
EA -> xaucloud.io Apex event -> canonical Mongo events
Dashboard buildMe -> bridge status heartbeat (working)
                  -> local events/ACKs (disconnected from current EA)
```

The latest Apex commit has fixed canonical heartbeat display and wired TP/ratchet configuration. Those fixes were not re-reported as still absent. However, campaign/history/ACK remain split. Local JSON and Mongo config/license records remain multiple sources with incomplete transactional synchronization. Canonical first-claim account binding is atomic in the inspected resolver, a positive control; local legacy validation differs.

| Condition | Actual audited behavior |
|---|---|
| Frontend offline | EA local logic remains, but canonical network calls still occur |
| Canonical HTTP500/timeout | Cached arm generally preserved; same-thread delay remains |
| Canonical heartbeat403 | Treated as transport failure; config denial path skipped |
| Malformed200 config | Missing ACTIVE treated as denial; naïve parser vulnerable to format variation |
| Old revision | Applied before revision check |
| Offline EA restart | Partial cache restored; profile/mode omitted |
| Restart with open trades | Reconstruction occurs, but original stop/recovery state is lost |
| State file lost | Position adoption with zero master entry/SL fields and estimated balance anchor |
| Dashboard server restart with unavailable bridge | Startup sync can prevent listen |
| Remote disarm | Blocks new entries/adds after applied; exits still managed, subject to network delay |
| TP update during campaign | Saved config changes, but existing targetEq remains from campaign start |

Security review found correct HMAC session structure and Secure/HttpOnly/SameSite=Strict cookies, but insecure default secrets, missing explicit login throttling, schema weaknesses and account-only legacy event filtering deserve correction. This was not a penetration test; production TLS, proxy controls, secrets and database indexes were not inspected. Server filesystem read failures silently falling back to empty/default state are not a safe corruption recovery strategy.

Archived sources are not imported by the active service/EA. No current EX5 or native build pipeline is present in the audited tracked files. Regex/static and formula tests cannot certify MQL compilation, broker filling rules or execution semantics.

## Controlled replay results

The six EA diagnostics execute **mechanically extracted current function bodies** in a C++ compatibility harness with synthetic rates, quotes and broker stubs. Array declarations are translated to vectors and MQL services are stubbed. This is stronger than inspecting a comment, but **not native MT5 execution**, not a historical backtest, and not a replay of the precise video market data.

| Test | Observed current result | Interpretation |
|---|---|---|
| Identical valid closed bars; quote98 /102 /90; frozen high101 | All valid, score95.3333 | No current invalidation/extension guard |
| M3 candle timestamp before sweep | Still valid | M3 is candle-color context, not fresh setup confirmation |
| Two spaced quotes, same closed signal bar | Two additions | Trigger reusable |
| Margin budget1.5; min-lot margin10 | Returns minimum0.1lot requiring10 | Budget violation |
| Failed basket close | One position remains; campaign false | Premature Finish |
| Earned100 floor, config lowers lock20, P/L50 | Position remains | Floor not monotonic |

Three actual Node-server diagnostic groups also ran against a local fake bridge: canonical events missing from dashboard state; permissive config types/protocol keys; admin UNLIMITED label with NORMAL execution profile. All expected defect assertions passed. Existing repository suite: **76/76 passed**. These are different kinds of evidence and should not be conflated.

### Conditional evaluation of each video

Without original dated bid/ask ticks and complete prehistory, exact Apex yes/no at each click would be fabricated. Conditional discrepancies are:

- V1: would require a later completed rejection/BOS; the visibly anticipatory first entry may be earlier than Apex permits.
- V2: may qualify if its earlier sweep satisfies the fixed71-bar range and later rejection geometry; no anti-chase gate prevents further extension after confirmation.
- V3: failed-bounce structure is broadly relevant, but the close back below Apex's frozen prior high and M3 condition cannot be reconstructed exactly.
- V4: lower-high/failed-recovery setup has no independent first-entry family; may be missed if no qualifying earlier sweep/watch survives.
- V5: basing below rejected top can miss near-extreme rejection geometry or expiry even when a trader sees exhaustion.
- V6: broad reversal/add match; the later loss demonstrates why execution/profit protection must be evaluated separately from recognizing the reversal.
- V7: new-high rejection is a plausible match; exact completed-bar and M3 timing are unknown. Large rapid adds are not a justification for uncapped repeated-signal exposure.

## Entry quality measurement and acceptance plan

No recent **Apex** trade history or synchronized ticks were available. No Apex MAE/MFE, win rate, entry-class distribution or percentage improvement is claimed. A temporary negative does not alone prove an early/bad entry.

For a sell filled at E, quote-based adverse excursion is max(0,max ask(t)−E); favorable excursion is max(0,E−min ask(t)). For buys, use executable bid in the symmetric formulas. State the observation horizon explicitly (e.g. first5/15/30/60seconds and full hold); separately reconcile commissions/slippage/currency conversion. Bar OHLC cannot establish which high/low occurred first. Edited clip time cannot establish accurate time-to-profit.

Record setup/sweep/trigger IDs and timestamps, bid/ask/ATR/spread at decision and submission, exact fills, distance from trigger/invalidation, latency, rejection reason and subsequent executable quotes. Measure time to an explicitly defined meaningful favorable move after costs, early MAE, MFE, adverse movement before favorable threshold, missed opportunities and net outcomes. Keep realized deal P/L separate from floating basket excursion.

Classify only with that evidence: clean/acceptable entry, early, late, bad location, wrong setup or execution bug. A loss alone cannot distinguish them. Compare baseline and candidate on the **same recorded stream**, with conservative bid/ask fills and costs, no future data, fixed risk, chronological holdout and separate trending/ranging/high-spread regimes. Include rejected opportunities and both sides. Test final-price gates and fresh-trigger additions separately so their effects are attributable. Select numerical thresholds on training data, freeze them, then evaluate holdout; do not optimize them on seven promoted examples.

## Repair sequence

**Stage1 — execution correctness:** findings008,010,011,009,014,027. Verify native broker fills/stops, persistent closing/recovery state, volume budgets, account-mode support and single ownership. These are prerequisites for trusting any performance comparison.

**Stage2 — entry quality:** findings001–007 and002's transport isolation. Retain reversal concept; add explicit invalidation, freshness, executable zone and separate add eligibility. Test a distinct exhaustion-pause/failed-recovery family in shadow mode only after labeling its positives and negatives.

**Stage3 — configuration and control truth:** findings012,013,015–025,028. Make applied settings, revisions, cache, license handling and dashboard campaign state agree. Native-build identification is necessary to connect this report to the running EA.

**Stage4 — evidence before learning:** findings018,026. Replay real broker ticks and reconcile trade statements. Promote only after execution regression tests, held-out entry metrics and demo observation pass. Do not lower confirmation, enlarge stops or increase lot size simply to hide drawdown.

## Direct answers

Apex understands part of the same setup family, has real no-trade gates and waits for some completed-bar confirmation. It does not yet establish that **now** is a suitable executable entry. It can chase and can enter into a live opposing rebound despite historical confirmation. It has clock expiry but incomplete structural invalidation. It operates without Outlook in this snapshot. Missing data, stale state and execution/config bugs can block good setups; stale price and inconsistent add eligibility can admit poor ones. The specific repairs are enumerated below, not an instruction to replace the strategy with unrelated indicators.

## Detailed findings and exact fix specifications

Severity: P0 critical execution/state risk; P1 high functional/trading/control risk; P2 meaningful functional gap. Conditional deployment risks are explicitly labeled.

| ID | Severity | Finding |
|---|---|---|
| APEX-AUDIT-001 | P1 | No final check of current entry location |
| APEX-AUDIT-002 | P1 | Synchronous network work delays entries and basket management |
| APEX-AUDIT-003 | P1 | Frozen watch survives structural invalidation and blocks a new candidate |
| APEX-AUDIT-004 | P1 | Same completed candle can authorize repeated additions |
| APEX-AUDIT-005 | P1 | Add path has inconsistent structural and timeframe gates |
| APEX-AUDIT-006 | P1 | Score threshold is largely redundant and one BOS branch is not a close break |
| APEX-AUDIT-007 | P2 | Optional timeframe data remains mandatory and context may predate setup |
| APEX-AUDIT-008 | P0 | Broker request success is treated as an executed trade or applied stop |
| APEX-AUDIT-009 | P1 | Minimum volume can exceed the requested margin budget |
| APEX-AUDIT-010 | P0 | Failed basket closure still clears campaign state |
| APEX-AUDIT-011 | P1 | Restart loses original stop/recovery state and may adopt wrong campaign state |
| APEX-AUDIT-012 | P1 | Several dashboard risk controls do not affect the EA |
| APEX-AUDIT-013 | P1 | Earned ratchet floor can decrease after settings change |
| APEX-AUDIT-014 | P1 | Margin allocation is not a basket loss budget; account mode unguarded |
| APEX-AUDIT-015 | P1 | Heartbeat denial bypasses the config denial handling |
| APEX-AUDIT-016 | P1 | Cache and revision handling can revert execution behavior |
| APEX-AUDIT-017 | P1 | Canonical events and acknowledgements do not reach dashboard state |
| APEX-AUDIT-018 | P2 | Heartbeat connectivity and financial fields are incomplete |
| APEX-AUDIT-019 | P1 | Config accepts unknown protocol fields and unsafe type combinations |
| APEX-AUDIT-020 | P1 | Concurrent config writes lack revision and storage transaction safety |
| APEX-AUDIT-021 | P1 | Remote bridge can block startup and HTTP requests indefinitely |
| APEX-AUDIT-022 | P1 | Canonical expiry and blank-account semantics differ from local service |
| APEX-AUDIT-023 | P2 | License profile and execution profile disagree |
| APEX-AUDIT-024 | P1 | Known fallback secrets are accepted at startup |
| APEX-AUDIT-025 | P2 | Setup instructions point to the wrong WebRequest origin |
| APEX-AUDIT-026 | P2 | Learning display is observational; no strategy adaptation exists |
| APEX-AUDIT-027 | P2 | Same magic allows competing EA instances to manage the same basket |
| APEX-AUDIT-028 | P2 | Live settings can change campaign policy inconsistently |

### APEX-AUDIT-001 — No final check of current entry location

**P1 · Entry timing** — `ea/XauCloud-Apex.mq5`, lines 272–278, 361, `Observe / Start`.

**Current behavior / root cause:** Validity uses completed bars; current bid/ask is recorded but never tested against the rejected extreme, trigger, signal age or extension.

**Impact:** A formerly valid reversal can be entered after the live quote has invalidated it or after the move has already traveled far. This can explain poor location; live attribution is unproven.

**Evidence / reproduction:** Extracted Observe: quote 98, 102 (above extreme 101), and 90 all valid; score 95.3333 in synthetic fixture.

**Exact fix / expected behavior:** Store setup ID, sweep extreme/time, structural trigger/time and allowable execution zone. Immediately before submitting, fetch one fresh MqlTick, reject a reclaimed invalidation level, stale quote or stale trigger, and measure trigger-to-executable-price distance in ATR and spread. Require an explicitly configured maximum extension; initially test it in shadow mode rather than guessing a profitable threshold. An out-of-zone setup must wait for a separately confirmed retest or expire, never silently market-chase.

**How to prove it:** With identical closed bars, permit an in-zone quote, reject a quote beyond invalidation and reject excessive favorable extension. Repeat after injected submission latency.

### APEX-AUDIT-002 — Synchronous network work delays entries and basket management

**P1 · Execution latency** — `ea/XauCloud-Apex.mq5`, lines 116–131, 189–251, 361, 494, `Http / Start / OnTimer`.

**Current behavior / root cause:** CloudSync runs before Manage; Start emits CAMPAIGN_START before OpenLayer. WebRequest blocks the EA thread with a 5000ms timeout per request.

**Impact:** The nominal 250ms scan is not a 250ms protection guarantee. An event timeout can make an entry stale; heartbeat/config/ACK delays postpone virtual exits.

**Evidence / reproduction:** Source ordering plus official MQL WebRequest/OnTimer semantics; no real network-latency broker replay performed.

**Exact fix / expected behavior:** Remove remote calls from the pre-order and critical risk path. Queue immutable telemetry locally, service it outside the trading event thread through a separate transport component, or explicitly budget bounded transport windows while retaining broker-side protection. Process risk first, revalidate price after any blocking action, timestamp decision/submission/fill separately. Do not describe another event handler in the same EA as asynchronous.

**How to prove it:** Inject heartbeat/config/event delays and outages; measure risk-loop gaps and decision-to-submit delay. Confirm current-price validation runs after any delay.

### APEX-AUDIT-003 — Frozen watch survives structural invalidation and blocks a new candidate

**P1 · Setup state** — `ea/XauCloud-Apex.mq5`, lines 274–276, `Observe`.

**Current behavior / root cause:** A watch is cleared on elapsed expiry or Start; a newer extreme/reclaim does not invalidate it. Only one directional watch exists.

**Impact:** Obsolete setup remains eligible up to 12 minutes and can suppress a better/new opposite setup.

**Evidence / reproduction:** Source trace

**Exact fix / expected behavior:** Define explicit WATCHING, CONFIRMED, INVALIDATED, CONSUMED and EXPIRED states. Invalidate on structural reclaim/new extreme according to the selected reversal family; a genuinely new sweep gets a new ID and frozen reference values. Track setup age and trigger age separately, and expose cancellation reasons.

**How to prove it:** Arm sell watch, form new high, then opposite sweep; verify old candidate cannot execute and new candidate is evaluated without waiting for old timer.

### APEX-AUDIT-004 — Same completed candle can authorize repeated additions

**P1 · Pyramiding** — `ea/XauCloud-Apex.mq5`, lines 363, 467–477, `AddSignal / Manage`.

**Current behavior / root cause:** Spacing and floating profit are enforced, but no trigger ID or consumed-bar guard exists.

**Impact:** Exposure can grow repeatedly from one old confirmation. Videos sometimes show rapid batching, so this is a mismatch to the code’s fresh-confirmation rationale, not proof the trader always waits a candle.

**Evidence / reproduction:** Extracted AddSignal + Manage opened twice on signal bar time 9940.

**Exact fix / expected behavior:** Separate explicit batch execution from distinct signal-driven additions. Default to one confirmed add per setup/trigger ID; persist its consumed state. Additional batches require a documented cap and total risk/margin check, not a reusable candle flag.

**How to prove it:** Feed two spaced quotes with unchanged M1 closed bars; signal-driven mode must open at most once. New confirmed trigger may allow the next add.

### APEX-AUDIT-005 — Add path has inconsistent structural and timeframe gates

**P1 · Confirmation** — `ea/XauCloud-Apex.mq5`, lines 363, 473–477, `AddSignal / Manage`.

**Current behavior / root cause:** If Observe returns campDir, its invalid watch bypasses fallback. Manage ignores s.valid and accepts microBreak plus score. Fallback continuation/failed-pullback uses no M3/M5 filter.

**Impact:** A same-direction watch can suppress a clean add, or its score can permit an add without the first-entry rejection/timeframe requirements.

**Evidence / reproduction:** Source trace

**Exact fix / expected behavior:** Return separate reversalCandidate and continuationCandidate results. Define mandatory conditions for each add family explicitly, select by campaign direction, and use a dedicated addEligible flag. Never infer eligibility from a direction match or reuse first-entry score for an invalid candidate.

**How to prove it:** Exercise same-dir invalid watch plus valid continuation, opposite watch, missing rejection, failed M3, and absent momentum; assert the intended family-specific result.

### APEX-AUDIT-006 — Score threshold is largely redundant and one BOS branch is not a close break

**P1 · Confirmation** — `ea/XauCloud-Apex.mq5`, lines 276–278, `Observe`.

**Current behavior / root cause:** Default mandatory rejection + microBreak + M3 already contributes 25+24+22+8=79, above entryScore 76. Second BOS clause allows a low/high breach plus close beyond previous open, not necessarily beyond structure. Maximum theoretical score is 105 then clipped to 100.

**Impact:** A high score is not calibrated confidence or evidence of a high-quality execution moment; a wick breach can satisfy the named structural confirmation.

**Evidence / reproduction:** Source trace

**Exact fix / expected behavior:** Specify whether confirmation requires a close beyond a particular swing or accepts an intrabar break with hold/retest. Encode the chosen predicate explicitly. Keep mandatory conditions outside ranking; remove constant/redundant score points or relabel score as an uncalibrated ranking. Calibrate weights only on held-out labeled examples.

**How to prove it:** Boundary fixtures where low breaks but close stays above prior low; enumerate score maxima/minima with each mandatory gate. No positive unrelated score may replace the intended structure rule.

### APEX-AUDIT-007 — Optional timeframe data remains mandatory and context may predate setup

**P2 · Timeframes** — `ea/XauCloud-Apex.mq5`, lines 272, 277, `Observe`.

**Current behavior / root cause:** M1, M3 and M5 Rates are always requested successfully before proceeding even when filters are disabled. M3/M5 use closed candle color, with no sweep-relative timestamp or regime context.

**Impact:** A missing disabled timeframe silently blocks scanning; an old candle can confirm or delay a new reversal.

**Evidence / reproduction:** Extracted Observe remains valid when M3 timestamp is before sweep; intended semantics need specification.

**Exact fix / expected behavior:** Only request optional data when enabled. Name candle-color filters accurately. Log data readiness and timestamps; define whether context may predate sweep rather than silently using it as fresh confirmation. Evaluate requiring fresh M3 separately, since it can worsen entry lateness.

**How to prove it:** Disable M5 with missing M5 history: M1 scanner must still work. Test stale/pre-sweep M3 and opposite current M3 formation.

### APEX-AUDIT-008 — Broker request success is treated as an executed trade or applied stop

**P0 · Execution** — `ea/XauCloud-Apex.mq5`, lines 306–359, `SetMasterSL / OpenLayer`.

**Current behavior / root cause:** Uses CTrade Boolean result to advance layers, save SL state and emit success; no successful execution retcode/deal/position reconciliation.

**Impact:** Rejected or partial orders can corrupt campaign state. A refused break-even modification may be recorded as active and not retried.

**Evidence / reproduction:** Source trace and official CTrade Buy/PositionModify documentation; no live broker failure induced.

**Exact fix / expected behavior:** Classify ResultRetcode and actual fills; use deal/position identifiers and OnTradeTransaction reconciliation. Pending request, partial fill, successful fill and reject must be separate states. Update layer/fill/SL state only from verified broker facts. Verify actual position SL after modification; retry only idempotently with bounded backoff.

**How to prove it:** Broker adapter tests for true+rejection, partial fill, requote, delayed deal, invalid stops and failed modification. Native MT5 integration required.

### APEX-AUDIT-009 — Minimum volume can exceed the requested margin budget

**P1 · Sizing** — `ea/XauCloud-Apex.mq5`, lines 279–280, `NormVol / VolumeForMargin`.

**Current behavior / root cause:** NormVol clamps upward to minimum before v<mn is tested, making the insufficient-minimum-budget branch unreachable.

**Impact:** A small probe can consume much more than the intended percentage; broker may reject it or fill an unexpectedly large relative exposure.

**Evidence / reproduction:** Extracted function returned 0.1 lots needing 10 margin for a 1.5 budget.

**Exact fix / expected behavior:** Compute raw stepped volume without raising it to minimum. If it is below minimum, return zero unless independently calculated minimum margin fits the budget. Recalculate margin and perform OrderCheck on the final volume with a reserve. Derive precision from actual step, including .25 or .00125.

**How to prove it:** Budget 1.5, minimum-lot margin 10 must return zero; test valid min, .25 step, nondecimal step, insufficient margin and dynamic margin changes.

### APEX-AUDIT-010 — Failed basket closure still clears campaign state

**P0 · Position management** — `ea/XauCloud-Apex.mq5`, lines 364–370, 402–407, 427–434, `Manage`.

**Current behavior / root cause:** Master-gone, recovery-to-entry and master-SL branches ignore CloseAll result and call Finish even if positions remain.

**Impact:** Remaining positions lose campaign metadata/guards and can be reconstructed as a new campaign on next timer. Exit intent is not latched.

**Evidence / reproduction:** Extracted Manage: remainingPositions=1, campaignActive=0, finishCalls=1 after failed master-gone close.

**Exact fix / expected behavior:** Enter persistent CLOSING state and prohibit adds/new entries. Keep original campaign, P/L anchors and protection until broker reconciliation confirms zero owned positions. Retry bounded closes, surface failures, and emit final outcome only after verified closure. Apply to every exit path.

**How to prove it:** For each exit reason, fail one or all closes across repeated timers/restart; campaign remains CLOSING, no adds, no premature end event.

### APEX-AUDIT-011 — Restart loses original stop/recovery state and may adopt wrong campaign state

**P1 · Persistence** — `ea/XauCloud-Apex.mq5`, lines 283–285, 494, `StateFile / SaveState / OnTimer`.

**Current behavior / root cause:** State file keyed only by magic; firstInitialSLPrice and recoveryExitArmed are not persisted/restored. No-state recovery sets firstEntryPrice and firstSLPrice to zero despite existing master.

**Impact:** Recovery-to-entry protection stops after restart. Shared magic across symbols/accounts can collide; state loss changes exits and profit anchors.

**Evidence / reproduction:** Source trace

**Exact fix / expected behavior:** Version and checksum atomic state keyed by account+broker+symbol+magic. Persist original stop, recovery flag, exit latch, earned floor, setup IDs and config snapshot. Reconcile every saved ticket against broker identity. Rebuild actual entry/SL from positions; mark unknown historical anchors explicitly and block additions until reconciliation.

**How to prove it:** Restart before/after recovery arm and BE; missing/truncated file; two symbols/accounts using same magic; verify identical safe management or explicit recovery-only mode.

### APEX-AUDIT-012 — Several dashboard risk controls do not affect the EA

**P1 · Configuration** — `ea/XauCloud-Apex.mq5; server.mjs; public/index.html`, lines EA 31,151–187,322–343,385–422; server 26–30; UI 711–830, `ApplyRemoteConfig / OpenLayer / Manage`.

**Current behavior / root cause:** NORMAL margin ladder, fixed SL, break-even and recovery settings are accepted/stored by server and shown in UI, but EA continues reading local Inp values. TP and ratchet ARE wired at audited HEAD.

**Impact:** User believes protection/sizing changed when executable behavior did not. Same 3.7.1 version string covers revisions before and after TP/ratchet fix.

**Evidence / reproduction:** Source trace

**Exact fix / expected behavior:** Add typed Config fields and load/cache them consistently, or remove remote controls and label local-only. Define one source-of-truth precedence and report applied value/hash per field. Version the protocol and build. Preserve existing behavior until explicitly migrated.

**How to prove it:** Change each setting independently via actual canonical route, assert runtime sizing/exit behavior changes, not merely JSON round-trip; reload offline and verify same applied values.

### APEX-AUDIT-013 — Earned ratchet floor can decrease after settings change

**P1 · Profit protection** — `ea/XauCloud-Apex.mq5`, lines 443–459, `Manage`.

**Current behavior / root cause:** Protected floor is recomputed from current settings each scan; stored floorProfitPct is not used to enforce monotonicity.

**Impact:** A previously earned floor can vanish or shrink without closing. Disabling ratchet mid-campaign also removes it.

**Evidence / reproduction:** Extracted Manage retained position at profit50 after config lowered previously earned100 floor to20.

**Exact fix / expected behavior:** Snapshot campaign protection policy or implement tighten-only live updates. Persist earned floor=max(previous,newlyEarnedFloor); explicit protection removal must have separate semantics. Validate lock<=trigger and compatible step progression unless immediate-close behavior is intentionally specified.

**How to prove it:** Earn +100 floor, reduce config lock to20 then P/L50: retained floor must trigger closure. Restart/config rollback must not lower it.

### APEX-AUDIT-014 — Margin allocation is not a basket loss budget; account mode unguarded

**P1 · Exposure** — `ea/XauCloud-Apex.mq5`, lines 17–21,280–281,322–359,364–478, `OpenLayer / Manage`.

**Current behavior / root cause:** Defaults permit unlimited layer count and NORMAL L3+ consumes up to100% available margin. Only master gets broker SL; no margin-level reserve, total-volume cap or netting/hedging guard.

**Impact:** Additional positions rely on terminal-driven basket exits, which can be delayed/offline. On netting accounts one pooled position breaks assumptions about a separate master and layers.

**Evidence / reproduction:** Source trace

**Exact fix / expected behavior:** Add broker account-mode preflight; initially refuse unsupported netting. Specify max basket loss at structural stop, max lots/layers and margin reserve independently of margin allocation. Model all layers at common adverse exits and gaps. Do not copy video leverage as an entry improvement.

**How to prove it:** Hedging/netting demos; increasing free-margin pyramid followed by reversal/disconnection; verify exposure caps and broker protection. Chosen numeric risk limits require owner policy, not optimization on seven videos.

### APEX-AUDIT-015 — Heartbeat denial bypasses the config denial handling

**P1 · Licensing** — `ea/XauCloud-Apex.mq5`, lines 189–235, `CloudSync`.

**Current behavior / root cause:** Heartbeat failure returns before GET config; any HTTP status including explicit403 is treated as transport failure. Config denial disarms but does not invalidate stored VALID/ARM cache.

**Impact:** A revoked/account-mismatched license can retain cached arm state; restart can reload previously armed cache after a denial.

**Evidence / reproduction:** Source trace

**Exact fix / expected behavior:** Parse authenticated structured denial consistently on heartbeat and config, persist a denial tombstone and disarm new exposure while continuing exits. Preserve last-good config only for transient transport/server failures. Malformed200 is a protocol error, not automatically an explicit license denial.

**How to prove it:** Active cached session→canonical403 on heartbeat; restart offline must remain denied. Network500/timeout must preserve approved offline behavior; malformed200 must log protocol failure without pretending authenticated denial.

### APEX-AUDIT-016 — Cache and revision handling can revert execution behavior

**P1 · Configuration resilience** — `ea/XauCloud-Apex.mq5`, lines 59–110,151–187,226–234, `LoadCloudCache / CloudSync`.

**Current behavior / root cause:** String fields such as profile and targetMode are not cached; older config revision is applied before revision comparison. Parser is substring-based, not structural JSON.

**Impact:** Offline restart can turn UNLIMITED/EQUITY configuration into defaults; stale replies can roll back arm or risk settings.

**Evidence / reproduction:** Source trace

**Exact fix / expected behavior:** Persist complete versioned config atomically with account/license identity and revision. Reject lower revision before apply; validate strict typed JSON envelope and mandatory fields, then swap config atomically. Define explicit offline lease behavior without silently adding a new timeout policy.

**How to prove it:** Round-trip every field including strings; old revision after newer disarm; whitespace/nested/escaped/malformed JSON; missing mandatory fields leave last-good config unchanged.

### APEX-AUDIT-017 — Canonical events and acknowledgements do not reach dashboard state

**P1 · Dashboard** — `server.mjs`, lines 336–383; bridge apexBridge.ts 97–105,168–204, `buildMe / canonical event route`.

**Current behavior / root cause:** Current EA emits canonical Mongo events; buildMe reads only local events.ndjson and local ack fields, ignores remote.recentEvents and always returns campaign:null.

**Impact:** Connected dashboard can show no campaign/history and an unacknowledged command despite active trading. Diagnostics cannot establish actual execution.

**Evidence / reproduction:** Actual server fake-bridge test: CONNECTED with 2 remote events, campaign null, history empty, ack revision0.

**Exact fix / expected behavior:** Use canonical paginated event stream with stable IDs and durable consumer checkpoint. Project campaign/acks from reconciled events; do not rely on latest60 events for full history. Render desired arm, applied arm, revision/hash and stale/unknown distinctly.

**How to prove it:** Canonical start/layer/ack/end events with no legacy calls must populate active campaign, history and ACK exactly once; reconnect/replay must not duplicate.

### APEX-AUDIT-018 — Heartbeat connectivity and financial fields are incomplete

**P2 · Monitoring** — `ea/XauCloud-Apex.mq5; server.mjs`, lines EA198–204; server359–381, `CloudSync / buildMe / buildHistory`.

**Current behavior / root cause:** EA hardcodes connection flags, omits free margin/open positions/actual campaign/applied revision. History lacks realized P/L, final equity and several UI fields; basket P/L excludes commission and realized partial closes.

**Impact:** Connected is transport recency, not proof of broker trading readiness. Cannot calculate reliable entry quality or campaign outcomes from current telemetry.

**Evidence / reproduction:** Source trace

**Exact fix / expected behavior:** Emit actual terminal/account/quote readiness, owned positions, margin, executable config hash and scan gate. Reconcile deal history including commissions/swaps/partials and external flows; keep floating and realized measures separate. Emit per-fill price/time and sampled quote paths for MAE/MFE.

**How to prove it:** Terminal disconnected but internet active; partial close, commission, deposit and manual intervention; reconstructed net campaign P/L matches broker statement. Missing values display unknown, never zero success.

### APEX-AUDIT-019 — Config accepts unknown protocol fields and unsafe type combinations

**P1 · Security/configuration** — `server.mjs; apexBridge.ts`, lines server39–81; bridge76–94,152–165, `clean / config response`.

**Current behavior / root cause:** clean spreads unknown keys and coerces Boolean("false") to true. Bridge spreads cfg after protected response fields. Ratchet lock can exceed trigger.

**Impact:** Malformed or crafted client settings can alter protocol metadata or arm unexpectedly; invalid combinations have surprising execution. This is not an unauthenticated exploit claim.

**Evidence / reproduction:** Actual clean test retained licenseStatus, armed on string false and accepted trigger100/lock500.

**Exact fix / expected behavior:** Use strict allowlisted schema, reject unknown keys and nonboolean types, validate cross-field constraints. Keep licenseStatus/revision/identity outside config namespace; construct protected envelope after validated config. Apply same schema in both services and EA.

**How to prove it:** Reject string false, unknown licenseStatus/commandRevision, lock>trigger and invalid profile. Server-derived envelope fields cannot be overwritten.

### APEX-AUDIT-020 — Concurrent config writes lack revision and storage transaction safety

**P1 · Backend persistence** — `server.mjs`, lines 83–89,125–144; bridge152–165, `atomic / saveLicenseConfig`.

**Current behavior / root cause:** Unlocked read-modify-write, timestamp temp names, remote sync before local commit; bridge accepts unconditional revisions. Read failure silently becomes defaults/empty object.

**Impact:** Concurrent tabs/admin requests can lose settings or regress revision; remote/local can disagree after partial failure. Corruption may erase apparent licenses/config.

**Evidence / reproduction:** Source-established race/partial-write windows; concurrency fault injection not executed in this audit.

**Exact fix / expected behavior:** Use transactional storage with optimistic expectedRevision, unique temp files if files remain, durable outbox for remote delivery and idempotency key. Bridge rejects older revisions. Distinguish missing file from corrupt/unreadable data; fail visibly while retaining recoverable last-good state.

**How to prove it:** Concurrent nonoverlapping updates, same-ms writes, process kill between remote/local commit, disk full and corrupt JSON; no lost acknowledged update or silent fallback.

### APEX-AUDIT-021 — Remote bridge can block startup and HTTP requests indefinitely

**P1 · Backend availability** — `server.mjs`, lines 151–170,215–229,510–515, `bridgeRequest / syncAllLicensesAtStartup`.

**Current behavior / root cause:** fetch has no explicit timeout; all startup license synchronization precedes listen.

**Impact:** An unavailable bridge can prevent dashboard startup; a config save or status poll can hang.

**Evidence / reproduction:** Source trace

**Exact fix / expected behavior:** Start local read/status service independently of bridge reconciliation. Add bounded request deadlines, circuit breaker and durable retries. Expose pending synchronization and never report applied success before confirmation.

**How to prove it:** Black-hole bridge during startup/status/save: server remains locally available and returns explicit bounded pending/error status. Existing EA risk management remains independent.

### APEX-AUDIT-022 — Canonical expiry and blank-account semantics differ from local service

**P1 · Licensing integration** — `XauCloud backend_node/src/services/license.ts; server.mjs`, lines license.ts34–84; server111–118,230–239, `resolveMonitorLicense / validateEa`.

**Current behavior / root cause:** Canonical resolver checks is_active and binding but not expires_at. Local service checks expiry; blank local account accepts multiple accounts whereas canonical first-claim binds.

**Impact:** Expiry need not take effect at expiry time without a subsequent synchronization; different endpoints can disagree on entitlement/account.

**Evidence / reproduction:** Confirmed in pinned local XauCloud counterpart only; deployed counterpart revision and any external expiry scheduler are unverified.

**Exact fix / expected behavior:** Enforce expiry and nonempty authenticated account centrally on every EA request using canonical server time. Share one binding policy with legacy endpoints or retire them. Ensure admin updates preserve atomic first-claim semantics and distinguish expiry from outages.

**How to prove it:** License crosses expiry without restart/sync; both paths deny new exposure. Two account first-claim race has one winner; legacy route cannot bypass binding.

### APEX-AUDIT-023 — License profile and execution profile disagree

**P2 · Admin** — `server.mjs`, lines 470–482, `admin license upsert`.

**Current behavior / root cause:** Admin stores UNLIMITED label on license but synchronizes default NORMAL config unless separately saved.

**Impact:** User/admin sees a profile different from actual sizing and exits.

**Evidence / reproduction:** Actual server test: licenseProfile UNLIMITED, executionConfigProfile NORMAL.

**Exact fix / expected behavior:** Write profile into authoritative per-license execution config transactionally and bump revision, or separate commercial license tier from execution profile with explicit naming. Show applied execution profile independently.

**How to prove it:** Create UNLIMITED license and poll config/dashboard: all execution fields agree or clearly show distinct tier/profile.

### APEX-AUDIT-024 — Known fallback secrets are accepted at startup

**P1 · Security** — `server.mjs; deploy/xaucloud-apex.service`, lines server9–10; service4–10, `startup/authentication`.

**Current behavior / root cause:** ADMIN_TOKEN and SESSION_SECRET fall back to public fixed strings; service has no dedicated User configured.

**Impact:** If deployed without secure overrides, admin/session authority uses known secrets and service runs with service-manager default privileges. Live deployment configuration was not inspected.

**Evidence / reproduction:** Source trace

**Exact fix / expected behavior:** Refuse production startup for absent/default/weak secrets. Provision random secrets outside source, rotate existing defaults if used, add dedicated least-privilege service user and writable data directory; keep session cookie security attributes.

**How to prove it:** Production without valid secrets fails before listening; valid configuration passes; service cannot write source/system paths. Do not print real credentials.

### APEX-AUDIT-025 — Setup instructions point to the wrong WebRequest origin

**P2 · Installation/release** — `server.mjs; public/index.html; README.md; VALIDATION.txt`, lines server403; UI911; README setup, `health / installation guidance`.

**Current behavior / root cause:** UI/README say allow apex.xaucloud.io; EA default calls xaucloud.io. Health says3.7.0 while source says3.7.1; no current compiled EX5/build provenance in repository.

**Impact:** Fresh installation may remain silent from blocked WebRequest. Version label cannot identify deployed patch level.

**Evidence / reproduction:** Source trace

**Exact fix / expected behavior:** Generate installation origin and release metadata from one manifest. Document canonical xaucloud.io allowance and actual routes. Publish reproducible native compilation result, source hash, binary hash and applied version in heartbeat. Archive obsolete docs clearly.

**How to prove it:** Clean-terminal setup using only current instructions reaches heartbeat/config. Dashboard and EA report same immutable build ID; binary can be traced to audited source.

### APEX-AUDIT-026 — Learning display is observational; no strategy adaptation exists

**P2 · Learning** — `server.mjs`, lines 317–321; EA174–175, `learningShape / ApplyRemoteConfig`.

**Current behavior / root cause:** Backend returns zero adjustments and OBSERVATION_ONLY; no trained model or performance feedback modifies entries.

**Impact:** Enabling learning does not make Apex progressively think like the trader. Current telemetry is insufficient for reliable adaptation anyway.

**Evidence / reproduction:** Source trace

**Exact fix / expected behavior:** Label feature accurately and retain zero live adjustments. First collect audited entry/rejection/fill/outcome data; implement offline labeled evaluation before any bounded, versioned, rollback-capable adaptation. Remove/deactivate unused learning controls if no implementation is intended.

**How to prove it:** UI explains observation-only status; nonzero adjustments require an explicitly approved/versioned model and out-of-sample acceptance tests.

### APEX-AUDIT-027 — Same magic allows competing EA instances to manage the same basket

**P2 · Ownership** — `ea/XauCloud-Apex.mq5`, lines 16,281–285,494, `CountPos / StateFile / OnTimer`.

**Current behavior / root cause:** Ownership is account terminal positions filtered only by symbol and magic, without a single-writer lock or instance identity.

**Impact:** Two charts on the same symbol/magic can submit duplicate entries, overwrite state and issue competing exits.

**Evidence / reproduction:** Source trace

**Exact fix / expected behavior:** Enforce one active manager per account+symbol+magic with terminal-level lock/lease and explicit takeover reconciliation. Persist unique campaign IDs with sufficient entropy; do not derive uniqueness only from seconds.

**How to prove it:** Attach two instances simultaneously; one becomes observer-only. Crash/takeover preserves open campaign and never duplicates an order.

### APEX-AUDIT-028 — Live settings can change campaign policy inconsistently

**P2 · Configuration semantics** — `ea/XauCloud-Apex.mq5`, lines 151–187,361,364–478, `ApplyRemoteConfig / Start / Manage`.

**Current behavior / root cause:** targetEq is frozen at campaign start while profile and most ratchet/entry settings change immediately. Changing profile toggles master/BE/recovery protections mid-campaign.

**Impact:** A TP save may apply only next campaign while profile change immediately removes protection; UI does not communicate this distinction.

**Evidence / reproduction:** Source trace

**Exact fix / expected behavior:** Version/snapshot campaign policy. Define next-campaign settings and allowable tighten-only live protection changes. Report desired, applied and effective-from fields; reject dangerous mid-campaign profile changes.

**How to prove it:** Change TP, profile and ratchet during an open basket; behavior matches explicit timing, preserved protections and displayed applied policy.

## Evidence appendix

### Audio review status

To finish promptly following the user's request to reduce further usage, the slow local automated transcription pass was stopped after a complete V1 transcript and a partial V2 transcript. **V3–V7 narration was not independently transcribed or reviewed in this audit.** All seven have the full-duration sampled visual coverage described above. The audit is therefore a completed source/visual assessment with this explicit media-coverage limitation, not a claim of complete audiovisual forensic reconstruction.

The V1 automatic transcript around0:43–0:54 says he reads price action and does not want to chase; around1:08–1:29 he describes pullbacks as additional entries. Around3:08–3:25 he describes a high-risk small-account challenge and the importance of waiting. V2 around0:38–1:14 names ICT, an upper/premium area, prior-high liquidity sweep, weakening buyers and seller displacement; around1:23–1:39 he describes rejecting higher prices and adding in planned areas. This supports the reversal/zone model, but does not prove exact candle rules or that every execution complied. Automatic recognition contains obvious word errors, so these are paraphrases, not certified quotations. Narration cannot validate account authenticity or remove the visual evidence of initial negative P/L.

### Reproducibility and source coverage

- [EA diagnostic output](docs/audit-evidence/2026-09-07/ea-diagnostics.jsonl), [C++ harness](docs/audit-evidence/2026-09-07/ea-diagnostics.cpp), [extraction script](docs/audit-evidence/2026-09-07/build_diagnostics.py).
- [Actual server diagnostic output](docs/audit-evidence/2026-09-07/server-diagnostics.json), [server diagnostic script](docs/audit-evidence/2026-09-07/server-diagnostics.mjs).
- [Existing test run](docs/audit-evidence/2026-09-07/baseline-tests.log):76 tests,76 passed,0 failed.
- [Source inventory and SHA256 hashes](docs/audit-evidence/2026-09-07/source-manifest.json). At audit completion, the isolated repository under workspace `work/XauCloud-Apex` had no tracked changes. This later publication adds audit documents and diagnostic evidence only.
- Video evidence index (retained in the original local workspace: `outputs/evidence/VIDEO_EVIDENCE.md`), with sampled entry sheets and the V6 ending.
- V1 automated transcript (retained in the original local workspace: `outputs/evidence/transcript1.txt`) and partial V2 automated transcript (retained in the original local workspace: `outputs/evidence/transcript2.txt`). Timestamp coverage is visible in each file.

Harness scope: actual Observe, NormVol/VolumeForMargin, AddSignal and Manage bodies were extracted. Rates, time, quotes, positions, CloseAll, OpenLayer and other platform functions were stubbed. These diagnostics isolate logic; broker adapters do not simulate every terminal behavior. The C++ compiler used the locally installed CommandLineTools SDK; this does not constitute native MQL compilation. Scripts retain workspace-relative paths for reproducibility from the original workspace.

### Official execution references

CTrade Boolean success does not establish that a trade actually executed; check server result and deal information. See [MetaQuotes CTrade Buy documentation](https://www.mql5.com/en/docs/standardlibrary/tradeclasses/ctrade/ctradebuy). Stop modification likewise requires checking the trade-server return code: [PositionModify documentation](https://www.mql5.com/en/docs/standardlibrary/tradeclasses/ctrade/ctradepositionmodify).

WebRequest is synchronous and unavailable in Strategy Tester: [MetaQuotes WebRequest documentation](https://www.mql5.com/en/docs/network/webrequest). Timer events do not accumulate while an earlier timer event is already queued/processing: [OnTimer documentation](https://www.mql5.com/en/docs/event_handlers/ontimer). Consequently, a passing tester run cannot verify live cloud latency or license transport behavior.

### Remaining evidence needed for live attribution

The actual3.7.1 EX5/build hash and Inputs export; recent broker deal/position history including commissions; Experts/Journal logs around poor entries; account mode and symbol contract specifications; dated bid/ask tick history spanning setup and entry. These were unavailable, so the report does not assign individual losses to a defect or promise a measured improvement. The inspected XauCloud counterpart and actual deployment also need revision reconciliation before implementing integration fixes.
