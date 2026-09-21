# Apex v3.8.8 replay findings and improvement plan

Date: 2026-09-22  
Baseline: `bf970909308db4fc1197b7add9e1215afe9cd068`  
EA identity: `XauCloud-Apex_v3.8.8-UnlimitedFromL3`

## Decision

Apex v3.8.8 is not generally entering too late because of slow execution. Across 20 native MT5 Strategy Tester days, the median delay from confirmation to fill was 0.25 seconds. The delay before confirmation was much longer (median 180.5 seconds), but removing or broadly relaxing rejection confirmation made entry quality worse in direct replay tests.

The evidence supports one narrow entry-quality improvement: reject candles whose rejection wick is too small relative to the candle body. The only baseline entry that never became profitable had a wick/body ratio of 0.045. Every other observed baseline entry had a ratio of at least 0.172. A provisional floor of 0.10 is therefore being validated. It must not be merged into the strategy until the full candidate and untouched holdout replays pass.

The first operational fix is deployment consistency. The active demo terminal was running `XauCloud-Apex_v3.8.7-UnifiedMarginLadder`, while the requested baseline and these replays use v3.8.8. The supplied September loss screenshots also reflect older v3.8.6/v3.8.7-era behavior and an older UNLIMITED configuration. Those outcomes cannot be used as proof of a v3.8.8 defect until the exact EA build and configuration are aligned.

## Replay scope

The baseline was run in native Windows MetaTrader 5 with:

- XAUUSDm
- fresh $1,000 balance for each day
- 1:2000 account leverage
- Every tick based on real ticks
- Visual Mode enabled
- original aggressive sizing and campaign behavior
- untouched v3.8.8 paired with a telemetry-only build

The study covered 20 historical dates. Every untouched/telemetry pair produced identical deal rows, and every report showed 100% real-tick history quality.

| Measure | Result |
|---|---:|
| L1 entries | 20 |
| Dates with entries | 16 |
| Entries that became executable-price profitable | 19/20 |
| Entries with 1-minute MAE greater than MFE | 9/20 |
| Median time to first positive price | 6.142 seconds |
| Median 1-minute MFE / MAE | 0.963 / 0.938 |
| Median 3-minute MFE / MAE | 1.772 / 1.421 |
| Median detection-to-entry time | 180.5 seconds |
| Median confirmation-to-fill time | 0.25 seconds |
| Dates ending above / below $1,000 | 9 / 7 |
| Highest observed equity | $60,978.17 |

The six validation dates all moved profitably after the initial entry. Several later lost after building substantial equity. That is campaign management behavior, not evidence that the initial setup was random.

## What should be fixed

### 1. Enforce the rejection candle's quality

The August 24 replay is the clear bad-entry case:

- fresh $1,000 account
- one L1 entry
- zero favorable movement at 1 and 3 minutes
- 1-minute MAE 3.253 Gold price units
- 3-minute MAE 5.195
- lifetime MFE 0 and MAE 17.127
- maximum equity never exceeded the initial $1,000
- final result approximately -$76.74
- rejection wick/body ratio 0.045

The candle technically passed the current rejection boolean, but its wick did not show meaningful rejection. The smallest safe change is an additional rejection-strength condition:

```text
rejection is valid only when rejection_wick / max(candle_body, point) >= 0.10
```

This condition belongs inside the existing rejection predicate. It must not alter score thresholds, BOS, M3 confirmation, lot sizing, L1/L2/L3 behavior, stops, break-even logic, exits, or campaign mechanics.

Status: candidate compiled with zero errors and zero warnings; full replay and holdout validation is still in progress. This document does not authorize treating it as production-ready before those results are complete.

### 2. Make the deployed version and configuration visible and verifiable

The demo terminal and the tested source were not the same version. Before diagnosing future trades, Apex should expose the following in one startup line and on-chart status block:

- exact EA identity and build hash
- configuration hash
- account mode and actual leverage
- L1/L2/L3 sizing mode
- active setup rules and rejection-wick floor

The server should reject or prominently flag an unexpected EA identity. This prevents an older demo build from being judged as the current v3.8.8 strategy.

### 3. Preserve the useful confirmations

The replay evidence does not support entering as soon as a sweep appears.

- There were 118 watches where BOS, M3 and score passed while rejection remained the blocker.
- Only 50 of those 118 produced more favorable than adverse movement over the following three minutes.
- Their median 3-minute favorable movement was 1.111, versus median adverse movement of 1.953.
- Only one observed setup had rejection and M3 ready before BOS. Entering there would have produced 1-minute MFE 0.006 and MAE 2.422.

Therefore:

- do not remove rejection confirmation;
- do not remove micro-BOS;
- do not reduce the global score threshold to force more trades;
- do not treat every blocked watch as a missed valid setup.

### 4. Do not allow the sweep candle alone to trigger entry

A tested candidate allowed the sweep candle itself to satisfy rejection. It compiled successfully but failed replay validation:

- September 10 changed from approximately +$926 net to approximately -$2,803 net;
- August 25 changed from approximately +$2,788 net to approximately -$1,061 net;
- it created earlier entries, but those entries were not consistently better and caused fresh-account failures.

This relaxation should remain rejected.

### 5. Record decision telemetry in demo and production builds

The telemetry build proved that Apex can explain each decision without changing its trades. Keep lightweight records for:

- setup first detected
- sweep time and level
- rejection wick, body and ratio
- BOS state
- M3 state
- score and threshold
- current blocking reason
- confirmation time and fill time
- MFE/MAE at 1, 3, 5 and 15 minutes

This makes future “missed setup” reports testable. It also distinguishes a genuine late confirmation from a setup that never satisfied the original rules.

## What should not be changed from this study

Do not reduce aggression, lots, leverage assumptions, L1/L2/L3 sizing, stops, break-even behavior, exits, or campaign mechanics to make the equity curve look safer. Those changes were outside this investigation.

Campaign management deserves a separate study because some good entries built meaningful profit and later reversed. Examples include maximum equity of $1,679 before finishing near $156 on July 9, $1,226 before finishing below zero on August 21, $1,522 before finishing below zero on September 4, and $1,687 before finishing below zero on September 8. That is materially different from the August 24 bad entry, which never produced favorable movement.

## Acceptance test for the narrow fix

The 0.10 wick/body floor is acceptable only if all of the following are true:

1. It blocks or materially improves the August 24 never-profitable entry.
2. It preserves the other 19 observed baseline entries and their deal rows unless a changed entry also fails the same documented quality rule.
3. It does not worsen first-minute or first-three-minute MFE/MAE on unseen holdout dates.
4. It does not create new entries.
5. Native MT5 compilation remains at zero errors and zero warnings.
6. Every validation report uses 100% real ticks, Visual Mode, XAUUSDm, and a fresh $1,000 account.

If these conditions fail, keep the exact v3.8.8 strategy unchanged. The correct conclusion would be that the observed 0.045 ratio was an isolated failure rather than a safe general rule.

## Priority order

1. Align the demo deployment to the intended and verified EA version/configuration.
2. Complete the 0.10 rejection-wick candidate and untouched holdout comparison.
3. Merge the narrow rejection-strength guard only if it passes the acceptance test.
4. Add permanent decision telemetry so future demo trades can be compared directly with replay evidence.
5. Study campaign profit retention separately, without mixing that work into entry confirmation.

The central finding is that Apex v3.8.8 usually recognized a real setup and obtained favorable movement. Its confirmation system should be made more selective about the quality of the rejection candle, not broadly weakened to enter earlier.
