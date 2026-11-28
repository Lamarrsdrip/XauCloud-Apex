# Apex 4 pullback education results

[Download the full classroom and inspect every November trade](../research/evidence/apex4-pullback-education).

## Result

Apex studied 233,881 historical lesson snapshots across 58,903 directional impulse episodes. The classroom persisted 1,784,517 outcome records, including price-path labels and alternate execution policies. The detector learned to distinguish a developing correction, recovery by rejection or momentum, a sweep followed by recovery, a structural reclaim, a late entry and a broken parent structure using closed candles and a contemporaneous quote.

**None of the 66 measured groups qualified for demo execution.** Twenty-four groups lacked 70 usable non-overlapping training examples. All 42 groups with adequate training samples had negative training expectancy under their selected holding policy. The final model therefore carried zero approved rules. The evidence supports continuing to observe and classify pullbacks. An executable edge under the tested geometry remains unproven.

The original 142-case November result remains **−29.22R** after costs. The new education examined a much wider opportunity set. The reference detector produced **+2.02R** on 29 modeled setups in one separately sealed session on November 27 UTC. The tested educational model issued zero qualified entries. The session is too small to establish a repeatable edge.

## Inputs and chronology

| Role | UTC dates | Lesson snapshots | Usable sequential diagnostic cases |
| --- | --- | ---: | ---: |
| Training | Nov 2021 to Dec 2024 | 148,234 | 15,073 |
| Practice | Jan to Jun 2025 | 22,173 | 3,029 |
| Validation | Jul to Dec 2025 | 22,743 | 3,271 |
| Known development | Jan to Nov 26, 2026 | 40,731 | 6,540 |
| Separate forward observation | Nov 27, 2026, 00:00 to 19:44 | 166 | 29 reference cases |

The base Exness archive contains 1,765,848 M1 bars. The scan verified the count and SHA-256 of each of 60 monthly files against the pinned manifest. Known November contains 26,089 more bars from 7,606,941 ticks. The November 2–27 WAT outcomes published in the original report are development data. Earlier investigations had also seen parts of 2026.

The scanner reads executable synthetic bid and ask at the next minute open. All M1, M5, M15 and H1 features come from candles that closed by that timestamp. Snapshots retain the source hash, exact timestamps, impulse and correction extrema, trend agreement, depth, pressure, acceleration, volatility, reclaim and rejection evidence. A lesson is the first observation of a distinct measurable state within its directional impulse episode. The outcome table is separate. Longer outcome windows are purged from rule selection when they cross a chronological split. Multiple snapshots can describe the same episode. Rule and portfolio statistics use at most one position per episode and one modeled position at a time.

The separate answer sheet found 153,593 impulse retests, 42,075 structural invalidations, 28,997 unresolved observations, 9,143 censored observations and 73 same-minute ambiguities in the bounded path. These price-path labels include observations without executable geometry. With the 20-minute reference exit, 66,924 actionable lesson snapshots had usable outcomes, of which 26,866 earned money and 40,058 lost. The snapshots can overlap and represent education cases rather than a portfolio.

