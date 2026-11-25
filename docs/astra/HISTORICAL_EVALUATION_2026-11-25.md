# Historical evaluation — 25 November 2026

Source: Claude's `research/results/*` and continuation handover, not an independent reproduction in this GPT session. Archive: 60 months, 1,765,848 XAUUSD M1 midpoint bars (Nov 2021–Oct 2026), split by chronology. Fixed-horizon first-touch, spread approximation; same-minute ambiguity adverse. No real-tick or executable fill validation.

| Method | Train | Validation | Held-out |
|---|---:|---:|---:|
| Random | 41.9% | 46.6% | 47.9% |
| Native | 36.9% | 49.2% | 43.8% |
| Engine | 42.2% | 46.2% | 47.1% |
| H5 reference composite | 44.2% | 50.7% | 46.9% |

Metric: resolved +1 M3 ATR before −1 ATR, after spread proxy. The engine recognizes three anchored examples earlier than visible trader fills, but misses V4; native misses all four. Recognition does not establish edge. H5 does not outperform the random baseline on the held-out period. The original handover discloses an accidental early held-out run before freeze (only counts seen); further, some source clips come from 2026, so the retrospective reference family selection is not a pristine holdout. Report these limits rather than treating the figures as proof of profitability.

The new blind replay and benchmark are research tools. A provider comparison requires actual user-authorized API access. A model's confidence is not calibrated by default. No strategy is automatically promoted.
