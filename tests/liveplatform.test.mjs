import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

process.env.NODE_ENV='test';
delete process.env.APEX_BRIDGE_SECRET;
delete process.env.XAUCLOUD_BASE_URL;
process.env.DATA_DIR=await fs.mkdtemp(path.join(os.tmpdir(),'apex385-lp-'));
process.env.SESSION_SECRET='test-session-secret-at-least-32-chars!!';

const mod=await import('../server.mjs?liveplatform='+Date.now());
const {
  canonicalizeTimestamp,
  classifyConfigDelivery,
  licenseAllowsUnlimited,
  decorateCampaign,
  projectCampaign,
  nextManagerLease,
  assertProductionSecrets,
  secretProblems,
  numOrNull
}=mod;

test('SITE-007: unix-seconds emittedAt becomes ISO, not 1970',()=>{
  const iso=canonicalizeTimestamp(1725897600);
  assert.equal(iso,'2024-09-09T16:00:00.000Z');
  assert.notEqual(new Date(iso).getUTCFullYear(),1970);
  const fromString=canonicalizeTimestamp('1725897600');
  assert.equal(fromString,'2024-09-09T16:00:00.000Z');
  const ms=canonicalizeTimestamp(1725897600000);
  assert.equal(ms,'2024-09-09T16:00:00.000Z');
  const already=canonicalizeTimestamp('2026-09-09T12:00:00.000Z');
  assert.equal(already,'2026-09-09T12:00:00.000Z');
});

test('SITE-001: missing bridge is BRIDGE_NOT_CONFIGURED, never DELIVERED',()=>{
  assert.equal(classifyConfigDelivery(null,false).status,'BRIDGE_NOT_CONFIGURED');
  assert.equal(classifyConfigDelivery(null,true).status,'BRIDGE_NOT_CONFIGURED');
  assert.equal(classifyConfigDelivery({queued:true,reason:'timeout'},true).status,'QUEUED_FOR_BRIDGE');
  assert.equal(classifyConfigDelivery({ok:false,error:'boom'},true).status,'BRIDGE_FAILED');
  assert.equal(classifyConfigDelivery({ok:true},true).status,'BRIDGE_DELIVERED');
  assert.notEqual(classifyConfigDelivery(null,false).status,'DELIVERED');
});

test('SITE-009: UNLIMITED is a license entitlement, not a customer toggle',()=>{
  assert.equal(licenseAllowsUnlimited({licenseTier:'UNLIMITED'}),true);
  assert.equal(licenseAllowsUnlimited({licenseTier:'NORMAL',accountProfile:'UNLIMITED'}),false,
    'customer-era accountProfile on a NORMAL-tier license is not an entitlement');
  assert.equal(licenseAllowsUnlimited({accountProfile:'UNLIMITED'}),true,
    'historical admin licenses without licenseTier keep UNLIMITED');
  assert.equal(licenseAllowsUnlimited({licenseTier:'NORMAL'}),false);
  assert.equal(licenseAllowsUnlimited({unlimitedEntitled:true,licenseTier:'NORMAL'}),true);
  assert.equal(licenseAllowsUnlimited(null),false);
});

test('SITE-002: secret helper refuses published/default/short secrets and never prints them; boot still listens',()=>{
  assert.throws(()=>assertProductionSecrets({
    NODE_ENV:'production',ADMIN_TOKEN:'change-me-admin',SESSION_SECRET:'change-me-session-secret'
  }),/INSECURE_PRODUCTION_CONFIGURATION/);
  const problems=secretProblems({NODE_ENV:'production'});
  assert.ok(problems.includes('ADMIN_TOKEN_MISSING'));
  assert.ok(problems.includes('SESSION_SECRET_MISSING'));
  const short=secretProblems({ADMIN_TOKEN:'short',SESSION_SECRET:'also-short',XAUCLOUD_BASE_URL:'http://xaucloud.io'});
  assert.ok(short.includes('ADMIN_TOKEN_TOO_SHORT_MIN_24'));
  assert.ok(short.includes('SESSION_SECRET_TOO_SHORT_MIN_32'));
  assert.ok(short.includes('XAUCLOUD_BASE_URL_NOT_HTTPS'));
  try{
    assertProductionSecrets({NODE_ENV:'production',ADMIN_TOKEN:'change-me-admin',SESSION_SECRET:'x'.repeat(32)});
  }catch(e){
    assert.doesNotMatch(String(e.message),/change-me-admin/);
    assert.doesNotMatch(String(e.message),/x{10,}/);
  }
  assert.deepEqual(assertProductionSecrets({NODE_ENV:'test',ADMIN_TOKEN:'change-me-admin'}),[]);
  assert.deepEqual(assertProductionSecrets({
    NODE_ENV:'production',
    ADMIN_TOKEN:'A'.repeat(24),
    SESSION_SECRET:'B'.repeat(32),
    XAUCLOUD_BASE_URL:'https://xaucloud.io'
  }),[]);
});

