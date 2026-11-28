# Apex 4 native M10 evidence

XauCloud's deployed Command Center identifies source revision
`fc91b97e2ee88eae6b9d4e24c6d74ef522c1ec4c` and customer EA v6.29.1.
The source for that release is `backend/ea_code/XauCloud.mq5` with SHA-256
`5be1ef095d7bf3d23c1d2cc7ee482368700bfff871a08e8f8f340a932d686d71`.
The `XauCloud_Aurum` and `15bd8f20297de5305e413f44ef586eee4afdf45c`
manifest metadata originally described the v6.28.2 Aurum release.
The v6.29.0 and v6.29.1 sources share the inspected M10 evaluator, market
thesis, and evidence serialization. The Python unified thesis mirror from
v6.24.8 through v6.24.12 accepts an existing transition state, so it cannot
generate the current native M10 inputs.

## Build the evidence observer

```bash
node scripts/build-apex4-m10-observer.mjs \
  /absolute/path/to/XauAI-Sniper/backend/ea_code \
  /absolute/path/to/isolated-mql5-build
```

The generator validates the release's source bytes and all three required
lease includes. The generated observer uses the original MQL indicator
buffers, immutable closed-M10 snapshot, pressure, lifecycle, decision, and
telemetry serializers. The build replaces broker send and web request APIs,
including those in the lease client. It confines file and terminal-variable
state to Apex-specific namespaces. The observer can initialize only on a
demo account or in Strategy Tester.

Compile `Apex4-M10-Observer-v6.29.1.mq5` and its generated includes in an
isolated MetaEditor workspace. For a demo, attach it to a Gold chart on the
same account and broker as the Apex candidate. Set `InpApexEvidenceId` to
the lowercase SHA-256 of the Apex license, `|`, and demo MT5 account number.
The observer needs that digest and has no use for the license itself. It
writes the latest local evidence under `Apex4Evidence` in MT5 Common
Files. The Apex backend must have read access to that operator-controlled
directory. Keep client web uploads separate from this directory.

Set `APEX4_LOCAL_EVIDENCE_DIR` to the complete path of that directory and
`APEX4_CANONICAL_SOURCE_COMMIT` to the revision above. The loader validates
the source and build, environment, broker, account, fresh executable quote,
and closed H1, H4, and D1 availability before applying the same canonical
M10 normalization as XauCloud. One broker's evidence cannot fill in missing
evidence for another. An empty or stale file prevents a canonical Outlook.
The native observer makes no HTTP requests and needs no XauCloud signals or
AI model credentials.

## Parity scope

`InpApexReplayEvidence=true` enables append-only JSONL capture on a new M10
bar in MT5 Strategy Tester. Apex's live reader rejects test packets.
To compare the pinned XauCloud backend's pure algorithms on the same inputs
sent to Apex, use the compiled backend at the same revision.

```bash
ENVIRONMENT=test JWT_SECRET=local-comparison-only \
  node --experimental-strip-types scripts/compare-apex4-native-outlook.mjs \
  /absolute/path/to/replay-capture.jsonl \
  /absolute/path/to/XauAI-Sniper/backend_node
```

The comparison counts differences in direction, confidence, eligibility,
entry, SL, TP1, and TP2. Grade comparison requires independently aligned
closed-M1 case features on each row and an optional third argument pointing
to the same already trained knowledge file. Sample counts and differences are
reported separately. The original production scheduler also applies database
selection, current quote continuity, owner-account state and Global Brain
logic. A same-packet comparison cannot establish parity for those conditions,
actual trading results, or profitability.

## Verified replay

MetaEditor compiled the generated observer with zero errors and zero warnings.
The generated MQ5 SHA-256 is
`7bae39ab159f7627417b962f83ef2661e76af4c6beb5c51905eed1ec6c5b8652`.
The resulting EX5 SHA-256 is
`7c3eef76069d07f02257758f2abdd6be32ae58c1baed52dbd25e72f4808d1b32`.

On November 28, 2026, isolated MT5 build 6230 completed a no-order replay of
Exness `XAUUSDm` for November 23 using the broker's M1 OHLC history. MT5
reported 5,512 modeled ticks and 138 M10 bars. The observer emitted 137
closed-bar packets with complete higher-timeframe data. The two engines
matched direction, confidence, and tracking eligibility on all 137 packets.
There were 74 comparable tracking plans and zero differences in entry, SL,
TP1, or TP2. Within Apex's 25-second hourly window, 13 of 22 snapshots
produced comparable tracking plans. The remaining 63 of the full 137
packets had no valid tracking levels in either engine. The capture SHA-256 is
`06c05c1cb9551adb2c914096ff942c15d1206d82ab567914328a8027abbe34a3`.
This run had zero simulated trades. The verdict covers the same-packet
logic only. Quality grade agreement, production scheduler behavior, and
live demo fills remain unverified by this replay.
