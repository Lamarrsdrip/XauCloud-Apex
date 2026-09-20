import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const s = await fs.readFile(new URL('../ea/XauCloud-Apex.mq5', import.meta.url), 'utf8');

function section(start, end) {
  const a = s.indexOf(start);
  assert.ok(a >= 0, `missing section start: ${start}`);
  const b = end ? s.indexOf(end, a + start.length) : s.length;
  assert.ok(b > a, `missing section end: ${end}`);
  return s.slice(a, b);
}

test('v3.9 preserves the complete hardened execution core from v3.8.8', () => {
  const required = [
    'string ComputePreflight(', 'double LayerMarginPctFor(', 'LayerSizingPlan PlanLayerSizing(',
    'SizingDecision ComputeLayerVolume(', 'double RederiveAfterSizeRejection(', 'bool SizingBlockReportDue(',
    'bool IsSizeOnlyRejection(', 'bool OpenLayer(', 'bool AttemptClosePass(', 'void FinalizeClose(',
    'void ServiceClosing(', 'void RequestClose(', 'string NewCampaignId(', 'void Start(Snap'
  ];
  for (const signature of required) assert.ok(s.includes(signature), `missing preserved execution function: ${signature}`);
});

test('EA uses the canonical XauCloud infrastructure bridge', () => {
  assert.match(s, /InpCloudURL="https:\/\/xaucloud\.io"/);
  assert.match(s, /\/api\/cloud\/monitor\/heartbeat/);
  assert.match(s, /\/api\/cloud\/apex\/config\?license_key=/);
  assert.match(s, /\/api\/cloud\/apex\/event/);
  assert.match(s, /StringToUpper\(s\);StringReplace\(s," ",""\)/);
  assert.doesNotMatch(s, /https:\/\/apex\.xaucloud\.io/);
  assert.doesNotMatch(s, /api\.apex\.xaucloud\.io/);
  assert.doesNotMatch(s, /InpEaToken/);
});

test('transport failures preserve the last validated local trading config', () => {
  assert.match(s, /transport failure never alters C\.armed/);
  assert.match(s, /MONITOR\/CONTROL ONLY; trading uses last validated local config/);
});

test('Strategy Tester stays independent from the remote arm', () => {
  assert.match(s, /if\(IsTester\(\)\)\{C\.armed=true;return true;\}/);
});

test('active campaign management stays first; new-exposure gating lives in the local scan service', () => {
  const onTimer = section('void OnTimer()', null);
  const scan = section('void ServiceEntryScan()', 'void OnTick()');
  assert.ok(onTimer.indexOf('Manage();') >= 0);
  assert.ok(onTimer.indexOf('ServiceEntryScan();') > onTimer.indexOf('Manage();'),
    'Manage() must run before a new signal can submit');
  assert.match(scan, /if\(g_observerOnly\|\|campState!=CAMP_IDLE\|\|!C\.armed\)return;/);
});

const configFields = [
  'normalTargetProfitPct',
  'profitRatchetEnabled',
  'ratchetTriggerPct',
  'ratchetLockPct',
  'ratchetStepPct',
  'ratchetLockStepPct'
];

test('Config struct carries all six basket profit-exit fields', () => {
  const m = s.match(/struct\s+Config\s*\{([\s\S]*?)\n\s*\};/);
  assert.ok(m, 'Config struct not found');
  for (const f of configFields) {
    assert.ok(m[1].includes(f), `Config struct missing ${f}`);
  }
});

test('ConfigFromParsed consumes the six dashboard/backend profit-exit fields into staged config', () => {
  const parser = section('bool ConfigFromParsed', 'bool LoadCloudCache');
  for (const f of configFields) {
    const fn = f === 'profitRatchetEnabled' ? 'CfgBool' : 'CfgNum';
    assert.match(
      parser,
      new RegExp(`out\\.${f}\\s*=\\s*${fn}\\("${f}"`),
      `ConfigFromParsed does not parse ${f}`
    );
  }
});

test('Start() computes NORMAL hard target from C.normalTargetProfitPct, not a compiled Input', () => {
  const start = section('void Start(Snap', '//====================== add candidates');
  assert.match(start, /C\.normalTargetProfitPct>0\?cycleStart\*\(1\.0\+C\.normalTargetProfitPct\/100\.0\)/);
  assert.doesNotMatch(start, /InpNormalTakeProfitPct/);
});

test('restart position adoption also computes NORMAL hard target from C.normalTargetProfitPct', () => {
  const rec = section('void ReconcileAgainstBroker()', '//====================== lifecycle');
  assert.match(rec, /C\.normalTargetProfitPct>0\?cycleStart\*\(1\.0\+C\.normalTargetProfitPct\/100\.0\)/);
  assert.doesNotMatch(rec, /InpNormalTakeProfitPct/);
});

