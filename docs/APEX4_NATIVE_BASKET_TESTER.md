# Native XauCloud basket — isolated tester foundation

This is an additional, **tester-only** generated EA. It does not replace the stable manifest or turn on Apex 4 production trading. It derives from the same SHA-256-pinned XauCloud v6.29.1 source and lease files already used by the canonical M10 observer. All inherited order and network APIs stay disabled; only the separate Apex tester basket adapter can submit orders, and only under MQL_TESTER.

## Build on the Mac

Use a clean XauAI-Sniper checkout at fc91b97e2ee88eae6b9d4e24c6d74ef522c1ec4c; the generator rejects any different source bytes.

```bash
XAU_SOURCE="$HOME/XauAI-Sniper/backend/ea_code"
OUT="$(mktemp -d)"
node scripts/build-apex4-native-basket.mjs "$XAU_SOURCE" "$OUT"
APEX_COMPILE_SOURCE="$OUT/XauCloud-Apex-v4-NativeBasket-TESTER.mq5" bash scripts/compile-apex4-mac.sh
```

Install the resulting checksum-stamped EX5 in the MT5 Experts directory and run historical XAUUSD real ticks on a USD hedging tester. Do not attach it to a live or demo chart; initialization rejects all non-tester environments.

## Actual changes

- Reuse native XauCloud M10 snapshots, candidate direction and XAU_ClassifySetup, including its countertrend scalp, reversal reclaim and continuation families.
- Record pullback/reclaim categories without claiming that the prior fixed-SL research proves a no-SL basket edge.
- One basket at a time, frozen original executable quote and equity tier; fixed exit at original price +/- $5.
- No per-order SL or TP, fixed holding deadline or software layer/risk cap. Additional orders are attempted when broker margin permits and the target has not been crossed; simulated tick time drives pacing.
- Original broker APIs are fenced. The new executor uses its own magic and rejects foreign exposure. Ambiguous order responses pause further entries.
- Broker stop-outs remain possible and may wipe the deposit. This is a deliberately high-risk research execution mode, not a profitability claim.
- Backend contract tests define the intended fixed basket geometry for a future native adapter and require canonical STRONG Outlook, current publication, and a separately approved WAT hour. This contract is **not wired into an active endpoint**. Live Outlook integration, full classroom-feature parity, independent historical basket execution evidence, compiler verification, website/backend cutover and live deployment remain open.

The existing research used individual equal-risk positions with structural stops, variable targets and timed exits; those returns cannot validate this different basket policy. The published classroom records remain untouched. The 8–10 AM WAT preference is not hardcoded as proven: the original validated production Outlook records have not been recovered.

## Verification

The connector supplied the pinned native source and the generation transforms were checked against that source. The 12 isolated structural checks are not a MetaEditor compile or MT5 execution test. A clean compile and real-tick tester runs must be recorded before any release promotion.
