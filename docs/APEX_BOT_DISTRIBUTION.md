# Apex compiled-bot distribution and onboarding email

## Scope

These features ship together across **two repositories**:

1. **XauAI-Sniper backend**: bridge-secret-authenticated install email endpoint, branded template, SMTP attachment support, delivery audit.
2. **XauCloud-Apex**: persistent compiled-release store, active-license dashboard downloads, admin publish and email controls.

Deploy the **XauCloud email bridge first**, then Apex. The existing XauCloud SMTP settings (official sender) are reused; never copy XauCloud SMTP passwords to Apex.

## Publish the first compiled bot (mandatory)

The Apex repository currently contains v3.10.0 source, **not a current compiled .ex5**. The old archived v2.2.0.ex5 must **never** be served as v3.10.0.

1. On **Windows** with MetaTrader 5 / MetaEditor installed, download:
   - `ea/XauCloud-Apex-v3.10.0-LifestyleAstra.mq5` (main EA)
   - `ea/AstraBridge.mqh` (included source dependency)
2. Put both in the same `MQL5/Experts` folder.
3. Open the main .mq5 in MetaEditor and compile with F7. Fix all compile errors and verify the bot version and expected build identity. Do not send source files in place of the compiled binary.
4. Smoke-test the resulting `.ex5` on a **demo MT5 account**. Check that the default native strategy works, the license heartbeat connects to XauCloud, and Astra's optional bridge can connect to Apex with the correct WebRequest permissions.
5. Sign in to `https://apex.xaucloud.io/#admin` with your admin token. Find **Official Apex bot release**, choose the verified `.ex5` (up to 5 MB), confirm its build and click **Publish Latest Apex .ex5**.
6. Check the Admin card shows the published version and checksum. Sign in with an **active license**, then verify the **Dashboard / Settings / Account** download produces the same byte-for-byte EX5.
7. Under Admin **Email Apex to a customer**, enter their verified email and select their active Apex license. The XauCloud backend sends the compiled bot as an attachment plus the HTML/plain-text setup guide from its configured SMTP identity.
8. Confirm delivery with a test mailbox and that the attachment compiles/runs in MetaTrader 5 as expected. SMTP acceptance is not a guarantee of inbox delivery; check mail logs for delivery-unknown outcomes. Never blindly resend ambiguous requests.

## Release safety

- Release files and metadata are stored in persistent `DATA_DIR/bot-releases`, separate from the replaceable code checkout.
- The dashboard shows **not published** until the compiled .ex5 matching the current `version.json` exists.
- The release SHA-256 and size are checked before download or emailing, and writes use atomic file replacement.
- Users need a valid active-license session to download. Admin token is required to publish and to initiate email sending.
- Email relay requires `APEX_BRIDGE_SECRET` shared server-side; the admin sends the binary through the bridge, not through a public unauthenticated attachment URL.
- Requests have bounded sizes; mail and release actions are rate-limited; email requests are deduplicated and delivery outcomes recorded without storing SMTP passwords or API keys.

## User instructions included in the email

- Copy the one compiled `.ex5` file into `MQL5/Experts` and refresh MT5.
- Allow WebRequest for **both** `https://xaucloud.io` and `https://apex.xaucloud.io`.
- Attach Apex to an XAUUSD/XAUUSDm chart, enter **InpApexLicense**, enable Algo Trading, sign into the Apex dashboard, and Arm.
- **Astra is optional**. In Settings → ASTRA BRAIN, create an OpenAI Platform API key, ensure API billing is set up, select a supported model, save the key in the secure dashboard and Test Connection. The key does not belong in the .ex5, MT5, or email.
- Verify the correct connected state and begin with a demo account; no profit is guaranteed.

## Verification

- Apex: `npm test` (includes `tests/apex-release-delivery.test.mjs`).
- XauCloud: `cd backend_node && npm run typecheck && npm test` (includes `src/services/apexInstallEmail.test.ts`).
- Production smoke tests: admin publish rejects invalid source/mismatched version; inactive license cannot download or receive mail; active license downloads the exact SHA; one SMTP test email arrives with valid attachment and plain-text fallback.

**Operational prerequisite:** never enable email distribution before publishing and verifying the real compiled .ex5. Do not call this live until both services are deployed and the mail bridge is confirmed working.
