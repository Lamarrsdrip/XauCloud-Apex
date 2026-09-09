# XauCloud Apex v3.8.6 — HardenedCapacity

**Main bot:** `ea/XauCloud-Apex.mq5`  
**Identity:** `XauCloud-Apex_v3.8.6-HardenedCapacity`  
**Compile that file.** The Expert name in MT5 is `XauCloud-Apex`.

Trading behavior is v3.8.2 CapacityTruth (`if(s.valid) Start(s)` on confirmation).
v3.8.6 only adds 24 non-strategy live-platform hardenings. It is **not** the
XauCloud trading strategy and does not consume XauCloud Outlook, Manual Trading
Intelligence, TradeBrain, Global Brain or the XauCloud M10 strategy.

## Canonical architecture

- Main / canonical EA: `ea/XauCloud-Apex.mq5`
- Versioned release copy: `ea/XauCloud-Apex-v3.8.6-HardenedCapacity.mq5` (byte-identical)
- Historical v3.8.2 snapshot (do **not** compile): `ea/XauCloud-Apex-v3.8.2-CapacityTruth.mq5` and `ea/archive/XauCloud-Apex-v3.8.2-CapacityTruth.mq5`
- Canonical MT5 WebRequest origin: **`https://xaucloud.io`** (never `https://apex.xaucloud.io`)
- XauCloud is the Apex **infrastructure bridge only**: licensing, configuration, heartbeat and events.
- Heartbeat: `POST /api/cloud/monitor/heartbeat`
- Config: `GET /api/cloud/apex/config`
- Event/ACK telemetry: `POST /api/cloud/apex/event`
- Customer enters only the Apex license in `InpApexLicense`.

Do **not** reconnect the EA to `apex.xaucloud.io`. The website talks to XauCloud through
`APEX_BRIDGE_SECRET`. The EA talks to XauCloud through WebRequest.

## Account profiles

`NORMAL` is the default. `UNLIMITED` is a **license entitlement**, not a customer toggle.
A broker offering 1:500 leverage does not automatically make an account UNLIMITED.

NORMAL keeps the approved confirmation-first ladder (default L1 15%, L2 50%, L3+ 100%).
UNLIMITED each valid add uses **100% of CURRENT executable remaining capacity**.
The old "UNLIMITED Profile Multiplier" UI field is a no-op under `baseMarginPct=100`
and is hidden. Sizing semantics are unchanged from v3.8.2 CapacityTruth.

## MT5 setup

1. In MetaEditor open and compile **`ea/XauCloud-Apex.mq5`** (`#property version "3.860"`).
   That produces `XauCloud-Apex.ex5`. Do not compile v3.8.2 / v3.8.3 / v3.8.4 / v3.8.5 files.
2. MT5 -> Tools -> Options -> Expert Advisors.
3. Enable Allow WebRequest for listed URL.
4. Add **`https://xaucloud.io`**. Do not add `https://apex.xaucloud.io` for WebRequest.
5. Attach **XauCloud-Apex** to XAUUSD/XAUUSDm. Remove any old CapacityTruth / 3.8.3 / 3.8.4 / 3.8.5 chart Expert.
6. Enter the Apex license in `InpApexLicense`.
7. Enable Algo Trading.
8. Arm the correct license/account from the Apex dashboard.
9. Confirm Experts log `APEX_READY XauCloud-Apex_v3.8.6-HardenedCapacity`.
10. Dashboard pills must show **desired** vs **applied** revision. A local save is not "Apex armed".

Expected EA identity:

`XauCloud-Apex_v3.8.6-HardenedCapacity`

## Production

`deploy/xaucloud-apex.service` sets `DATA_DIR=/var/lib/xaucloud-apex`. Do **not**
enable `User=xaucloud-apex` or `APEX_STRICT_SECRETS=1` until that user exists and
`ADMIN_TOKEN` / `SESSION_SECRET` are real. `/health.secretsAcceptableForProduction`
reports the check. A failed check must not take the site down.

## Validation

See `APEX_FIX_STATUS.md` and `APEX_FIX_VALIDATION.md`.

Passing Node/C++ compatibility tests is not a substitute for compiling the exact
canonical source in MetaEditor and validating the resulting EX5 on a demo broker first.

## License login and persistence

The Apex license is the customer login credential.

- First visit: the user sees the license gate.
- A valid ACTIVE license signs the user in.
- The secure login session is remembered for future visits (default 3650 days).
- Restarting/redeploying Apex does **not** delete licenses or log users out.
- License/config/event state lives in `/var/lib/xaucloud-apex`, outside the replaceable
  application folder.
- On the first persistent-data deployment, existing files from the old app-local `data/`
  directory are migrated if the persistent copy does not already exist.
- Settings already provides **Change License**; entering another valid license switches
  the browser session to that license.
- Sign Out returns the browser to the license gate.
- If the current license is disabled, expires or is deleted, `/api/auth/me` clears the
  session and returns the user to the license gate.
- Keep `SESSION_SECRET` stable in the server environment during normal deployments.
  Rotating that secret is an explicit security operation and intentionally invalidates
  existing signed sessions.
