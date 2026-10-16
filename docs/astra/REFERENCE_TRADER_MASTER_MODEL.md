# Reference trader model — tradingcartel-breakfast-v1

Research date: 2026-10-16. This is a versioned, evidence-informed research model, not recovery of the trader's private strategy, a fitted base model, or validated trading performance. The [evidence index](REFERENCE_TRADER_EVIDENCE_INDEX.md), [review ledger](REFERENCE_TRADER_REVIEW_LEDGER.md), and structured JSONL files retain facts separately from interpretation. Source videos were decoded and visually inspected in this research pass; prior reports were cross-examined, not substituted for the originals.

## The common decision process

Determine what the market is attempting, where that attempt is meeting a meaningful prior reaction, and whether current price action is accepting or rejecting it. An upper level alone is attention, not permission to sell. Strong rising pressure alone is not a sell. A historically correct rejection alone is not current entry permission.

For the main sell family, an aggressive rise attacks an upper area, progress fails, and a bearish response changes the local auction. Sometimes a failed recovery/lower high is clearer than a textbook sweep wick. The trader participates in the developing response, then increases exposure while the move proves itself. The current response, the failed counter-push, and remaining room matter for each addition. Earlier unrealized profit does not make a later low-area entry good.

Three observable families are required:

| Family | Observable sequence | Evidence | Confidence/limit |
|---|---|---|---|
| Upper sweep/rejection | Strong advance, previous upper area exceeded, failure to remain above, fresh downside response | Original clip1/clip3 | Strong visual family; exact level-selection/close rule unknown |
| Failed upside area / anticipatory probe | Previous failed upper area, rebound toward it, new failure or expected reaction; first probe can precede strong displacement | Original clip5, public Sep22 | Readiness less completely specified; original clip2 remains underspecified |
| Fresh bearish continuation | Prior failed advance, broken recent bullish structure, failed rebound/brief pause, renewed bearish control | Original clip4/clip6, public Sep6/Sep10, NEW clip8 | Strong visual family; can be far from original peak |

The new supplied clip8 starts with M3 already descending from roughly 4191 through broken shelves near 4187 and 4180, then first sells at 4178.353. It decisively challenges a universal requirement to sell only near the original upper extreme. Public Sep6 similarly first sells near4470 after an old peak near4488. Freshness must be assessed relative to a **recent local event**, with distance from the older thesis origin retained separately.

## State and authority

A useful state path is NO_SETUP → WATCHING/APPROACH → EXTREME_TEST → SWEEP or FAILED_APPROACH → REJECTION_PENDING → REJECTION → FRESH_PROOF → ENTRY_READY → ENTRY_ACTIVE → CONTINUATION/ADD_READY → EXPANSION. Failure branches lead to THESIS_WEAKENING, INVALID, or EXIT. A continuation can enter via an already established failure and a new local proof; it need not fabricate a new sweep at every entry. An anticipatory probe is not automatically ENTRY_READY.

Astra must identify which facts make the state current, what facts oppose it, the present local reaction origin, and what would contradict it. Confidence and quality are model judgments, not win probabilities. With adequate structured inputs, Astra can select WAIT, first entry, ADD, HOLD, STOP_ADDING, REDUCE, or EXIT. Broker checks, positive-basket add enforcement, identity, quote freshness, fills, and sizing remain deterministic execution requirements.

## Entry and addition are different judgments

Initial participation requires location plus current permission. Reference examples vary: original clip7 narrates an engulfing-area retest; original clip3 enters after a developed response; public Sep22 probes before stronger displacement. No universal retest, candle-close, two-bar or H1/H4 alignment rule is established.

An add reassesses the CURRENT opportunity. It requires a working owned campaign and new relevant proof such as a failed counter-push, renewed local breakdown, or continued selling through a recent shelf. Small moves can suffice. Four0.6 sells at4424.308 follow L1 at4424.913; clip3's next0.5 sell at4054.457 is only0.589 lower than L1. These are observations, not calibrated distance constants. Rapid same-price ticket clusters are one campaign/batch, not independent setups or evidence that every ticket had a new BOS.

## Learn decision quality without hindsight

Original clip7's first sell4349.062 becomes substantially favorable. Later2-lot sells near4342.938 and rebound toward4345 accompany a displayed wipeout while price remains below L1. A good first idea can coexist with poor later exposure and management. Public Sep26 narrates a confirmed buy idea that fails and a separate rushed/revenge buy without final confirmation. Keep those labels separate; broker fills cannot be reliably assigned to each narrated idea.

Initial red P/L is common and is often consistent with spread. In NEW clip8, first SELL2 at4178.353 shows -18.00 at60s, -26.00 at66s, +1.00 at68s, -38.40 at70s, then +140.60 at78s. Those are edited-video timestamps and snapshots, not exact market-time first-passage measurements. Reject the rule 'must never show red'. Prefer spread-adjusted reaction, MFE-before-MAE, and current price-control evidence measured on causal broker ticks.

## Limits and prohibited extrapolations

The accessible videos are selected social-media presentations with cuts, talking-head interruptions, obscured rows and absent tick paths. Displayed or claimed account flips are not independently audited returns. No population win rate, unbiased profit-first frequency, exact time-to-profit, universal risk/exit formula or proprietary indicator logic can be recovered. Buy-side execution evidence includes losing buys and retrospective charts; successful BUY symmetry remains **derived symmetry pending equivalent empirical evidence**.

The package supports instructions, retrieval and fixtures. It is too small, correlated and incompletely labeled for a claim of fine-tuning success. No OpenAI base model has been trained. Numeric thresholds, detector windows and expiry bounds must be identified as engineering settings and evaluated independently on held-out market streams.

## Machine taxonomy mapping

Structured examples use contract-compatible `setupFamily`; `evidenceFamily` retains the more descriptive research taxonomy. ANTICIPATORY_UPPER_PROBE maps to UPPER_FAILURE_PROBE; FAILED_UPSIDE_AREA maps to FAILED_RECOVERY_CONTINUATION; FRESH_BEARISH_CONTINUATION maps to CONTINUATION; the unverified lower-area buy narration maps to LOWER_FAILURE_PROBE. CAMPAIGN_SEQUENCE uses NONE because it is a teaching sequence rather than one setup decision. This mapping is serialization, not stronger empirical proof. Do not copy full campaign outcome sequences into a causal prefix label.
