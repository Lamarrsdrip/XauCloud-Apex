# Apex 4 historical validation

This study evaluates the existing independent Apex pullback candidate on the
verified Exness XAUUSD price archive. It is research for the separate demo
candidate. Live operation, leverage risk and position liquidation require
broker telemetry and independent execution tests.

## Price evidence

All 60 monthly gzip files matched the pinned hashes and monthly row counts
in `data/gold_history/manifest.json`. The archive has 1,765,848 unique,
chronologically ordered and valid minute OHLC rows. It begins 2021-11-01
00:00 UTC and ends 2026-10-30 20:57 UTC. There are 1,508 gaps longer than one
minute, including session and market closures. There are 37 zero-spread
archive rows. The replay models a positive executable spread explicitly.

The reference episodes already include September and October 2026. The
2026 January–October interval is a chronological historical holdout with
that limitation. The separate November exam uses 7,606,941 Exness ticks
converted to 26,089 M1 rows after the engine and split boundaries were set.
The sample runs from 2026-11-02 00:01 WAT to 2026-11-27 00:59 WAT. Its raw ZIP
passed CRC verification and has SHA-256
`c4914d04fef174e6e282814c46aebaca766c623afe8aa02f39e36c02ce2a10c3`.
The compressed minute file in this run has SHA-256
`400d88e8d632c6be78ae7742e4d41a234d96d5332a4e3bba9309c5a6527bf10e`.
[Exness November tick archive](https://ticks.ex2archive.com/ticks/XAUUSD/2026/11/Exness_XAUUSD_2026_11.zip)

| Partition | UTC coverage | M1 bars |
| --- | --- | ---: |
| Train | Nov 2021–Dec 2024 | 1,117,779 |
| Validation | Jan–Dec 2025 | 353,081 |
| Historical holdout | Jan–Oct 2026 | 294,988 |
| Separate exam | Nov 1–26, 2026 | 26,089 |

The candidate consumes M1, M5, M15 and H1 bars that have already closed.
Each decision uses the next minute's opening quote as the executable quote.
The replay checks the stop first when an M1 candle reaches both exit levels.
It tracks a 20-minute campaign horizon, retains early stopping and omits
trades whose outcome window crosses a partition. All returns use initial
risk units. Gross dollar equity and lot-size drawdown require separate
broker data and execution evidence.

The baseline uses $0.30/oz spread, $0.10/oz slippage per side and $0.07/oz
round-trip commission. Lower- and higher-cost scenarios use
$0.20/$0.05/$0.07 and $0.50/$0.20/$0.10, respectively. These are
configurable sensitivity assumptions. The underlying archive is MID OHLC,
so this experiment approximates the executable bid/ask path at minute
resolution. It cannot resolve intra-minute order with certainty.

## Production Outlook evidence

The public production performance response contained 1,927 resolved
XauCloud outcomes from August 5 to November 27. It reported 782 wins,
583 losses, 103 partial profits and 459 breakevens. The reported decisive
win rate was 57.3% and the gross recorded mean was +0.31R. Individual public
cards cover the latest 200 outcomes and carry closure time. Issue time,
executable path and complete setup evidence are required for a WAT-hour
training label. [Production Outlook performance](https://xaucloud.io/api/outlook/public-performance?limit=200)

The public walk-forward response reported 1,682 scored signals. Session
labels were unknown on 1,397. In its separate 306-signal price-path verification
subset, the recorded published plans had a 58.5% win rate, −7.9 pips of
expectancy, 0.78 profit factor and 4,395 pips of maximum drawdown. These
statistics describe selected XauCloud source records and differ in coverage
and outcome rules from the public gross aggregate.
[Production walk-forward review](https://xaucloud.io/api/outlook/ai-walk-forward)

| Session label in the public review | Signals | Published-plan expectancy |
| --- | ---: | ---: |
| Asia | 92 | +16.4 pips |
| London | 99 | +15.3 pips |
| New York | 40 | +8.4 pips |
| Late | 41 | +7.9 pips |
| Fix | 13 | +35.9 pips |
| Unknown | 1,397 | +9.4 pips |

The Fix group had 13 observations. The public record gives no basis to
map that result to a specific WAT hour or rank news and overlap windows.

The authorized Windows VPS connection reached the MongoDB listener.
MongoDB required an existing authorized database session to read collections.
Atlas separately reported that organization-level MCP access was disabled.
The private production Outlook, AI education, live trade and Global Brain
collections could not be exported. This run learned from prices and
simulated candidate outcomes. Production public statistics stayed outside
training. The knowledge output has zero private Outlook cases and zero
verified WAT window permissions.

The VPS also supplied one older MT5 strategy-research export from July
24–29, 2026, with 12 open, 12 close and 60 post-close events under v6.25.12.
Ten closes were profitable. Recorded net was \$131.32 and mean adverse
floating movement was \$593.71 per trade in that test account.
It informs comparison with the earlier research and is excluded from Apex's
new train/validation selection. Earlier real-tick Strategy Tester reports
counted 40 June and 36 July v6.25.30 trades. Their maximum equity drawdowns
were 13.81% and 21.95%. They describe a previous XauCloud EA and its test
account. No raw trade or account data is committed.

## Original correction-only benchmark

| Partition | Cases | Win rate | TP2 | Mean adverse excursion | Expectancy | Max drawdown |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Train | 1,243 | 28.4% | 24.6% | 1.164R | −0.433R | 538.10R |
| Validation | 879 | 31.1% | 28.2% | 1.116R | −0.317R | 280.90R |
| Historical holdout | 864 | 31.9% | 28.8% | 1.171R | −0.226R | 202.87R |

The original candidate had zero groups that passed train and validation,
even at the $0.30/oz spread and $0.10/oz slippage assumptions before
commission. The return and adverse movement show why a stretched market
alone is insufficient evidence for a reversal.

## Updated pullback replay

The updated candidate reads trend alignment and structure before scoring a
retracement. It looks for a liquidity sweep, rejection or structural reclaim
within an intact parent trend. Momentum recovery and local entry room affect
whether the first executable quote still qualifies. The countertrend family
continues to evaluate corrections separately. The replay observed 5,580
baseline setups before the November exam and another 142 in the exam.

| Partition | Cases | Net winners | TP1 touched | TP2 hit | Stop hit | Net expectancy | Net result | Max drawdown | Mean adverse | Mean favorable |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Train | 1,965 | 29.2% | 40.4% | 26.0% | 68.2% | −0.471R | −924.55R | 924.55R | 1.126R | 0.645R |
| Validation | 1,770 | 31.1% | 44.4% | 28.4% | 66.2% | −0.361R | −638.60R | 643.50R | 1.106R | 0.723R |
| Historical holdout | 1,845 | 32.7% | 46.3% | 29.7% | 65.2% | −0.260R | −479.56R | 489.82R | 1.122R | 0.853R |
| November exam | 142 | 35.2% | 52.1% | 31.7% | 62.0% | −0.206R | −29.22R | 30.65R | 1.075R | 0.876R |

The simulated basket exits at TP2, the stop, or the horizon. TP1 is a
path observation. It does not book a partial profit. A net winner earns
more than zero after the stated costs. The excursion columns measure the
average maximum adverse and favorable movement during each observed basket
in initial-risk units. Drawdown is measured in cumulative R over successive
non-overlapping observations.

| November baseline family | Cases | Net winners | TP1 touched | TP2 hit | Net expectancy | Max drawdown | Mean adverse | Mean favorable |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Countertrend correction | 74 | 37.8% | 54.1% | 35.1% | −0.128R | 12.09R | 1.080R | 0.935R |
| Trend pullback reclaim | 68 | 32.4% | 50.0% | 27.9% | −0.290R | 20.53R | 1.070R | 0.813R |

Both families lost in November. The trend pullback cohort had slightly
lower adverse movement and reached TP2 less often. The gap between TP1
and TP2 completion is evidence to investigate follow-through and exit
handling in a future training cycle. This test kept the existing TP2 basket
policy throughout.

| November cost scenario | Cases | Net winners | TP1 touched | TP2 hit | Net expectancy | Net result | Max drawdown | Mean adverse | Mean favorable |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Lower | 149 | 39.6% | 57.7% | 36.2% | −0.047R | −7.05R | 10.20R | 1.009R | 1.011R |
| Baseline | 142 | 35.2% | 52.1% | 31.7% | −0.206R | −29.22R | 30.65R | 1.075R | 0.876R |
| Higher | 124 | 33.9% | 44.4% | 28.2% | −0.294R | −36.48R | 38.76R | 1.094R | 0.768R |

Each scenario rescans the archive at its executable spread. Spread changes
the entry assessment and the number of cases as well as the return.

### Entry timing

The immediate entry is the first archived minute open at which Apex has
enough closed evidence and an executable quote. The comparison keeps its
levels and checks whether entry one or three minutes later would still be
available. Each delayed simulation has its own initial risk. Matched results
only compare cases that remained executable. The separate counts capture
plans that reached TP2, moved beyond the entry range, or hit invalidation
before the delayed quote. M1 data does not establish the earliest eligible
intra-minute tick or whether an additional confirmation signal appeared.

| Baseline partition | Delay | Matched cases | Immediate net expectancy | Delayed net expectancy | TP2 missed | Beyond entry | Invalidated | Unscorable |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Train | 1 min | 1,508 | −0.391R | −0.477R | 10 | 117 | 329 | 1 |
| Train | 3 min | 850 | −0.339R | −0.445R | 73 | 275 | 767 | 0 |
| Validation | 1 min | 1,379 | −0.298R | −0.363R | 3 | 106 | 282 | 0 |
| Validation | 3 min | 816 | −0.190R | −0.296R | 89 | 205 | 660 | 0 |
| Historical holdout | 1 min | 1,476 | −0.197R | −0.265R | 11 | 101 | 257 | 0 |
| Historical holdout | 3 min | 909 | −0.168R | −0.291R | 138 | 176 | 619 | 3 |
| November exam | 1 min | 122 | −0.244R | −0.239R | 0 | 11 | 9 | 0 |
| November exam | 3 min | 77 | −0.148R | −0.013R | 8 | 15 | 42 | 0 |

November's three-minute matches improved expectancy and reduced mean adverse
movement from 1.058R to 1.013R. Mean favorable movement rose from 0.971R to
1.053R. The delayed entry was unavailable for 65 of 142 original cases,
including eight that had already reached TP2. Earlier historical partitions
favored the immediate entry within their own matched cohorts. The timing
effect varied across periods and all matched November variants lost after
costs.

### Selection and reproduction

A group requires at least 25 training cases, 10 validation cases and positive
after-cost expectancy in both periods. Twenty-four groups were evaluated.
None met the requirements. The resulting portfolio had zero cases in both
holdout periods and no trading eligibility. The full experiment also requires
any future preselected portfolio to clear the separate exam as a whole with
at least 10 cases and positive net expectancy. The exam does not select
individual groups. The price-only artifact has no private Outlook calibration
cases and no verified WAT windows.

From the repository root, set the first path to the verified November minute
file and the second to a new private output file. Use Node 22.

```bash
apex_unseen_file=/path/to/XAUUSD_M1_2026_11.csv.gz
apex_knowledge_file=/private/path/apex4-validated.knowledge.json
node --experimental-strip-types --max-old-space-size=2048 scripts/train-apex4-knowledge.mjs \
  --archive-only data/gold_history "$apex_knowledge_file" 0.30 0.10 \
  --commission-per-ounce 0.07 --cost-sensitivity \
  --unseen-file "$apex_unseen_file" \
  --unseen-sha256 400d88e8d632c6be78ae7742e4d41a234d96d5332a4e3bba9309c5a6527bf10e
```

The learning output contains rules and replay aggregates. Source archives,
broker records and production exports stay in their existing storage.
