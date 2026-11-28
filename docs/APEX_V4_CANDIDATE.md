# Apex 4 independent intelligence candidate

Apex reads its own attached MT5 broker's bid, ask, and closed bars. Its
deterministic engine runs without paid model requests. Trading remains
disabled by default. The Apex 4 routes and dashboard activate only when
the staging operator sets `APEX4_CANDIDATE=1`. The stable delivery manifest
and EA are separate.

## Native M10 and Hourly Outlook

The [native observer](APEX4_NATIVE_EVIDENCE.md) is generated from the exact
source behind XauCloud v6.29.1. It reproduces the original M10 evidence
producer and emits its broker-local market thesis. The isolated observer
has its broker sends and HTTP requests disabled. Apex checks the observer
source, broker, account, timestamp, quote, and higher-timeframe availability
before running the copied deterministic Outlook resolver. No published
XauCloud signal is required.

An executable Outlook needs both a valid native thesis and a historically
qualified grade and WAT hour. The evidence comparison tool reports field
differences for a matched packet. Production XauCloud additionally uses
database-dependent policies and lifecycle data, so a same-packet comparison
covers only the reported fields.

## Pullback and historical experiments

Apex examines M15 structure and uses H1 for conflicting trend context.
The continuation candidate measures retracement depth within an intact
parent swing, a sweep or rejection, and M1 pressure recovery or a live
reclaim. The correction candidate is studied separately. Its entries and
targets require actual price room and consistent geometry. A detected
setup can enter research without authorizing an order.

See [historical validation](APEX_V4_HISTORICAL_VALIDATION.md) for the
verified archive coverage, chronology, experimental costs, and separate
November price exam. The trainer retains sample counts and rejected or
missed entries as well as TP1, TP2, favorable and adverse excursion and
drawdown. Use an isolated historical directory and keep private raw data
and generated knowledge files outside Git. Verified WAT hour qualification
requires the original signal issue time, conditions and outcome, rather
than the public aggregate performance response.

## Trade Brain and chat

Candidate operation requires Node 22. The SQLite ledger under
`DATA_DIR/apex4-trade-brain/` archives observations before the decision,
persists the decision and plan as observed, and resolves research cases
from subsequent broker quotes. Gaps censor uncertain paths. Reports keep
quote-based simulations and terminal-reported broker deals separate.
Apex deduplicates by account and event or deal identity. The EA batches
broker events with the next market poll, retains them across restarts, and
clears them only after the server confirms a durable write.

The daily learning cycle records performance by setup and WAT hour. It
freezes a future evaluation window when it creates a candidate. Admin
promotion requires a forward-validated candidate and rollback restores the
previous research version. The research registry adds evidence to chat.
Executable decisions use the independently calibrated knowledge artifact.
The account can continue collecting observations while disarmed.

Apex AI chat uses the supplied market, replay, and broker evidence with the
configured supported chat model. The customer's model key is needed only
for interactive provider features such as chat and connection tests.

## Compile for Mac and stage

From this checkout, run the following command. It builds in a new isolated
MetaEditor directory and saves the checksum-stamped candidate EX5 and UTF-8
compile report into the Mac Downloads folder after a clean compile.

```bash
bash scripts/compile-apex4-mac.sh
```

Use an authorized USD hedging demo account and a bound test license. Point
`ApexBackendURL` to the isolated staging endpoint and configure MT5's
WebRequest allowlist. The candidate uses HTTPS by default. The explicit
`AllowLoopbackStaging` input permits only a literal loopback HTTP endpoint
for disposable local verification. Leave `EnableDemoExecution=false` to
collect market evidence. Orders additionally require explicit terminal
enablement, an armed demo license, and an approved fresh plan.

Active baskets keep broker SL and TP2. Narrow recovery restores management
of a verified matching basket without placing new layers after restart.
An ambiguous order reply prevents further entries until ownership and
broker state can be reconciled. The normal and margin-stress modes keep
their existing account equity tiers, broker margin checks, and pace.
Broker fills, slippage, commissions, stop-outs, and partial fills need
real demo evidence. Simulated risk units do not measure liquidation risk.

No Apex 4 binary is promoted through this candidate workflow. Validate
normal and unlimited-leverage execution, margin recovery, partial fills,
restart, and TP2 on approved demo setups before updating the stable release.

## Verified artifacts

The Mac candidate compiled with MetaEditor at **0 errors and 0 warnings**.
Candidate source SHA-256 is
`8235c48fe6f3c3c105add9c0625927a52a854d4b85380d192757922610bb2b8b`.
Candidate EX5 SHA-256 is
`aaf9d33fdd134330461beb17a2f82face66d66b32b98b69a1e06eadeb47aee9c`.
The separately generated native observer also compiled at 0 errors and
0 warnings. The validated offline snapshot grants zero pullback groups and
zero Outlook hours. Raw prices and local knowledge files are private
workspace artifacts.
