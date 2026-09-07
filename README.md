# XauCloud Apex v3.8.0 — Astra Audit Repair

Apex is an independent XAUUSD trading bot built to reproduce the reference trader's
setup selection, patience, confirmation and entry behaviour. It is **not** the XauCloud
trading strategy and does not consume XauCloud Outlook, Manual Trading Intelligence,
TradeBrain, Global Brain or the XauCloud M10 strategy.

## Canonical architecture

- Canonical EA source: `ea/XauCloud-Apex.mq5`
- Versioned source copy: `ea/XauCloud-Apex-v3.8.0.mq5`
- Canonical MT5 WebRequest origin: `https://xaucloud.io`
- XauCloud is intentionally the Apex **infrastructure bridge only**:
  licensing, configuration, heartbeat and events.
- Heartbeat: `POST /api/cloud/monitor/heartbeat`
- Config: `GET /api/cloud/apex/config`
- Event/ACK telemetry: `POST /api/cloud/apex/event`
- Customer enters only the Apex license in `InpApexLicense`.

## Account profiles

`NORMAL` is the default. `UNLIMITED` is used only after an explicit user/admin choice.
A broker offering 1:500 leverage does not automatically make an account UNLIMITED.

NORMAL keeps the approved confirmation-first ladder (default L1 15%, L2 50%, L3+ 100%).
v3.8.0 repairs the defect that could collapse those percentages into the broker's
`SYMBOL_VOLUME_MAX` (200 lots in the observed Exness XAUUSDm demo incident). Broker
preflight and fill reconciliation now happen before campaign/layer state advances.

## MT5 setup

1. Compile `ea/XauCloud-Apex.mq5` in MetaEditor.
2. MT5 -> Tools -> Options -> Expert Advisors.
3. Enable Allow WebRequest for listed URL.
4. Add `https://xaucloud.io`.
5. Attach Apex to XAUUSD/XAUUSDm.
6. Enter the Apex license in `InpApexLicense`.
7. Enable Algo Trading.
8. Arm the correct license/account from the Apex dashboard.

Expected EA identity:

`XauCloud-Apex_v3.8.0-AstraFix`

Do not deploy an older v3.7.x EX5 after promoting this source.

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
