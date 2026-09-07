# Apex v3.8.0 Fix Validation

## Evidence

- Astra forensic audit and findings are already in the repository.
- Claude added a C++ compatibility harness that extracts/replays the relevant EA sizing
  and entry-gate logic and includes the live 200-lot regression.
- The user's Claude terminal showed a MetaEditor compile completing with 0 errors before
  the Claude usage limit ended. That result must still be repeated for the exact final
  canonical source after finalization.

## Observed v3.7.1 demo incidents

- 2026-09-07 05:27:00.369 — BUY 200.00 XAUUSDm, SL 4371.296 -> not enough money
- 2026-09-07 06:34:01.611 — SELL 200.00 XAUUSDm, SL 4436.185 -> not enough money

## Required before live deployment

1. Compile final `ea/XauCloud-Apex.mq5` in MetaEditor: 0 errors, 0 warnings.
2. On Exness demo 1:500 with NORMAL, verify `APEX SIZING` reports NORMAL, L1 percentage,
   and a genuinely executable final volume rather than the old 200-lot shortcut.
3. Verify explicit UNLIMITED reaches UNLIMITED while absent/invalid profile remains NORMAL.
4. Verify rejected orders do not increment `layers` or create false campaign/master state.
5. Re-run duplicate-trigger, failed-close/CLOSING, restart-state and server/config tests.
6. Confirm MT5 allowlist contains `https://xaucloud.io`.
7. Confirm dashboard desired/applied revision/profile matches EA heartbeat.
8. Use demo first. Synthetic/harness success does not prove live-money safety.

## Known limitations

- MQL handlers remain single-threaded; telemetry is queued and WebRequest bounded, but
  transport is not truly off-thread.
- Repository review cannot prove the deployed Hostinger/VPS state or which EX5 is
  attached without runtime evidence.
- No audit-suggested new exposure policy was enabled just to close finding 014.


## License persistence validation

After deployment:
1. Log in once with an ACTIVE license.
2. Restart the service; refresh the browser — it should open the dashboard without asking again.
3. Deploy a new code release; refresh — the same license/session should still work.
4. Confirm `/var/lib/xaucloud-apex/licenses.json` exists and remains unchanged by code deployment.
5. Use Settings -> Change License; confirm the new license becomes the active browser identity.
6. Disable/expire/delete the current license; the next `/api/auth/me` poll should clear the
   session and return the browser to the license gate.
7. Re-enable/recreate only through the intended admin/license workflow; never restore old
   licenses by replacing code folders.
