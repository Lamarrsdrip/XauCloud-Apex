import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createNotificationEngine, notificationForEvent } from '../notifications.mjs';
import { resolvePersistentDataDir, preparePersistentRuntimeData } from '../runtime-data.mjs';

function fakePush(){
  const sent=[];
  const api={
    generateVAPIDKeys(){return {publicKey:'TEST_PUBLIC_KEY_ABCDEFGHIJKLMNOPQRSTUVWXYZ',privateKey:'TEST_PRIVATE_KEY_ABCDEFGHIJKLMNOPQRSTUVWXYZ'}},
    setVapidDetails(){},
    async sendNotification(sub,payload){sent.push({sub,payload:JSON.parse(payload)});return {statusCode:201}}
  };
  return {api,sent};
}
async function fixture(){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'apex-push-'));
  const f=fakePush();
  const engine=createNotificationEngine({dataDir:dir,origin:'https://apex.example.test',webPushAdapter:f.api,logger:{info(){},error(){}}});
  await engine.ensure();
  return {dir,engine,sent:f.sent};
}
const sub=n=>({endpoint:`https://push.example.test/device-${n}`,keys:{p256dh:`key-${n}`,auth:`auth-${n}`}});
const lic='APEX-AAAAAA-BBBBBB-CCCCCC';

test('notification truth: FIRED only comes from confirmed L1 LAYER_OPEN, not CAMPAIGN_START',()=>{
  assert.equal(notificationForEvent({type:'CAMPAIGN_START',direction:-1,symbol:'XAUUSDm'}),null);
  const n=notificationForEvent({type:'LAYER_OPEN',layer:1,direction:-1,symbol:'XAUUSDm',price:4400.1,volume:2});
  assert.match(n.title,/APEX FIRED/); assert.match(n.body,/L1 opened/);
});

test('subscribe + test push uses real server-side adapter path',async()=>{
  const {engine,sent}=await fixture();
  await engine.subscribe(lic,sub(1));
  const r=await engine.sendTest(lic);
  assert.equal(r.sent,1); assert.equal(sent.length,1); assert.match(sent[0].payload.title,/Notifications Active/);
});

test('WATCH_ARMED queues once even when same event is ingested twice',async()=>{
  const {engine,sent}=await fixture(); await engine.subscribe(lic,sub(1));
  const e={license:lic,eventId:'evt-watch-1',type:'WATCH_ARMED',watchDir:-1,symbol:'XAUUSDm',setupId:'setup-77'};
  assert.equal((await engine.ingest(e)).queued,true);
  assert.equal((await engine.ingest(e)).queued,false);
  await engine.drain(); assert.equal(sent.length,1); assert.match(sent[0].payload.title,/Setup Detected/);
});

test('semantic duplicate WATCH_ARMED is suppressed but cancellation unlocks a fresh setup',async()=>{
  const {engine,sent}=await fixture(); await engine.subscribe(lic,sub(1));
  await engine.ingest({license:lic,eventId:'w1',type:'WATCH_ARMED',watchDir:1,symbol:'XAUUSDm',setupId:'same'});
  await engine.ingest({license:lic,eventId:'w2',type:'WATCH_ARMED',watchDir:1,symbol:'XAUUSDm',setupId:'same'});
  await engine.drain(); assert.equal(sent.length,1);
  await engine.ingest({license:lic,eventId:'c1',type:'SETUP_CANCELLED',setupId:'same'});
  await engine.ingest({license:lic,eventId:'w3',type:'WATCH_ARMED',watchDir:1,symbol:'XAUUSDm',setupId:'same'});
  await engine.drain(); assert.equal(sent.filter(x=>/Setup Detected/.test(x.payload.title)).length,2);
});

test('L1 fires, later layer alerts, broker rejection never becomes FIRED',async()=>{
  const {engine,sent}=await fixture(); await engine.subscribe(lic,sub(1));
  await engine.ingest({license:lic,eventId:'l1',type:'LAYER_OPEN',layer:1,direction:-1,symbol:'XAUUSDm',price:4401,volume:2});
  await engine.ingest({license:lic,eventId:'l2',type:'LAYER_OPEN',layer:2,direction:-1,symbol:'XAUUSDm',price:4400,volume:4});
  await engine.ingest({license:lic,eventId:'rej',type:'ORDER_REJECTED',direction:-1,retcode:10019});
  await engine.drain();
  assert.equal(sent.filter(x=>/APEX FIRED/.test(x.payload.title)).length,1);
  assert.equal(sent.filter(x=>/Added L2/.test(x.payload.title)).length,1);
  assert.equal(sent.filter(x=>/EXECUTION WARNING/.test(x.payload.title)).length,1);
});

test('per-license isolation and multiple devices',async()=>{
  const {engine,sent}=await fixture();
  const licB='APEX-DDDDDD-EEEEEE-FFFFFF';
  await engine.subscribe(lic,sub(1)); await engine.subscribe(lic,sub(2)); await engine.subscribe(licB,sub(3));
  await engine.ingest({license:lic,eventId:'iso1',type:'LAYER_OPEN',layer:1,direction:1,symbol:'XAUUSDm'});
  await engine.drain();
  assert.equal(sent.length,2); assert.ok(sent.every(x=>!x.sub.endpoint.endsWith('device-3')));
});

test('preferences are separate from trading config and suppress only the selected notification kind',async()=>{
  const {engine,sent}=await fixture(); await engine.subscribe(lic,sub(1));
  await engine.setPreferences(lic,{setupDetected:false,tradeFired:true});
  await engine.ingest({license:lic,eventId:'pref-watch',type:'WATCH_ARMED',watchDir:-1,setupId:'pref1'});
  await engine.ingest({license:lic,eventId:'pref-fire',type:'LAYER_OPEN',layer:1,direction:-1});
  await engine.drain();
  assert.equal(sent.length,1); assert.match(sent[0].payload.title,/APEX FIRED/);
});