test('campaign ratchet uses the snapshotted Policy P.*, seeded from C.*, never compiled Inputs', () => {
  const snap = section('void SnapshotPolicy()', '// APEX-AUDIT-028');
  for (const f of ['profitRatchetEnabled','ratchetTriggerPct','ratchetLockPct','ratchetStepPct','ratchetLockStepPct']) {
    assert.match(snap, new RegExp(`P\\.${f}\\s*=\\s*C\\.${f}`), `SnapshotPolicy does not seed ${f}`);
  }

  const manage = section('void Manage()', '//====================== restart reconciliation');
  for (const f of ['profitRatchetEnabled','ratchetTriggerPct','ratchetLockPct','ratchetStepPct','ratchetLockStepPct']) {
    assert.match(manage, new RegExp(`P\\.${f}`), `Manage does not use P.${f}`);
  }
  assert.doesNotMatch(
    manage,
    /InpProfitRatchetEnabled|InpRatchetTriggerPct|InpRatchetLockPct|InpRatchetStepPct|InpRatchetLockStepPct/
  );
});

test('compiled profit-exit Inputs remain compatibility seeds only', () => {
  assert.match(s, /input double\s+InpNormalTakeProfitPct=0\.0;/);
  assert.match(s, /input bool\s+InpProfitRatchetEnabled=true;/);

  const defaults = section('void Defaults()', 'string ConfigCanonical');
  assert.match(defaults, /C\.normalTargetProfitPct=InpNormalTakeProfitPct;/);
  assert.match(defaults, /C\.profitRatchetEnabled=InpProfitRatchetEnabled;/);
  assert.match(defaults, /C\.ratchetTriggerPct=InpRatchetTriggerPct;/);
  assert.match(defaults, /C\.ratchetLockPct=InpRatchetLockPct;/);
  assert.match(defaults, /C\.ratchetStepPct=InpRatchetStepPct;/);
  assert.match(defaults, /C\.ratchetLockStepPct=InpRatchetLockStepPct;/);

  assert.equal((s.match(/InpNormalTakeProfitPct/g) || []).length, 2);
  assert.equal((s.match(/InpProfitRatchetEnabled/g) || []).length, 2);
  assert.equal((s.match(/InpRatchetTriggerPct/g) || []).length, 2);
  assert.equal((s.match(/InpRatchetLockPct/g) || []).length, 2);
  assert.equal((s.match(/InpRatchetStepPct/g) || []).length, 2);
  assert.equal((s.match(/InpRatchetLockStepPct/g) || []).length, 2);
});

test('cloud cache round-trips the full config object atomically', () => {
  const json = section('string ConfigToJson', '// APEX-AUDIT-016: cache EVERYTHING');
  for (const f of configFields) {
    assert.ok(json.includes(f), `ConfigToJson missing ${f}`);
  }

  const save = section('void SaveCloudCache()', '// Reads a validated config object');
  assert.match(save, /ConfigToJson\(C\)/);
  assert.match(save, /WriteFileAtomic\(ConfigCacheFile\(\),ConfigToJson\(C\)\)/);

  const load = section('bool LoadCloudCache()', '//====================== policy snapshot');
  assert.match(load, /ConfigFromParsed\(staged\)/);
});

test('ratchet exit check runs before hard Basket TP check', () => {
  const manage = section('void Manage()', '//====================== restart reconciliation');
  const iRatchet = manage.indexOf('P.profitRatchetEnabled');
  const iTP = manage.indexOf('if(targetEq>0&&campEq>=targetEq)');
  assert.ok(iRatchet >= 0 && iTP >= 0 && iRatchet < iTP,
    'ratchet must be evaluated before hard Basket TP');
});

test('NORMAL is the default profile and its L1/L2/L3 ladder comes from runtime C.* config', () => {
  const defaults = section('void Defaults()', 'string ConfigCanonical');
  assert.match(defaults, /C\.accountProfile="NORMAL"/);

  const layer = section('double LayerMarginPctFor(', '// v3.8.8 UNLIMITED state machine');
  assert.match(layer, /C\.normalL1MarginPct/);
  assert.match(layer, /C\.normalL2MarginPct/);
  assert.match(layer, /C\.normalL3PlusMarginPct/);
});

