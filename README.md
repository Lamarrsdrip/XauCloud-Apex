# XauCloud Apex v3.8.8 — UnlimitedFromL3 + Rejection Quality

**Main bot:** `ea/XauCloud-Apex.mq5`  
**Identity:** `XauCloud-Apex_v3.8.8-UnlimitedFromL3`  
**MT5 property:** `#property version "3.880"`

The active strategy is the original v3.8.8 confirmation-is-entry family:
`impulse -> sweep -> rejection -> micro BOS -> Start(s)`.

The only replay-backed strategy patch is:

`rejection_wick / max(candle_body, point) >= 0.10`

It is evaluated on the actual candle that satisfies the rejection predicate. No
v3.8.9 BreakfastTiming or v3.9.0 FailedBreakout logic is active in the canonical EA.
See `docs/APEX_V388_REPLAY_IMPROVEMENTS_2026-09-22.md`.

## Canonical architecture

- Main EA: `ea/XauCloud-Apex.mq5`
- Versioned copy: `ea/XauCloud-Apex-v3.8.8-UnlimitedFromL3.mq5` (byte-identical)
- WebRequest origin: **`https://xaucloud.io`**
- Heartbeat: `POST /api/cloud/monitor/heartbeat`
- Config: `GET /api/cloud/apex/config`
- Event telemetry: `POST /api/cloud/apex/event`

## Account profiles

`NORMAL` remains unchanged.

For `UNLIMITED`: L1 = 15% of simulated 1:200 capacity; L2 = 50% of freshly
re-derived simulated 1:200 capacity; L3+ = 100% of actual current Unlimited
executable capacity. The rejection patch does not change sizing, pyramiding,
SL, break-even, ratchet or exits.

## MT5 setup

1. Compile **`ea/XauCloud-Apex.mq5`** and confirm MetaEditor reports 0 errors, 0 warnings.
2. Allow WebRequest for **`https://xaucloud.io`**.
3. Attach **XauCloud-Apex** to XAUUSD/XAUUSDm.
4. Enter `InpApexLicense`, enable Algo Trading and arm the correct account.
5. Confirm the Experts log identifies **`XauCloud-Apex_v3.8.8-UnlimitedFromL3`**.
6. Confirm dashboard desired/applied revisions match the EA heartbeat.

Do not compile the untested v3.9.0 snapshot as the production bot.

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
