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

test('active campaign management executes before the armed gate', () => {
  const onTimer = section('void OnTimer()', null);
  const iManage = onTimer.indexOf('Manage();');
  const iArmed = onTimer.indexOf('if(!C.armed) return;');
  assert.ok(iManage >= 0 && iArmed >= 0 && iManage < iArmed,
    'Manage() must run before the new-exposure armed gate');
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

  const layer = section('double LayerMarginPct()', '// A rejection that is purely about SIZE');
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

test('server config schema includes the same six basket profit-exit fields', async () => {
  const server = await fs.readFile(new URL('../server.mjs', import.meta.url), 'utf8');
  for (const f of configFields) {
    assert.ok(server.includes(f), `server.mjs missing ${f}`);
  }
});