test('200-lot regression fix applies percentage to executable capacity and broker-preflights the final volume', () => {
  const compute = section('SizingDecision ComputeVolume', 'string SizingJson');
  assert.match(compute, /d\.capacityByBroker=LargestVolumePassingCheck/);
  assert.match(compute, /d\.byCapacityPct=FloorToStep\(d\.capacity\*clamp\(pct,.1,100\)\/100\.0\)/);
  assert.match(compute, /d\.requested=MathMin\(d\.byCapacityPct,d\.byMarginBudget\)/);
  assert.match(compute, /BrokerAcceptsVolume\(dir,v,price,sl,d\.checkRetcode\)/);

  const broker = section('bool BrokerAcceptsVolume', '// Largest grid volume');
  assert.match(broker, /OrderCheck\(rq,cr\)/);
});

test('failed/unconfirmed broker submissions cannot increment Apex layer state', () => {
  const open = section('bool OpenLayer(', '//====================== closing');
  const iReject = open.indexOf('if(e.cls!=EXEC_FILLED&&e.cls!=EXEC_PARTIAL)');
  const iLayers = open.indexOf('layers++;');
  assert.ok(iReject >= 0 && iLayers > iReject,
    'layers++ must occur only after confirmed/partial broker fill');
});

test('v3.9.1 starts L1 only from direction-aligned breakout/trend ignition', () => {
  assert.match(s, /if\(s\.valid\)\s*Start\(s\);/);
  assert.match(s, /strategy=BREAKOUT_TREND_DIRECTION_AUTHORITY \| entry=live-ignition-v3\.9\.1/);
  assert.match(s, /DIRECTION_ALIGNED_SIGNAL_CONFIRMED/);
  assert.doesNotMatch(s, /CONFIRMED_EXHAUSTION_REVERSAL|LIQUIDITY_EXHAUST/);
});

test('v3.8.2 FinalEntryGate still treats a newer M1 as TRIGGER_BAR_NO_LONGER_LATEST', () => {
  const gate = section('bool FinalEntryGate(', '// WAF/HTML 401/403');
  assert.match(gate, /TRIGGER_BAR_NO_LONGER_LATEST/);
  assert.match(gate, /return false;/);
  assert.doesNotMatch(gate, /PRICE_LEFT_ORIGIN_BOX/);
  assert.doesNotMatch(gate, /triggerStale is measured for telemetry and NEVER blocks/);
});

test('v3.9 preserves hardened first-submit fencing; continuation adds do not reuse reversal reclaim semantics', () => {
  const start = section('void Start(Snap', '//====================== add candidates');
  assert.match(start, /campState=CAMP_SUBMITTING/);
  assert.match(start, /FIRST ENTRY PENDING/);
  assert.match(start, /s\.setupFamily\+"_L1_IGNITION"/);
  const manage = section('void Manage()', '//====================== restart reconciliation');
  assert.match(manage, /bool enforceReclaim=false;/);
});

test('v3.8.6: uncertain recovered identity blocks new exposure, existing basket still managed', () => {
  const rec = section('void ReconcileAgainstBroker()', '//====================== lifecycle');
  assert.match(rec, /anchorsKnown=false/);
  assert.match(rec, /CYCLE_START_AND_ORIGINAL_SL_UNKNOWN_NEW_EXPOSURE_BLOCKED/);
  const pre = section('string ComputePreflight()', 'double LayerMarginPct()');
  assert.match(pre, /ANCHORS_UNRECONCILED/);
  assert.match(pre, /CAMPAIGN_CLOSING/);
});

test('v3.9.1 L2/L3 adds require fresh same-direction evidence and current Direction Authority', () => {
  const add = section('AddCandidate BuildAddCandidate()', '//====================== basket management');
  assert.match(add, /bar<=campStart/);
  assert.match(add, /L2_CONFIRMATION/);
  assert.match(add, /L3_EXPANSION/);
  assert.match(add, /DIRECTION_AUTHORITY_NO_LONGER_CONFIRMS_CAMPAIGN/);
  assert.match(add, /pressure<pressureMin\|\|pressure-opp<8/);
  assert.match(add, /CONFIRM\|%s\|%I64d/);
  assert.doesNotMatch(add, /REVERSAL/);
});

test('v3.8.6: same trigger cannot add twice; GATE_SHADOW stays the default', () => {
  const manage = section('void Manage()', '//====================== restart reconciliation');
  assert.match(manage, /TRIGGER_ALREADY_CONSUMED/);
  assert.match(manage, /InpMaxAddsPerTrigger/);
  assert.match(s, /input ApexGateMode InpEntryExtensionMode=GATE_SHADOW/);
});

