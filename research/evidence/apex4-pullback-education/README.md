# Apex 4 pullback research handoff

Inspect the November cases trade by trade or open the full classroom database. All trade outcomes here are historical simulations. The examined model qualified zero groups for execution.

## Start with the original 142 setups

| File | Contents |
| --- | --- |
| [November case ledger CSV](november-matched-cases.csv) | One row per setup with UTC time, direction, entry, stop, targets, modeled fills, result, MAE, MFE and later target touches |
| [November case ledger JSON](november-matched-cases.json) | The same 142 entry decisions with minute price paths, 24 M1 policy variants and four recorded-tick variants |
| [November comparison](november-comparison.json) | Aggregated results for all original policy and cost comparisons |
| [Original replay knowledge](original-replay-knowledge.json) | The original run's split counts, cost assumptions, entry timing and strategy groups |
| [Original validation report](../../../docs/APEX_V4_HISTORICAL_VALIDATION.md) | Detailed scope and methodology of the initial replay |
| [Execution policy comparisons](../../../docs/APEX4_PULLBACK_EXECUTION_RESEARCH.md) | Timing, holding duration, exits, cost and stop methodology |

### Why the short target still lost

For the **68 trend pullbacks**, the median TP1-to-TP2 distance was **$1.725/oz** and the median entry-to-stop distance was **$2.274/oz**. TP1 was approximately halfway from entry to TP2. The M1 replay recorded **32 stops before TP1**, **10 stops after a TP1 touch**, **19 TP2 completions** and **7 timed exits**. The bid/ask tick replay independently recorded 32 stops before TP1.

Among the 40 trend stops with enough later price coverage, 21 later crossed TP2 by 60 minutes from publication. Use `afterStopFirstTp1Utc` and `afterStopFirstTp2Utc` in the ledger to inspect those paths. A later price crossing measures where price went after the modeled exit. The ledger retains stop distances, timing and modeled costs so you can compare entry and stop hypotheses.

## Classroom lessons and separate exam

