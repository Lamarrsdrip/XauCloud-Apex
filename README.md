# XauCloud Apex v3.4.1

Private XAUUSD campaign EA and control plane built around a repeated pattern: strong impulse into a recent liquidity extreme, sweep/failure, rejection, micro-structure break, initial entry, then increasingly large additions only while the basket is profitable and fresh continuation or failed-pullback confirmation appears. Setup/entry/pyramid detection logic is unchanged from earlier versions — see `docs/STRATEGY_SPEC.md` for the full forensic history and evidence this build is based on.

## v3.4 exit & sizing architecture (current)

All of the below is synced from the website/backend with local EA Inputs as the offline fallback:

- **Three-tier NORMAL margin ladder** — `normalL1MarginPct` (default 15%), `normalL2MarginPct` (default 50%), `normalL3PlusMarginPct` (default 100%): the master/first entry, first add, and every add after that each request their own configured % of current free margin, always bounded by what the broker will actually accept at that instant (`OrderCalcMargin`-based, not a hardcoded lot table). The UNLIMITED profile is unaffected and still uses `baseMarginPct` × `layerMultiplier`^layers.
- **Fixed master (L1) stop-loss** (`normalFixedSLGoldMove`, default 30) — an XAU **price-distance**, not pips or account money. Only the first/master position ever receives a broker SL; pyramid adds never do. If the master leg disappears for any reason (broker SL fill, manual close, margin stop-out), the whole remaining basket closes immediately — no orphan positions. A synthetic price-based guard reinforces the broker's own SL order so the whole basket reacts together.
- **Master break-even protection** (`masterBreakEvenEnabled`, default on; `masterBreakEvenTriggerPct`, default +50%) — once whole-basket campaign profit reaches the trigger %, the master/L1 stop-loss moves one-way to its own entry price (true breakeven on the master leg). It never re-fires once armed and never widens back out.
- **Percentage profit ratchet** (default: trigger +180%, lock +100%, then +100% step / +100% lock-step) — protects basket profit in stages, in % of campaign-start balance, once peak profit crosses the trigger. The floor only ever moves up; a retrace below an already-earned floor closes the whole basket. This is **not** a hard take-profit — the basket keeps running past the trigger, hunting for the next stage.
- **Optional hard basket TP** (`normalTargetProfitPct`, default **0 = disabled**) — left off by default so the ratchet (not a fixed target) governs the exit. A TP set below the ratchet's first trigger would close the basket before the ratchet ever gets to activate.

Every EA event carries the effective values it's actually running with (`l1MarginPct`, `l2MarginPct`, `l3PlusMarginPct`, `takeProfitPct`, `fixedSLGoldMove`, `beEnabled`, `beTriggerPct`, `ratchetEnabled`, `ratchetTrigger/Lock/Step/LockStepPct`) plus `configSource` (`REMOTE` once the backend has synced at least once, `LOCAL_INPUT` until then) and `eaVersion`, so the dashboard can show exactly what's running without guessing. `OnInit` and every config change also print `APEX_EFFECTIVE_CONFIG ... source=REMOTE|LOCAL_INPUT` to the terminal log. The website's Settings page always shows the effective default values for a license, even before the EA has ever connected — settings are never blank.

## Strategy state machine

`IDLE -> IMPULSE/SWEEP WATCH -> REJECTION + BOS CONFIRM -> PROBE -> PROFIT-SIDE PYRAMID -> RATCHET / TP / FIXED-SL CLOSE`

The implementation does not assume that every large move must reverse. It requires a prior extreme/liquidity violation and then evidence that continuation failed.

## Lot semantics

For the NORMAL profile, each layer requests its own configured % of *current* free-margin capacity: `normalL1MarginPct` (default 15%) for the master/first entry, `normalL2MarginPct` (default 50%) for the first add, `normalL3PlusMarginPct` (default 100%) for every add after that. `maxLayers=0` means no software layer cap; the broker, available margin, and the ratchet/TP/SL/break-even exits become the practical limits. The UNLIMITED profile keeps the older `baseMarginPct` × `layerMultiplier`^layers exponential sizing, unchanged.

## Learning brain

The EA sends the real feature vector at campaign start — impulse magnitude, wick rejection ratio, M3/M5 confirmation, ATR — not just the final score. The backend joins that to each campaign's outcome by `campaignId` and reports genuine, sample-gated win rates per feature bucket via `featureInsights` — a bucket only reports a real number once it has at least 5 completed campaigns, otherwise it's marked `insufficient_sample`. Learning also correctly distinguishes a genuine broker/margin failure from a *protected* exit (ratchet or TP hit) — a protected exit is not scored as a loss.

Before `learningMinCampaigns`, learning is observation-only. After that it can nudge entry/add score thresholds within `learningMaxScoreAdjustment`; it never changes direction, lot sizing, margin, SL, ratchet, or target, and never creates trades by itself.

## Run

Node 22+:

```bash
cp .env.example .env
ADMIN_TOKEN=... EA_TOKEN=... SESSION_SECRET=... node server.mjs
```

Set MT5 WebRequest whitelist to the deployed Apex URL. Compile `ea/XauCloud-Apex.mq5` in MetaEditor and require zero errors before attaching it. `InpApexLicense` must be set to a license key issued via the website's `/#admin` panel for remote arm/config sync and license enforcement to work.

Older EA builds are kept for reference only under `ea/archive/` — do not attach them.
