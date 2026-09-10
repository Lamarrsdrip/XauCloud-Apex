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

test('SETUP-TELEMETRY: active setup exposes score, threshold and gates',()=>{
  const events=[
    {ts:'2026-09-10T10:00:00.000Z',eventId:'1',type:'WATCH_ARMED',setupId:'S1',watchDir:-1,impulseAtr:2.1,extreme:4400,priorLevel:4397},
    {ts:'2026-09-10T10:00:05.000Z',eventId:'2',type:'SETUP_SCORE',setupId:'S1',setupDir:-1,setupState:'WATCHING',
      score:67,requiredScore:76,basePoints:25,impulsePoints:17,rejectionPoints:24,bosPoints:0,m3Points:0,m5Points:0,wickPoints:1,
      rejected:true,microBreak:false,m3Color:false,m3Fresh:false,m5Color:false,m3Available:true,m5Available:true,
      m3Gate:false,m5Gate:true,requireM3:true,requireM5:false,waitReason:'MICRO_BOS',bosKind:'NONE'}
  ];
  const s=projectSetupStatus(events,Date.parse('2026-09-10T10:00:10.000Z'));
  assert.equal(s.active,true);
  assert.equal(s.state,'WATCHING');
  assert.equal(s.direction,'SELL');
  assert.equal(s.score,67);
  assert.equal(s.requiredScore,76);
  assert.equal(s.rejected,true);
  assert.equal(s.microBreak,false);
  assert.equal(s.waitReason,'MICRO_BOS');
  assert.equal(s.eventAgeSec,5);
  assert.equal(s.setupAgeSec,10);
});

test('SETUP-TELEMETRY: expiry is terminal and remains visible with the reason',()=>{
  const events=[
    {ts:'2026-09-10T10:00:00.000Z',eventId:'1',type:'WATCH_ARMED',setupId:'S1',watchDir:1},
    {ts:'2026-09-10T10:01:00.000Z',eventId:'2',type:'SETUP_SCORE',setupId:'S1',setupDir:1,setupState:'WATCHING',
      score:61,requiredScore:76,rejected:false,microBreak:false,m3Gate:false,m5Gate:true,requireM3:true,requireM5:false,waitReason:'REJECTION'},
    {ts:'2026-09-10T10:12:01.000Z',eventId:'3',type:'SETUP_EXPIRED',setupId:'S1',setupDir:1,setupState:'EXPIRED',cancelReason:'EXPIRED'}
  ];
  const s=projectSetupStatus(events,Date.parse('2026-09-10T10:12:06.000Z'));
  assert.equal(s.active,false);
  assert.equal(s.state,'EXPIRED');
  assert.equal(s.reason,'EXPIRED');
  assert.equal(s.score,61);
  assert.equal(s.eventAgeSec,5);
});

test('SETUP-TELEMETRY: invalidation is not silently resurrected by unrelated events',()=>{
  const events=[
    {ts:'2026-09-10T10:00:00.000Z',eventId:'1',type:'WATCH_ARMED',setupId:'S1',watchDir:-1},
    {ts:'2026-09-10T10:00:30.000Z',eventId:'2',type:'SETUP_INVALIDATED',setupId:'S1',setupDir:-1,setupState:'INVALIDATED',cancelReason:'NEW_EXTREME_BEYOND_SWEPT_LEVEL'},
    {ts:'2026-09-10T10:00:31.000Z',eventId:'3',type:'MASTER_SL_MOVED'}
  ];
  const s=projectSetupStatus(events,Date.parse('2026-09-10T10:00:40.000Z'));
  assert.equal(s.active,false);
  assert.equal(s.state,'INVALIDATED');
  assert.match(s.reason,/NEW_EXTREME/);
});

test('SETUP-TELEMETRY: a newer setup supersedes an older terminal setup',()=>{
  const events=[
    {ts:'2026-09-10T10:00:00.000Z',eventId:'1',type:'WATCH_ARMED',setupId:'S1',watchDir:-1},
    {ts:'2026-09-10T10:01:00.000Z',eventId:'2',type:'SETUP_EXPIRED',setupId:'S1',setupDir:-1,setupState:'EXPIRED',cancelReason:'EXPIRED'},
    {ts:'2026-09-10T10:02:00.000Z',eventId:'3',type:'WATCH_ARMED',setupId:'S2',watchDir:1},
    {ts:'2026-09-10T10:02:05.000Z',eventId:'4',type:'SETUP_SCORE',setupId:'S2',setupDir:1,setupState:'WATCHING',score:70,requiredScore:76,
      rejected:true,microBreak:true,m3Gate:false,m5Gate:true,requireM3:true,requireM5:false,waitReason:'M3_CONFIRM'}
  ];
  const s=projectSetupStatus(events,Date.parse('2026-09-10T10:02:10.000Z'));
  assert.equal(s.setupId,'S2');
  assert.equal(s.direction,'BUY');
  assert.equal(s.active,true);
});


test('SETUP-TELEMETRY: delayed outbox replay cannot resurrect an older setup',()=>{
  const events=[
    // XauCloud receipt ts makes the old S1 score look newer, but emittedAt proves it is older.
    {ts:'2026-09-10T10:05:00.000Z',emittedAt:1789034405,eventId:'late-old',type:'SETUP_SCORE',setupId:'S1',setupDir:-1,
      setupState:'WATCHING',score:60,requiredScore:76,rejected:false,microBreak:false,m3Gate:false,m5Gate:true,requireM3:true,requireM5:false,waitReason:'REJECTION'},
    {ts:'2026-09-10T10:02:00.000Z',emittedAt:1789034520,eventId:'new-arm',type:'WATCH_ARMED',setupId:'S2',watchDir:1},
    {ts:'2026-09-10T10:02:05.000Z',emittedAt:1789034525,eventId:'new-score',type:'SETUP_SCORE',setupId:'S2',setupDir:1,
      setupState:'WATCHING',score:70,requiredScore:76,rejected:true,microBreak:true,m3Gate:false,m5Gate:true,requireM3:true,requireM5:false,waitReason:'M3_CONFIRM'}
  ];
  const s=projectSetupStatus(events,Date.parse('2026-09-10T10:02:10.000Z'));
  assert.equal(s.setupId,'S2');
  assert.equal(s.direction,'BUY');
  assert.equal(s.score,70);
});

test('SETUP-TELEMETRY: canonical and versioned EA remain byte-identical and trading trigger stays unchanged',async()=>{
  const root=new URL('../',import.meta.url);
  const canonical=await fs.readFile(new URL('ea/XauCloud-Apex.mq5',root),'utf8');
  const versioned=await fs.readFile(new URL('ea/XauCloud-Apex-v3.8.6-HardenedCapacity.mq5',root),'utf8');
  assert.equal(canonical,versioned);
  assert.match(canonical,/Emit\("SETUP_SCORE"/);
  assert.match(canonical,/eventType="SETUP_EXPIRED"/);
  assert.match(canonical,/eventType="SETUP_INVALIDATED"/);
  assert.match(canonical,/Emit\("SETUP_CONFIRMED"/);
  assert.match(canonical,/if\(s\.valid\) Start\(s\);/);
});