| File | Contents |
| --- | --- |
| [Full classroom SQLite database](https://github.com/Lamarrsdrip/XauCloud-Apex/releases/download/apex4-pullback-research-20261128/apex4-pullback-lessons.sqlite.zst) | **233,881** pre-entry lesson snapshots, **58,903** episodes, **1,784,517** separately stored outcomes, model and exam |
| [Frozen model](frozen.json) | The unchanged artifact frozen before examination, with training, practice and validation results |
| [Examined model](examined.json) | The frozen model plus the Nov. 27 exam, with completed evidence through 19:44 UTC |
| [Forward decisions](forward-decisions.json) | All 69 actionable detections in that session, with the 29 sequential reference outcomes and the model's decision for each |
| [Classroom crosscheck](classroom-crosscheck.json) | Independent recount of wins, losses, target touches and excursions by split |
| [Education report](../../../docs/APEX4_PULLBACK_EDUCATION_RESULTS.md) | Model results, failure modes, risk, timing, source recovery, dashboard and EA verification |

The 60 base M1 files and their manifest are in [data/gold_history](../../../data/gold_history). The exact [known November M1 input](inputs/known-november/XAUUSD_M1_2026_11.csv.gz) and [sealed forward M1 input](inputs/forward-november-27/XAUUSD_M1_2026_11.csv.gz) are here. They have identical basenames in separate folders because they contain different date ranges. [Forward source receipt](inputs/forward-november-27/manifest.json)

The [research release](https://github.com/Lamarrsdrip/XauCloud-Apex/releases/tag/apex4-pullback-research-20261128) holds the compressed SQLite snapshot, exact Exness tick ZIP inputs, the original PDF report and browser screenshots. The screenshots come from the automated local browser fixtures. The SQLite download is about 177 MiB and expands to about 1.9 GiB. Its compressed-file checksum is in [release-assets.sha256](release-assets.sha256). The release is marked as research and contains no customer installer.

### Open and query the lessons

Run from a checkout of this repository with GitHub CLI, Zstandard and SQLite installed.

```bash
apex_review="$PWD/apex4-research-download"
mkdir -p "$apex_review"
gh release download apex4-pullback-research-20261128 \
  --repo Lamarrsdrip/XauCloud-Apex --dir "$apex_review"
(
  cd "$apex_review"
  shasum -a 256 -c "$OLDPWD/research/evidence/apex4-pullback-education/release-assets.sha256"
)
zstd -d "$apex_review/apex4-pullback-lessons.sqlite.zst" -o "$apex_review/lessons.sqlite"
sqlite3 -readonly "$apex_review/lessons.sqlite" \
  "SELECT split, count(*) AS lessons FROM classroom_lessons GROUP BY split;
   SELECT count(*) AS outcomes FROM classroom_outcomes;
   SELECT id, count(*) AS stored_exams FROM classroom_knowledge
   JOIN classroom_exams ON classroom_knowledge.id = classroom_exams.version_id GROUP BY id;"
```

`classroom_lessons.evidence` stores the closed-candle snapshot. `classroom_lessons.plan` stores the proposed trade geometry when present. Join to `classroom_outcomes` on `run_id` and `lesson_id = id` for future path labels, costs and exits. The outcome policy names carry a digest prefix that identifies the replay code. Keep outcome fields out of any inputs used to select an entry.

### Reproduce the original trade ledger and tests

Use Node 22 or later. Use a fresh output directory for the scripts so existing evidence stays available for comparison. The output flag names below match the committed code.

```bash
apex_evidence="$PWD/research/evidence/apex4-pullback-education"
apex_new=$(mktemp -d)
node --experimental-strip-types scripts/compare-apex4-pullback-policies.mjs \
  --ticks-zip "$apex_review/Exness_XAUUSD_2026_11.zip" \
  --cases-json "$apex_new/november-matched-cases.json" \
  --cases-csv "$apex_new/november-matched-cases.csv" \
  "$apex_evidence/inputs/known-november/XAUUSD_M1_2026_11.csv.gz" \
  "$apex_new/november-comparison.json"
cmp "$apex_new/november-comparison.json" "$apex_evidence/november-comparison.json"
cmp "$apex_new/november-matched-cases.csv" "$apex_evidence/november-matched-cases.csv"
cmp "$apex_new/november-matched-cases.json" "$apex_evidence/november-matched-cases.json"

npm ci
npm test
node --experimental-strip-types --test intelligence/tests/*.test.ts
npm install --no-save --package-lock=false playwright
npx playwright install chromium
node tests/browser-apex-ui.mjs
```

For a fresh classroom build and the freeze/exam sequence, see the [education report's reproduction commands](../../../docs/APEX4_PULLBACK_EDUCATION_RESULTS.md#reproduction-and-staging). Use the checked-in M1 inputs and a new SQLite output. Since the Nov. 27 prices and results are now available for inspection, reserve different data when examining a revised strategy.

## Original XauCloud and verification evidence

- [Reference import summary](xaucloud-reference-summary.json) records the original XauCloud demo archive counts, provenance, timing and outcomes. This repository is public. The underlying broker export files and their row-level SQLite copy remain in the owner's local workspace.
- [Original captured research responses](original-research) contains the archived public Outlook, walk-forward and original replay summaries cited in the historical study.
- [Native M10 packet fixtures and comparison receipts](native-m10) contains both tester captures with account and server identifiers replaced, plus the rerun Apex/XauCloud comparisons. The two captures contain 137 and 78 packets. The comparisons cover direction, confidence, eligibility and levels for the common plans. The [native M10 report](../../../docs/APEX4_NATIVE_EVIDENCE.md) covers the limits of that test.
- [Verification receipts](verification) contains the original MetaEditor summary lines for the Apex demo EA and M10 observer. Both compiled with zero errors and warnings. GitHub retains the [candidate suite](https://github.com/Lamarrsdrip/XauCloud-Apex/actions/runs/46144756067) and [main verification run](https://github.com/Lamarrsdrip/XauCloud-Apex/actions/runs/46144877095) for the implementation merged in PR #21.
- [Artifact checksums](checksums.sha256) pins the research files checked into this folder. Verify from this directory with `shasum -a 256 -c checksums.sha256`.