test('v3.8.8 did not touch the NORMAL capacity engine: its branch is byte-identical to v3.8.2', async () => {
  const v382 = await fs.readFile(new URL('../ea/archive/XauCloud-Apex-v3.8.2-CapacityTruth.mq5', import.meta.url), 'utf8');
  const branch = (src) => {
    const a = src.indexOf('   if(ExecutionProfile()=="NORMAL")\n     {\n      double calcM=0');
    const b = src.indexOf("   // UNLIMITED: preserve the owner's aggressive semantics.", a);
    assert.ok(a > 0 && b > a, 'NORMAL branch of ComputeVolume not found');
    return src.slice(a, b);
  };
  assert.equal(branch(s), branch(v382));
});

test('v3.8.8: NORMAL keeps the C.normal* ladder; UNLIMITED takes the fixed 1:200-first state machine', () => {
  const ladder = section('double LayerMarginPctFor(', '// v3.8.8 UNLIMITED state machine');
  assert.doesNotMatch(ladder, /baseMarginPct\s*\*\s*MathPow/,
    'the baseMarginPct*layerMultiplier^layers form must not size a layer');
  assert.match(ladder, /filledLayers<=0\)\s*return[^;]*normalL1MarginPct/);
  assert.match(ladder, /filledLayers==1\)\s*return[^;]*normalL2MarginPct/);
  assert.match(ladder, /return[^;]*normalL3PlusMarginPct/);
  assert.match(s, /double LayerMarginPct\(\)\{return LayerMarginPctFor\(layers\);\}/);
  const plan = section('LayerSizingPlan PlanLayerSizing(', '// The ONLY entry point that sizes a layer.');
  assert.match(plan, /if\(profile=="NORMAL"\)\s*\{p\.mode="NORMAL";p\.pct=LayerMarginPctFor\(p\.filledLayers\)/);
  assert.doesNotMatch(plan, /normalL1MarginPct|normalL2MarginPct/,
    'UNLIMITED percentages must not be read from NORMAL dashboard fields');
});