The development model was frozen before the separate forward prices were scored. Its identifier is `d689e99e44c17114c8c05beb302110455b991a04e0299f2d259a41d9483e3084`. The frozen JSON SHA-256 is `6bc46d1b6964252bb7a4e7d4206dfd8a62adf77d15f3894f3ec63071ec075d12`. The examined JSON SHA-256 is `92e805a002a5392df916e8b77605cf20bc676c3d4cc3a1fdfa1495e54f9f7dfe`. The forward M1 input had SHA-256 `1d75cd05ebaa0aac0ad26c8f6ccfa9fb713c85c7d683203dcd94a3eab64be112` and 1,185 bars derived from 376,841 CRC-verified Exness ticks. The lab records one forward exam per model version. [Forward Exness archive](https://ticks.ex2archive.com/ticks/XAUUSD/2026/11/27/Exness_XAUUSD_2026_11_27.zip)

## Diagnostic performance after costs

The unrestricted classroom reference uses full TP2 exit with the structural stop and 20-minute cap for comparison. It models $0.30/oz spread, $0.10/oz per-side slippage and $0.07/oz round-trip commission. One R is the filled-entry-to-initial-stop distance. Drawdown uses successive equal-R, non-overlapping modeled positions. Leveraged account drawdown requires broker execution evidence.

| Cohort | Cases | Win rate | TP1 | TP2 | R per case | Net R | Profit factor | Max drawdown R | MAE / MFE |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Original November sample | 142 | 35.2% | 52.1% | 31.7% | −0.206 | −29.22 | 0.695 | 30.65 | 1.075 / 0.876 |
| Classroom training reference | 15,073 | 34.9% | 45.2% | 27.9% | −0.428 | −6,449.93 | 0.326 | 6,449.93 | 0.901 / 0.456 |
| Classroom practice reference | 3,029 | 42.1% | 53.5% | 36.9% | −0.288 | −870.86 | 0.497 | 877.14 | 0.884 / 0.593 |
| Classroom validation reference | 3,271 | 44.5% | 53.7% | 38.1% | −0.239 | −782.93 | 0.561 | 784.43 | 0.879 / 0.615 |
| Classroom known development reference | 6,540 | 45.3% | 56.1% | 39.7% | −0.182 | −1,192.99 | 0.661 | 1,201.19 | 0.894 / 0.730 |
| Separately sealed session reference | 29 | 58.6% | 72.4% | 48.3% | +0.069 | +2.02 | 1.158 | 2.63 | 0.800 / 0.949 |
| Forward examined, frozen rule set | 0 | — | — | — | — | — | — | — | — |

The rows cover distinct opportunity sets and sample periods. The matched comparison below isolates the policy changes on the original 142 opportunities.

### Which evidence helped

- A momentum recovery needed favorable M1 pressure and acceleration. A sweep recovery also needed a measured wick sweep of a confirmed swing. A structural reclaim needed a break or shift back in the proposed direction. The classifier recorded pre-entry pressure, confirmed structure and volatility independently of the future outcome.
- In 2026 development data, momentum recovery averaged −0.127R over 3,534 geometry-valid, individually non-overlapping examples. Rejection averaged −0.168R over 4,229, reclaim averaged −0.155R over 4,021, and a sweep with recovery averaged −0.139R over 444. Developing setups were worse at −0.249R over 8,182. The stage cohorts can refer to different states in the same episode.
- Late entries had an 83.8% net win rate across 1,633 modeled examples and still lost −0.044R per example. The remaining target was small relative to the loss when the retracement failed. In the sequential 2026 reference, the average win was +0.784R and the average losing magnitude was 0.983R. In the training reference that imbalance was larger.
- In validation, deep retracements averaged −0.282R, moderate −0.365R and shallow −0.395R. The strongest train-ranked group, a moderate momentum recovery in a mixed trend, remained negative at −0.158R training, −0.191R practice and −0.101R validation. Aligned deep sweep recovery had +0.105R over only 14 validation examples and negative train and practice results. Neither became a rule.
- The measured snapshots include failed follow-through and opposite structural breaks. M1 OHLC does not identify resting liquidity or the cause of each loss. Mixed-trend classroom cases are distinct from the original strategy’s countertrend-correction cohort. Known market results were used to label examples. Runtime selection uses the observable features and the forward-qualified rule set.

### Entry timing and windows

The broad 2026 actionable timing cohort contained 15,382 opportunities. At three minutes, 9,731 still replayed. The others included 2,434 prior invalidations, 2,227 early TP2 completions, 964 plans already beyond entry and 26 censored cases. Per evaluable opportunity, immediate entry returned −0.144R, one minute −0.130R, two minutes −0.116R, three minutes −0.100R and five minutes −0.082R. Misses contributed zero P&L and censored data were separately tracked. Filled-only profit factors were below 1 for every delay. The three-minute limit policy filled 9,109 cases with −0.117R per evaluable opportunity. In the same historical cohort, entries within two minutes of the correction extreme averaged −0.233R in the sequential reference. Those first seen after at least five minutes averaged −0.083R. These groups contain different setups. That observation supplies no basis for a universal delay.

The classroom calculated every WAT hour, Tokyo, London, New York, the London/New York overlap, WAT weekdays and M5 ATR buckets. The best validation hour with at least 30 cases was **15:00 WAT**, at −0.143R over 360 cases. At 09:00 WAT the result was −0.232R over 292 cases. The least negative labeled validation session was the London/New York overlap at −0.283R over 1,135 cases. Asia returned −0.321R, London −0.363R and New York −0.401R. No window qualified. A historical economic-release calendar matched to executable prices was unavailable, so news-condition rankings remain unverified.

## Original November entries tested with different policies

The old stop is the farther adverse M1 wick or last confirmed adverse M1 swing plus a buffer of 0.25 times the 14-bar M1 ATR and quoted spread, rounded to $0.01/oz. After allowing for entry slippage, its median distance was **$2.553/oz**, or **25.53 pips** at $0.10 per XAUUSD pip and **255.3 price points** at $0.01. P10 and P90 were $1.646 and $5.426/oz. The comparable expanded 2026 reference had a $4.571 median initial-risk distance. The demo EA rounds transmitted SL and TP2 to broker tick size and checks minimum stops, spread, margin, volume and campaign risk.

| Original November policy | Modeled fills | Net R | Notes |
| --- | ---: | ---: | --- |
| Full TP2, 20 minutes | 142 | −29.22 | Original |
| Full TP1, 20 minutes | 142 | −24.08 | 52.1% net wins |
| Half at TP1, half at TP2 | 142 | −26.65 | Unmoved stop on remaining half |
| Half at TP1, protected remainder | 142 | −25.42 | Cost-adjusted protection from next bar |
| Trail after TP1 | 142 | −29.92 | Half-initial-risk trail |
| Momentum exit | 142 | −28.59 | Next quote after observed deterioration |
| Structure exit | 142 | −29.76 | Next quote after confirmed invalidation |
| Confirmed-pivot stop | 117 | −27.52 | 25 invalid geometries |
| Volatility stop, 1.5 ATR plus spread | 142 | −14.19 | Median $3.368 risk, PF 0.816 |
| One / two / three / five minute delay | 122 / 92 / 77 / 50 | −29.12 / −18.07 / −1.02 / −7.89 | All 142 counted in opportunity denominator |
| Limit at 25% improvement in original risk | 118 | −22.23 | Five-minute entry life |

The original **20-minute limit** was also a hardcoded demo EA campaign deadline. On the matched cohort, 10, 20, 30, 45, 60 and 120 minutes returned −41.19R, −29.22R, −27.01R, −29.09R, −29.17R and −29.53R respectively. The 120-minute run censored one case. The no-fixed-deadline variant bounded by the modeled New York session close returned −26.80R with six censored cases. The original median time to TP1 was 2.5 minutes and median time to TP2 was 7 minutes among hits. In the broad 2026 120-minute reference, median TP2 was 7 minutes and its 90th percentile was 34 minutes. This supports measuring duration as part of a qualified policy. It does not qualify a duration by itself.

Of the 85 original stop exits with complete later coverage, 44 crossed the original TP2 price within 60 minutes. A later price crossing describes the subsequent path. Stop placement requires comparing the full cost- and risk-adjusted replay. The alternate stop replay charged the new price risk and modeled costs. It still lost. The broader 2026 cohort also lost on the volatility stop variant at −0.154R per evaluable opportunity versus −0.144R for its default.

On the original fixed 142 plans, lower and higher modeled costs returned −19.74R and −57.25R. The prior report's sensitivity rescanned eligibility and produced different opportunity counts. The new expansion uses fixed geometry for its cost comparisons, which returned −0.096R and −0.242R per evaluable opportunity under lower and higher costs. The archived tick sensitivity processed all 7,606,941 bid/ask rows in timestamp order. The source ZIP contained one day block out of order. Mean starting spread was $0.165/oz. With modeled slippage and commission, TP2 returned −25.43R, TP1 −20.02R, partial −22.73R and protected partial −22.16R. This verifies the price paths and modeled returns. Live fills and fees require brokerage records. [Detailed execution methodology](APEX4_PULLBACK_EXECUTION_RESEARCH.md)

## XauCloud evidence recovered

Apex reuses XauCloud's closed-bar features, directional resolver, Outlook grading and timing principles, and its pinned native M10 producer from the previous integration. The earlier native parity report gives the exact comparison and its limits. Apex computes its own market evidence from its broker feed. [Native evidence](APEX4_NATIVE_EVIDENCE.md)

A read-only Windows VPS retrieval recovered original XauCloud demo telemetry. The importer checks the original hashes and persists reference records separately in SQLite, preserving terminal timestamps and source roles. It excluded dates from Nov 26 terminal time onward to keep a conservative buffer before the sealed test. The imported evidence contains:

- 901 TradeBrain events, including 129 closes labeled 73 normal wins, 55 normal losses and one quarantined execution outlier. Of the 100 non-quarantined closes with usable entry capture, 58 winners had median adverse Gold movement of $2.905/oz and 42 losers had median favorable movement of $2.296/oz.
- 1,288 original blocked observations and 6,399 subsequent checkpoints. The imported records preserve their original missed-opportunity labels.
- 112 TimingProof records, with a 150.5-second median recorded engine wait. This is a source-specific XauCloud measurement and has no direct Apex P&L interpretation.
- 174 earlier trade-memory events, including 36 close events, plus eight v6.28.6 M10 snapshots. M10 snapshots contain native indicator evidence and carry no fabricated closing labels.

The XauCloud v6.25.24 90-day tester audit independently joins 155 exact open/close pairs, preserves post-close observations and excludes a quarantined execution outlier from learning. Its 30-day M10 brain produced 50 exact fingerprints from only 57 outcomes and its documented walk-forward reduced net P&L versus the underlying policy. That supports coarse families and sample thresholds. Source-version results, demo fills and Apex modeled outcomes retain distinct provenance. The XauCloud imports inform the education report and remain reference material until matching input definitions, entire trade paths and labels support calibration.

Private Hostinger production Hourly Outlook, AI education, bot and Global Trade Brain MongoDB collections were not recovered. Their admin APIs required an authenticated admin session and the Atlas organization still blocked AI client access. The Windows VPS supplied the local MT5 exports listed above. Source data and the sanitized local reference database stayed off GitHub.

## Runtime and verification

The candidate runtime uses the same closed-bar recognizer as the historical classroom. A qualifying artifact can set the hold duration immediately at the first evaluated quote for the pattern. The version test uses the same recorded prefix to prove 30- and 60-minute validated versions produce distinct demo wire decisions, while malformed, unexamined and undersized versions produce no education order. The actual frozen manifest has no rules, so the verified local dashboard reported 233,881 lessons, 29 forward reference simulations and zero qualified groups. The original M10 and Hourly Outlook paths retain their independent authorization.

The Trade Brain records immutable pre-decision evidence, model identity, enrollment, price-path outcomes and account-scoped acknowledgements and fills. Skipped, invalidated and censored paths are retained. Simulated quote outcomes are marked separately from broker costs, partial exits, MFE/MAE and linked historical deals. The live process builds versioned research challengers and observes a fixed forward comparison. Manual promotion/rollback applies to research versions. Execution-authorized artifacts still require a separate frozen examination. Recognition and execution run on deterministic features and compiled policy. Optional chat reads the same records.

The compiled demo binary is `XauCloud-Apex-v4.0.0-DEMO-Candidate-f40ec18e127e.ex5`. Genuine MetaEditor returned **0 errors, 0 warnings**. Its EX5 SHA-256 is `7dddcfb1ceb7fb4197cba9af9a80d6840f7c6f2718105869ffe717774c147983`. Source SHA-256 is `f40ec18e127e3a9d3f658eb3a1a6d19508b01903b4cf07b65a24ffffbed63da0`. The verification used offline replays and a disarmed preview. Broker liquidation, actual slip, scale-in behavior and partial fills remain execution-test evidence requirements. The existing stable delivery binary and version manifest were outside this release.

### Reproduction and staging

Use Node 22 or later. Put verified private inputs and the SQLite database outside the worktree. The examiner requires a previously frozen database receipt and rejects repeated scoring of that version.

```bash
node --experimental-strip-types --max-old-space-size=2048 scripts/apex4-pullback-classroom.mjs \
  scan /private/path/lessons.sqlite data/gold_history /private/known/november/XAUUSD_M1_2026_11.csv.gz
node --experimental-strip-types --max-old-space-size=3460 scripts/apex4-pullback-classroom.mjs \
  study /private/path/lessons.sqlite data/gold_history /private/known/november/XAUUSD_M1_2026_11.csv.gz /private/path/frozen.json
node --experimental-strip-types --max-old-space-size=2048 scripts/examine-apex4-pullback.mjs \
  /private/path/lessons.sqlite /private/path/frozen.json data/gold_history \
  /private/known/november/XAUUSD_M1_2026_11.csv.gz /private/sealed/XAUUSD_M1_2026_11.csv.gz \
  1d75cd05ebaa0aac0ad26c8f6ccfa9fb713c85c7d683203dcd94a3eab64be112 /private/path/examined.json
python3 scripts/import-apex4-xaucloud-lessons.py /private/authorized/vps/export /private/path/xaucloud-reference.sqlite
```

Set `APEX4_CANDIDATE=1` and `APEX4_EDUCATION_FILE` to the examined artifact on isolated demo staging. Compare completed price- and broker-based observations before evaluating further versions. The standard MetaEditor command writes the checksum-stamped EX5 and build log into Downloads.

```bash
cd "$HOME/Apex4-intelligence-20261127" && bash scripts/compile-apex4-mac.sh
```
