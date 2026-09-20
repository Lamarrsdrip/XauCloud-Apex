import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

process.env.NODE_ENV='test';
delete process.env.APEX_BRIDGE_SECRET;
delete process.env.XAUCLOUD_BASE_URL;
process.env.DATA_DIR=await fs.mkdtemp(path.join(os.tmpdir(),'apex-setup-telemetry-'));
process.env.SESSION_SECRET='test-session-secret-at-least-32-chars!!';

const {projectSetupStatus}=await import('../server.mjs?setuptelemetry='+Date.now());

test('SETUP-TELEMETRY: active breakout exposes pressure, closed-confirmation wait and level evidence',()=>{
  const events=[
    {ts:'2026-09-19T10:00:00.000Z',eventId:'1',type:'WATCH_ARMED',setupId:'S1',watchDir:1,
      setupFamily:'BREAKOUT',regime:'BREAKOUT_UP',invalidationLevel:3648,referenceLevel:3650,strength:75},
    {ts:'2026-09-19T10:00:05.000Z',eventId:'2',type:'SETUP_SCORE',setupId:'S1',setupDir:1,setupState:'WATCHING',
      setupFamily:'BREAKOUT',regime:'BREAKOUT_UP',score:73,requiredScore:76,buyPressure:68,sellPressure:32,
      activePressure:68,trendStrength:20,candleQuality:61,compressionScore:75,pullbackQuality:0,
      contextOk:true,ignition:false,liveTrigger:false,waitReason:'CLOSED_CONFIRMATION',triggerKind:'NONE',
      breakoutLevel:3650,invalidationLevel:3648}
  ];
  const s=projectSetupStatus(events,Date.parse('2026-09-19T10:00:10.000Z'));
  assert.equal(s.active,true); assert.equal(s.setupFamily,'BREAKOUT'); assert.equal(s.regime,'BREAKOUT_UP');
  assert.equal(s.direction,'BUY'); assert.equal(s.buyPressure,68); assert.equal(s.activePressure,68);
  assert.equal(s.waitReason,'CLOSED_CONFIRMATION'); assert.equal(s.invalidationLevel,3648);
});

test('SETUP-TELEMETRY: confirmed trend continuation preserves evidence',()=>{
  const events=[
    {ts:'2026-09-19T11:00:00.000Z',eventId:'1',type:'WATCH_ARMED',setupId:'T1',watchDir:-1,
      setupFamily:'TREND_CONTINUATION',regime:'TREND_DOWN_CONTINUATION',invalidationLevel:3670,referenceLevel:3665},
    {ts:'2026-09-19T11:00:07.000Z',eventId:'2',type:'SETUP_SCORE',setupId:'T1',setupDir:-1,setupState:'WATCHING',
      setupFamily:'TREND_CONTINUATION',regime:'TREND_DOWN_CONTINUATION',score:81,requiredScore:76,
      buyPressure:31,sellPressure:69,activePressure:69,trendStrength:84,candleQuality:78,
      compressionScore:0,pullbackQuality:66,contextOk:true,ignition:true,liveTrigger:false,
      waitReason:'READY',triggerKind:'CLOSED_M1_STRUCTURE_BREAK',invalidationLevel:3670},
    {ts:'2026-09-19T11:00:08.000Z',eventId:'3',type:'SETUP_CONFIRMED',setupId:'T1',setupDir:-1,
      setupFamily:'TREND_CONTINUATION',regime:'TREND_DOWN_CONTINUATION',score:81,requiredScore:76,
      activePressure:69,candleQuality:78,triggerKind:'CLOSED_M1_STRUCTURE_BREAK'}
  ];
  const s=projectSetupStatus(events,Date.parse('2026-09-19T11:00:09.000Z'));
  assert.equal(s.state,'CONFIRMED'); assert.equal(s.direction,'SELL'); assert.equal(s.active,true);
  assert.equal(s.triggerKind,'CLOSED_M1_STRUCTURE_BREAK'); assert.equal(s.candleQuality,78);
});

test('SETUP-TELEMETRY: invalidation is terminal',()=>{
  const events=[
    {ts:'2026-09-19T12:00:00.000Z',eventId:'1',type:'WATCH_ARMED',setupId:'S1',watchDir:1,setupFamily:'BREAKOUT'},
    {ts:'2026-09-19T12:00:20.000Z',eventId:'2',type:'SETUP_INVALIDATED',setupId:'S1',setupDir:1,setupState:'INVALIDATED',
      cancelReason:'THESIS_INVALIDATION_LEVEL_BREACHED'}
  ];
  const s=projectSetupStatus(events,Date.parse('2026-09-19T12:00:25.000Z'));
  assert.equal(s.active,false); assert.equal(s.state,'INVALIDATED'); assert.match(s.reason,/THESIS_INVALIDATION/);
});

test('SETUP-TELEMETRY: a newer setup supersedes the older terminal setup',()=>{
  const events=[
    {ts:'2026-09-19T13:00:00.000Z',eventId:'1',type:'WATCH_ARMED',setupId:'S1',watchDir:-1,setupFamily:'BREAKOUT'},
    {ts:'2026-09-19T13:01:00.000Z',eventId:'2',type:'SETUP_EXPIRED',setupId:'S1',setupDir:-1,cancelReason:'EXPIRED'},
    {ts:'2026-09-19T13:02:00.000Z',eventId:'3',type:'WATCH_ARMED',setupId:'S2',watchDir:1,setupFamily:'TREND_CONTINUATION',regime:'TREND_UP_CONTINUATION'}
  ];
  const s=projectSetupStatus(events,Date.parse('2026-09-19T13:02:02.000Z'));
  assert.equal(s.setupId,'S2'); assert.equal(s.direction,'BUY'); assert.equal(s.active,true);
});

test('SETUP-TELEMETRY: canonical and versioned v3.9.2 sources remain byte-identical',async()=>{
  const root=new URL('../',import.meta.url);
  const canonical=await fs.readFile(new URL('ea/XauCloud-Apex.mq5',root),'utf8');
  const versioned=await fs.readFile(new URL('ea/XauCloud-Apex-v3.9.2-ConfirmedDirection.mq5',root),'utf8');
  assert.equal(canonical,versioned);
  assert.match(canonical,/CLOSED_SETUP_CONFIRMATION_READY/);
  assert.match(canonical,/void OnTick\(\)\{UpdateTickPressure\(\);ServiceEntryScan\(\);\}/);
});