test('delivery dedupe survives engine restart',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'apex-push-restart-'));
  const a=fakePush(); let engine=createNotificationEngine({dataDir:dir,webPushAdapter:a.api,logger:{info(){},error(){}}}); await engine.ensure(); await engine.subscribe(lic,sub(1));
  const e={license:lic,eventId:'persistent-dedupe',type:'LAYER_OPEN',layer:1,direction:1};
  await engine.ingest(e); await engine.drain(); assert.equal(a.sent.length,1);
  const b=fakePush(); engine=createNotificationEngine({dataDir:dir,webPushAdapter:b.api,logger:{info(){},error(){}}}); await engine.ensure();
  assert.equal((await engine.ingest(e)).queued,false); await engine.drain(); assert.equal(b.sent.length,0);
});

test('production data path is outside release by default and legacy two-license DB merges without overwrite',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'apex-persist-')); const legacy=path.join(root,'release','data'); const home=path.join(root,'home');
  await fs.mkdir(legacy,{recursive:true}); await fs.mkdir(home,{recursive:true});
  const l1='APEX-OLD-1',l2='APEX-OLD-2';
  await fs.writeFile(path.join(legacy,'licenses.json'),JSON.stringify({[l1]:{status:'ACTIVE',account:'111'},[l2]:{status:'ACTIVE',account:'222'}}));
  await fs.writeFile(path.join(legacy,'license-configs.json'),JSON.stringify({[l1]:{accountProfile:'NORMAL'},[l2]:{accountProfile:'UNLIMITED'}}));
  const data=resolvePersistentDataDir({legacyDataDir:legacy,env:{NODE_ENV:'production',HOME:home},isProduction:true});
  assert.ok(data.startsWith(home));
  await preparePersistentRuntimeData({dataDir:data,legacyDataDir:legacy,logger:{info(){}}});
  let got=JSON.parse(await fs.readFile(path.join(data,'licenses.json'),'utf8')); assert.deepEqual(Object.keys(got).sort(),[l1,l2].sort());
  // Existing persistent value wins a later legacy conflict.
  got[l1].account='999'; await fs.writeFile(path.join(data,'licenses.json'),JSON.stringify(got));
  await preparePersistentRuntimeData({dataDir:data,legacyDataDir:legacy,logger:{info(){}}});
  got=JSON.parse(await fs.readFile(path.join(data,'licenses.json'),'utf8')); assert.equal(got[l1].account,'999'); assert.ok(got[l2]);
});

test('expired 410 subscription is pruned and never retried forever',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'apex-push-gone-'));
  const api={generateVAPIDKeys(){return {publicKey:'P'.repeat(48),privateKey:'Q'.repeat(48)}},setVapidDetails(){},async sendNotification(){const e=new Error('gone');e.statusCode=410;throw e}};
  const engine=createNotificationEngine({dataDir:dir,webPushAdapter:api,logger:{info(){},error(){}}}); await engine.ensure(); await engine.subscribe(lic,sub(1));
  await engine.ingest({license:lic,eventId:'gone-event',type:'LAYER_OPEN',layer:1,direction:1}); await engine.drain();
  assert.equal((await engine.listDeviceSummary(lic)).length,0);
  assert.equal(JSON.parse(await fs.readFile(engine.files.outbox,'utf8')).length,0);
});

test('temporary provider failure is durably retried without duplicate successful delivery',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'apex-push-retry-')); let calls=0;
  const api={generateVAPIDKeys(){return {publicKey:'R'.repeat(48),privateKey:'S'.repeat(48)}},setVapidDetails(){},async sendNotification(){calls++;if(calls===1){const e=new Error('temporary');e.statusCode=503;throw e}return {statusCode:201}}};
  const engine=createNotificationEngine({dataDir:dir,webPushAdapter:api,logger:{info(){},error(){}}}); await engine.ensure(); await engine.subscribe(lic,sub(1));
  await engine.ingest({license:lic,eventId:'retry-event',type:'LAYER_OPEN',layer:1,direction:-1}); await engine.drain();
  let q=JSON.parse(await fs.readFile(engine.files.outbox,'utf8')); assert.equal(q.length,1); assert.equal(q[0].attempts,1);
  q[0].nextAttemptAt=new Date(Date.now()-1000).toISOString(); await fs.writeFile(engine.files.outbox,JSON.stringify(q,null,2));
  await engine.drain(); assert.equal(calls,2); assert.equal(JSON.parse(await fs.readFile(engine.files.outbox,'utf8')).length,0);
});

test('first bridge reconciliation establishes baseline without replaying stale events; later event notifies',async()=>{
  const {engine,sent}=await fixture(); await engine.subscribe(lic,sub(1));
  const old=[
    {eventId:'old-watch',type:'WATCH_ARMED',watchDir:-1,setupId:'old-setup'},
    {eventId:'old-l1',type:'LAYER_OPEN',layer:1,direction:-1}
  ];
  const first=await engine.reconcileCanonicalEvents(lic,old); assert.equal(first.bootstrapped,true); await engine.drain(); assert.equal(sent.length,0);
  const next=[...old,{eventId:'new-l2',type:'LAYER_OPEN',layer:2,direction:-1}];
  const second=await engine.reconcileCanonicalEvents(lic,next); assert.equal(second.bootstrapped,false); await engine.drain();
  assert.equal(sent.length,1); assert.match(sent[0].payload.title,/Added L2/);
});
