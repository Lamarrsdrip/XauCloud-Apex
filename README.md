# XauCloud Apex v3.7.0 — Command Center Link Rebuild

This package rebuilds the EA ↔ website/backend link using the same local-first philosophy as XauCloud Command Center.

## Core behavior

- Canonical MT5 WebRequest origin: `https://apex.xaucloud.io`
- Customer enters only the Apex license in the EA input.
- Heartbeat: `POST /api/apex/heartbeat`
- Event telemetry: `POST /api/apex/event`
- Command acknowledgement: `POST /api/apex/command/ack`
- Website arm/disarm is per-license, not one shared global flag.
- Works with both demo and live trade modes. If a license is explicitly bound to an account in admin, that account restriction is enforced.
- Successful remote config is cached locally in MT5 GlobalVariables.
- Backend/network failure does **not** reset a validated local trading state.
- Explicit server license denial (disabled/expired/account mismatch) disarms new campaigns.
- Existing/open campaigns continue to be managed locally before the armed gate.
- Strategy, pyramiding, SL, recovery, BE and profit-ratchet logic were not redesigned in this connectivity rebuild.

## MT5 setup

1. Compile `ea/XauCloud-Apex.mq5` in MetaEditor.
2. MT5 → Tools → Options → Expert Advisors.
3. Enable **Allow WebRequest for listed URL**.
4. Add exactly: `https://apex.xaucloud.io`
5. Attach Apex to XAUUSD/XAUUSDm.
6. Enter the Apex license in `InpApexLicense`.
7. Enable Algo Trading.
8. Login to `https://apex.xaucloud.io` with the same license and press **Arm Apex**.

## Expected journal proof

A healthy instance should stop showing the old `api.apex.xaucloud.io` / `403` path and should report `APEX_READY XauCloud-Apex_v3.7.0-CommandCenterLink`. The site should become CONNECTED after heartbeat and the command revision should be acknowledged by the EA.

## Validation run here

- Node syntax check: True
- Automated tests: True (9/9)
- MQL brace check: True
- MQL parenthesis check: True
- Old EA token removed: True
- Direct API hostname removed: True
- New heartbeat present: True
- Cloud failure remains local-first: True
- Existing campaign management remains before arm gate: True

Important: MetaEditor is not installed in this environment, so the `.mq5` still needs a real MetaEditor compile on the Mac. The server/backend integration itself was executed locally with automated tests.