test('v3.8.8: the requested percentage AND engine survive capacity rediscovery', () => {
  const open = section('bool OpenLayer(', 'string execExtra=StringFormat(');
  assert.doesNotMatch(open, /FloorToStep\(vol\*0\.5\)/,
    'the halve-until-it-fills retry must be gone');
  assert.doesNotMatch(open, /SIZING_STEP_DOWN/,
    'the step-down event belonged to the halving path');
  assert.match(open, /RederiveAfterSizeRejection\(plan,/);
  assert.match(open, /SIZING_CAPACITY_REDERIVED/);
  const re = section('double RederiveAfterSizeRejection(', '// A blocked UNLIMITED layer WAITS');
  assert.match(re, /ServerCapacityCeiling\(\)/,
    'rediscovery must be bounded by server-proven evidence');
  assert.match(re, /trueCap\*pct\/100\.0/,
    'the SAME percentage must be re-applied to the re-derived capacity');
});

test('v3.8.7: server-proven capacity evidence survives a restart', () => {
  const save = section('void SaveState()', 'void ClearState()');
  const load = section('int LoadState()', 'void OnDeinit');
  for (const k of ['srvRejectedVol', 'srvFilledVol', 'srvEvidenceFreeMargin']) {
    assert.match(save, new RegExp(k), `SaveState must persist ${k}`);
    assert.match(load, new RegExp(k), `LoadState must restore ${k}`);
  }
  // Never invent capacity that was never proven.
  assert.match(load, /JNumOr\("srvRejectedVol",0\)/);
});

test('v3.8.6: schema 4 persists setup, pending submit and cloud lease', () => {
  assert.match(s, /#define APEX_STATE_SCHEMA\s+4/);
  assert.match(s, /CAMP_SUBMITTING=3/);
  const save = section('void SaveState()', 'void ClearState()');
  assert.match(save, /\\"setup\\":\{\\"state\\":/);
  assert.match(save, /\\"pending\\":\{\\"active\\":/);
  assert.match(save, /\\"cloudLease\\":\{\\"supported\\":/);
  assert.doesNotMatch(save, /waitingLocationSince/);
  assert.doesNotMatch(save, /\\"deadThesis\\":\{\\"active\\":/);
  const load = section('int LoadState()', '//====================== volume sizing');
  assert.match(load, /\(int\)sch!=APEX_STATE_SCHEMA&&\(int\)sch!=3&&\(int\)sch!=5/);
  assert.match(load, /SetupSnapshotValidToRestore/);
  assert.match(load, /g_pending\.active=JBoolOr\("active"/);
});

test('v3.8.6: WAF/HTML 401/403 keeps last-good; only XauCloud JSON envelope tombstones', () => {
  const den = section('bool IsAuthenticatedDenial(', 'bool CloudSync()');
  assert.match(den, /BodyLooksLikeJsonObject/);
  assert.match(den, /IsXauCloudDenialEnvelope/);
  assert.match(den, /TRANSPORT_OR_WAF/);
  assert.doesNotMatch(den, /if\(!JsonParseObject\(resp\)\) \{reason="LICENSE_DENIED";return true;\}/);
});

test('v3.8.6: PLACED fences the campaign; Start does not reset while pending', () => {
  const open = section('bool OpenLayer(', '//====================== closing');
  assert.match(open, /e\.cls==EXEC_PENDING \|\| ClassifyBrokerSubmit/);
  assert.match(open, /ORDER_PENDING/);
  assert.match(open, /will NOT resend/);
  const start = section('void Start(Snap', '//====================== add candidates');
  assert.match(start, /campState=CAMP_SUBMITTING/);
  assert.match(start, /FIRST ENTRY PENDING/);
  const pre = section('string ComputePreflight()', 'double LayerMarginPct()');
  assert.match(pre, /ORDER_PENDING_BROKER_CONFIRMATION/);
  assert.match(pre, /CROSS_TERMINAL_LEASE_NOT_MANAGER/);
  assert.match(pre, /CAMPAIGN_SUBMITTING/);
});

test('v3.9: cloud tick is bounded and never runs before Manage or the local signal scan', () => {
  const onTimer = section('void OnTimer()', null);
  const iManage = onTimer.indexOf('Manage();');
  const iScan = onTimer.indexOf('ServiceEntryScan();');
  const iCloud = onTimer.indexOf('CloudSync()');
  const iFlush = onTimer.indexOf('FlushEventQueue()');
  assert.ok(iManage >= 0 && iScan > iManage && iCloud > iScan, 'Manage -> local scan -> CloudSync');
  assert.ok(iFlush > iScan, 'event flush after local scan');
  assert.match(onTimer, /if\(cloudDue\)\{CloudSync\(\);lastCfg=now;\}/);
  assert.match(onTimer, /else FlushEventQueue\(\);/);
  assert.match(s, /InpCloudTickBudgetMs=1200/);
  assert.match(s, /HEARTBEAT_OK_CONFIG_DEFERRED/);
});

test('v3.8.6: CLOSING persists until broker shows zero owned positions', () => {
  const close = section('bool AttemptClosePass()', 'void FinalizeClose()');
  assert.match(close, /return CountPos\(\)==0/);
  assert.match(close, /sent=true means the request was accepted for sending, not that the position is gone/);
  const svc = section('void ServiceClosing()', 'void RequestClose');
  assert.match(svc, /closing intent must survive a restart mid-retry/);
  const rec = section('void ReconcileAgainstBroker()', '//====================== lifecycle');
  assert.match(rec, /stays CLOSING until zero positions/);
});

test('v3.8.6: customer-facing WebRequest origin is xaucloud.io everywhere in this repo', async () => {
  const ui = await fs.readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  const readme = await fs.readFile(new URL('../README.md', import.meta.url), 'utf8');
  const validation = await fs.readFile(new URL('../VALIDATION.txt', import.meta.url), 'utf8');
  assert.match(ui, /allow WebRequest for <code>https:\/\/xaucloud\.io<\/code>/);
  assert.doesNotMatch(ui, /allow WebRequest for <code>https:\/\/apex\.xaucloud\.io<\/code>/);
  assert.match(readme, /https:\/\/xaucloud\.io/);
  assert.match(validation, /https:\/\/xaucloud\.io/);
  assert.match(s, /InpCloudURL="https:\/\/xaucloud\.io"/);
});

test('v3.8.6: systemd keeps DATA_DIR and does not require a user production may not have', async () => {
  const unit = await fs.readFile(new URL('../deploy/xaucloud-apex.service', import.meta.url), 'utf8');
  const server = await fs.readFile(new URL('../server.mjs', import.meta.url), 'utf8');
  assert.match(unit, /DATA_DIR=\/var\/lib\/xaucloud-apex/);
  assert.match(unit, /StateDirectory=xaucloud-apex/);
  assert.doesNotMatch(unit, /^User=/m);
  assert.match(server, /APEX_STRICT_SECRETS/);
  assert.match(server, /listening anyway so the dashboard stays up/);
});

test('server config schema includes the same six basket profit-exit fields', async () => {
  const server = await fs.readFile(new URL('../server.mjs', import.meta.url), 'utf8');
  for (const f of configFields) {
    assert.ok(server.includes(f), `server.mjs missing ${f}`);
  }
});