test('SITE-006: campaign projection uses real fields and does not coerce missing to 0',()=>{
  const events=[{
    type:'CAMPAIGN_START',ts:'2026-09-09T12:00:00.000Z',direction:-1,campaignId:'c1',
    layers:1,entryPrice:4400.5,targetEquity:2000,cycleStart:1000,setupId:'s1'
  },{
    type:'LAYER_OPEN',ts:'2026-09-09T12:01:00.000Z',layer:2,basketVolume:0.42
  }];
  const projected=projectCampaign(events);
  const decorated=decorateCampaign(projected,{equity:1080,balance:1000,layers:2,basket_volume:0.42},'2026-09-09T12:02:00.000Z');
  assert.equal(decorated.direction,'SELL');
  assert.equal(decorated.campaignId,'c1');
  assert.equal(decorated.startEquity,1000);
  assert.equal(decorated.currentEquity,1080);
  assert.equal(decorated.floatingPL,80);
  assert.equal(decorated.layers,2);
  assert.equal(decorated.totalVolume,0.42);
  assert.equal(decorated.firstEntry,4400.5);
  assert.ok(decorated.progressPct>0);
  const unknown=decorateCampaign({campaignId:'c2',state:'ACTIVE',direction:'BUY'},{},null);
  assert.equal(unknown.currentEquity,null);
  assert.equal(unknown.floatingPL,null);
  assert.equal(unknown.progressPct,null);
  assert.equal(unknown.totalVolume,null);
  assert.equal(numOrNull(undefined),null);
  assert.equal(numOrNull(''),null);
  assert.equal(numOrNull('nope'),null);
});

test('SITE-008: inSync uses command revision, never hash equality',async()=>{
  const server=await fs.readFile(new URL('../server.mjs',import.meta.url),'utf8');
  assert.match(server,/inSync:appliedRevision>0\?appliedRevision===desiredRevision:null/);
  assert.doesNotMatch(server,/inSync:\s*appliedHash\s*===\s*desiredHash/);
});

test('LIVE-018: manager lease refresh / hold / takeover-after-expiry',()=>{
  const now=1_700_000_000_000;
  const a={instanceId:'VPS',account:'1',symbol:'XAUUSDm',magic:1};
  const grant=nextManagerLease(null,a,now);
  assert.equal(grant.reason,'GRANT');
  assert.equal(grant.lease.instanceId,'VPS');
  const refresh=nextManagerLease(grant.lease,a,now+10_000);
  assert.equal(refresh.reason,'REFRESH');
  const mac={instanceId:'MAC',account:'1',symbol:'XAUUSDm',magic:1};
  const held=nextManagerLease(refresh.lease,mac,now+11_000);
  assert.equal(held.reason,'HELD_BY_OTHER');
  assert.equal(held.lease.instanceId,'VPS');
  const expired={...refresh.lease,expiresAt:now+12_000};
  const take=nextManagerLease(expired,mac,now+12_001);
  assert.equal(take.reason,'TAKEOVER_AFTER_EXPIRY');
  assert.equal(take.lease.instanceId,'MAC');
  assert.equal(take.lease.generation,grant.lease.generation+1);
});

async function request(base,p,opt={}){
  const r=await fetch(base+p,{method:opt.method||'GET',headers:opt.headers||{},body:opt.body?JSON.stringify(opt.body):undefined});
  return {status:r.status,body:await r.json(),cookie:r.headers.get('set-cookie')};
}

test('SITE-001+SITE-009 HTTP: arm without bridge is not DELIVERED; NORMAL cannot escalate',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'apex385-http-'));
  process.env.NODE_ENV='test';
  process.env.DATA_DIR=dir;
  process.env.SESSION_SECRET='test-session-secret-at-least-32-chars!!';
  delete process.env.APEX_BRIDGE_SECRET;
  delete process.env.XAUCLOUD_BASE_URL;
  const httpMod=await import('../server.mjs?lp-http='+Date.now());
  await fs.writeFile(path.join(dir,'licenses.json'),JSON.stringify({
    'APEX-ABCDEF-123456-789ABC':{status:'ACTIVE',account:'',customer:'tester',licenseTier:'NORMAL',accountProfile:'NORMAL',
      createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()}
  },null,2));
  await fs.writeFile(path.join(dir,'license-configs.json'),'{}');
  await fs.writeFile(path.join(dir,'config.json'),JSON.stringify({armed:false},null,2));
  await new Promise(ok=>httpMod.server.listen(0,'127.0.0.1',ok));
  const addr=httpMod.server.address(),base=`http://127.0.0.1:${addr.port}`;
  try{
    const login=await request(base,'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:{license:'APEX-ABCDEF-123456-789ABC'}});
    assert.equal(login.status,200);
    const cookie=login.cookie.split(';')[0];
    const arm=await request(base,'/api/session/config',{method:'POST',headers:{'content-type':'application/json','cookie':cookie},body:{armed:true}});
    assert.equal(arm.status,200);
    assert.notEqual(arm.body.delivery,'DELIVERED');
    assert.equal(arm.body.delivery,'BRIDGE_NOT_CONFIGURED');
    const escalate=await request(base,'/api/session/config',{method:'POST',headers:{'content-type':'application/json','cookie':cookie},body:{accountProfile:'UNLIMITED'}});
    assert.equal(escalate.status,403);
    assert.equal(escalate.body.error,'UNLIMITED_NOT_ENTITLED');
    const health=await request(base,'/health');
    assert.equal(health.body.version,'3.8.7');
    assert.equal(health.body.webRequestOrigin,'https://xaucloud.io');
    assert.equal(health.body.eaVersion,'XauCloud-Apex_v3.8.7-UnifiedMarginLadder');
  }finally{
    await new Promise(ok=>httpMod.server.close(ok));
    await fs.rm(dir,{recursive:true,force:true});
  }
});

test('dashboard HTML never tells the customer to allow apex.xaucloud.io WebRequest',async()=>{
  const ui=await fs.readFile(new URL('../public/index.html',import.meta.url),'utf8');
  assert.match(ui,/allow WebRequest for <code>https:\/\/xaucloud\.io<\/code>/);
  assert.doesNotMatch(ui,/allow WebRequest for <code>https:\/\/apex\.xaucloud\.io<\/code>/);
  assert.match(ui,/Arm queued — waiting for EA/);
  assert.match(ui,/UNLIMITED is an entitlement/);
  assert.doesNotMatch(ui,/id="f-layerMultiplier"/);
});
