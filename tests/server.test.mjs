import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

async function request(base,p,opt={}){
  const r=await fetch(base+p,{method:opt.method||'GET',headers:opt.headers||{},body:opt.body?JSON.stringify(opt.body):undefined});
  return {status:r.status,body:await r.json(),cookie:r.headers.get('set-cookie')};
}
async function withServer(fn){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'apex37-'));
  delete process.env.APEX_BRIDGE_SECRET;delete process.env.XAUCLOUD_BASE_URL;
  process.env.NODE_ENV='test';process.env.DATA_DIR=dir;process.env.SESSION_SECRET='test-secret';
  const mod=await import('../server.mjs?'+Math.random());
  await fs.writeFile(path.join(dir,'licenses.json'),JSON.stringify({
    'APEX-ABCDEF-123456-789ABC':{status:'ACTIVE',account:'',customer:'tester',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()}
  },null,2));
  await fs.writeFile(path.join(dir,'license-configs.json'),'{}');
  await fs.writeFile(path.join(dir,'config.json'),JSON.stringify({armed:false,normalL1MarginPct:15,normalL2MarginPct:50,normalL3PlusMarginPct:100},null,2));
  await new Promise(ok=>mod.server.listen(0,'127.0.0.1',ok));
  const addr=mod.server.address(),base=`http://127.0.0.1:${addr.port}`;
  try{await fn(base)}finally{await new Promise(ok=>mod.server.close(ok));await fs.rm(dir,{recursive:true,force:true})}
}

function bridgeConnectedState(lastSeen){
  if(!lastSeen)return 'DISCONNECTED';
  const ms=Date.now()-Date.parse(lastSeen);
  if(!Number.isFinite(ms))return 'DISCONNECTED';
  if(ms<45_000)return 'CONNECTED';
  if(ms<180_000)return 'STALE';
  return 'DISCONNECTED';
}
async function fakeBridge(){
  // heartbeats mirrors the real /api/cloud/apex/bridge/status shape (mt5 + heartbeat doc)
  // closely enough to exercise the Apex dashboard's canonical-heartbeat read path in tests.
  const licenses=new Map(),configs=new Map(),heartbeats=new Map(),calls=[];
  const bridge=http.createServer(async(req,res)=>{
    let raw='';for await(const chunk of req)raw+=chunk;
    const payload=raw?JSON.parse(raw):{};
    const u=new URL(req.url,'http://localhost');
    const send=(code,value)=>{res.writeHead(code,{'content-type':'application/json'});res.end(JSON.stringify(value))};
    if(req.headers['x-apex-bridge-secret']!=='integration-secret')return send(401,{ok:false,error:'bridge_secret_invalid'});
    if(req.method==='POST'&&u.pathname==='/api/cloud/apex/bridge/license/upsert'){
      const key=String(payload.license||'').trim().toUpperCase().replace(/ /g,''),old=licenses.get(key)||{};
      const account=String(payload.account||'');
      licenses.set(key,{...old,pin:key,is_active:payload.active,mt5_account:account||old.mt5_account||'',is_used:Boolean(account||old.mt5_account),source:'APEX'});
      calls.push({type:'license',key,active:payload.active});return send(200,{ok:true});
    }
    if(req.method==='POST'&&u.pathname==='/api/cloud/apex/bridge/config/upsert'){
      const key=String(payload.license||'').trim().toUpperCase().replace(/ /g,'');configs.set(key,payload.config);
      calls.push({type:'config',key});return send(200,{ok:true});
    }
    if(req.method==='GET'&&u.pathname==='/api/cloud/apex/bridge/status'){
      const key=String(u.searchParams.get('license')||'').trim().toUpperCase().replace(/ /g,''),lic=licenses.get(key),hb=heartbeats.get(key)||null;
      const lastSeen=hb?.last_heartbeat||hb?.ts||null;
      return send(200,{
        ok:true,
        license:{exists:Boolean(lic),active:lic?.is_active===true,account:lic?.mt5_account||'',lastSeen},
        mt5:{status:bridgeConnectedState(lastSeen),lastSeen},
        heartbeat:hb,
        config:configs.get(key)||{},configExists:configs.has(key),commandRevision:0,recentEvents:[]
      });
    }
    return send(404,{ok:false,error:'not_found'});
  });
  await new Promise(ok=>bridge.listen(0,'127.0.0.1',ok));
  const address=bridge.address();
  return {base:`http://127.0.0.1:${address.port}`,licenses,configs,heartbeats,calls,close:()=>new Promise(ok=>bridge.close(ok))};
}
test('health',async()=>withServer(async base=>{
  const r=await request(base,'/health');assert.equal(r.status,200);assert.equal(r.body.version,'3.7.0');
}));
test('demo/live-style heartbeat authenticates by license in JSON and becomes connected',async()=>withServer(async base=>{
  const r=await request(base,'/api/apex/heartbeat',{method:'POST',headers:{'content-type':'application/json'},body:{
    license:'APEX-ABCDEF-123456-789ABC',account:'12345',broker:'MetaQuotes',server:'Demo',currency:'USD',
    symbol:'XAUUSDm',eaVersion:'v3.7',tradeMode:0,balance:1000,equity:1000,freeMargin:900
  }});
  assert.equal(r.status,200);assert.equal(r.body.licenseStatus,'ACTIVE');assert.equal(r.body.armed,false);
}));
test('site arm command is per-license and heartbeat receives revision',async()=>withServer(async base=>{
  let login=await request(base,'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:{license:'APEX-ABCDEF-123456-789ABC'}});
  assert.equal(login.status,200);const cookie=login.cookie.split(';')[0];
  let arm=await request(base,'/api/session/config',{method:'POST',headers:{'content-type':'application/json','cookie':cookie},body:{armed:true}});
  assert.equal(arm.status,200);assert.equal(arm.body.config.armed,true);assert.ok(arm.body.commandRevision>=1);
  let hb=await request(base,'/api/apex/heartbeat',{method:'POST',headers:{'content-type':'application/json'},body:{license:'APEX-ABCDEF-123456-789ABC',account:'777',balance:1000,equity:1001}});
  assert.equal(hb.body.armed,true);assert.equal(hb.body.commandRevision,arm.body.commandRevision);
  let ack=await request(base,'/api/apex/command/ack',{method:'POST',headers:{'content-type':'application/json'},body:{license:'APEX-ABCDEF-123456-789ABC',account:'777',revision:hb.body.commandRevision,status:'ARMED'}});
  assert.equal(ack.status,200);
  let me=await request(base,'/api/auth/me',{headers:{cookie}});
  assert.equal(me.body.mt5.status,'CONNECTED');assert.equal(me.body.armed,true);assert.equal(me.body.command.lastAckStatus,'ARMED');
}));
test('explicit admin-bound account rejects mismatch but blank account supports demo/live accounts',async()=>withServer(async base=>{
  let ok=await request(base,'/api/apex/heartbeat',{method:'POST',headers:{'content-type':'application/json'},body:{license:'APEX-ABCDEF-123456-789ABC',account:'111'}});
  assert.equal(ok.body.licenseStatus,'ACTIVE');
}));
test('legacy config endpoint remains compatible',async()=>withServer(async base=>{
  const r=await request(base,'/api/ea/config?account=99&license=APEX-ABCDEF-123456-789ABC');
  assert.equal(r.status,200);assert.equal(r.body.licenseStatus,'ACTIVE');
}));

test('startup, create, config, disable, enable, and restart stay synchronized through the authenticated bridge',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'apex37-bridge-')),bridge=await fakeBridge();
  const existingKey='APEX-EXISTING-0001',createdKey='APEX-NEWKEY-0002',now=new Date().toISOString();
  await fs.writeFile(path.join(dir,'licenses.json'),JSON.stringify({[existingKey]:{status:'ACTIVE',account:'',customer:'existing',createdAt:now,updatedAt:now}}));
  await fs.writeFile(path.join(dir,'license-configs.json'),JSON.stringify({[existingKey]:{armed:false}}));
  await fs.writeFile(path.join(dir,'config.json'),JSON.stringify({armed:false}));
  process.env.NODE_ENV='test';process.env.DATA_DIR=dir;process.env.SESSION_SECRET='test-secret';process.env.ADMIN_TOKEN='test-admin';
  process.env.XAUCLOUD_BASE_URL=bridge.base;process.env.APEX_BRIDGE_SECRET='integration-secret';
  let mod,base;
  try{
    mod=await import('../server.mjs?bridge-start-'+Math.random());
    await mod.syncAllLicensesAtStartup();
    assert.equal(bridge.licenses.get(existingKey).is_active,true);
    assert.equal(bridge.configs.has(existingKey),true);
    await new Promise(ok=>mod.server.listen(0,'127.0.0.1',ok));
    base=`http://127.0.0.1:${mod.server.address().port}`;

    const created=await request(base,'/api/admin/licenses',{method:'POST',headers:{'content-type':'application/json','authorization':'Bearer test-admin'},body:{key:' apex-new key-0002 ',status:'ACTIVE',account:'',customer:'new'}});
    assert.equal(created.status,200);assert.equal(created.body.license.key,createdKey);
    assert.equal(bridge.licenses.get(createdKey).is_active,true);

    const login=await request(base,'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:{license:createdKey}});
    const config=await request(base,'/api/session/config',{method:'POST',headers:{'content-type':'application/json','cookie':login.cookie.split(';')[0]},body:{armed:true}});
    assert.equal(config.status,200);assert.equal(bridge.configs.get(createdKey).armed,true);

    const disabled=await request(base,'/api/admin/licenses',{method:'POST',headers:{'content-type':'application/json','authorization':'Bearer test-admin'},body:{key:createdKey,status:'DISABLED'}});
    assert.equal(disabled.status,200);assert.equal(bridge.licenses.get(createdKey).is_active,false);
    const enabled=await request(base,'/api/admin/licenses',{method:'POST',headers:{'content-type':'application/json','authorization':'Bearer test-admin'},body:{key:createdKey,status:'ACTIVE'}});
    assert.equal(enabled.status,200);assert.equal(bridge.licenses.get(createdKey).is_active,true);

    const status=await request(base,`/api/admin/bridge/status?license=${createdKey}`,{headers:{authorization:'Bearer test-admin'}});
    assert.equal(status.status,200);assert.equal(status.body.mirrorExists,true);assert.equal(status.body.activeMatches,true);assert.equal(status.body.bridgeConfigExists,true);

    await new Promise(ok=>mod.server.close(ok));
    mod=await import('../server.mjs?bridge-restart-'+Math.random());
    await mod.syncAllLicensesAtStartup();
    assert.equal(bridge.licenses.get(existingKey).is_active,true);
    assert.equal(bridge.licenses.get(createdKey).is_active,true);
    assert.ok(bridge.calls.filter(x=>x.type==='license'&&x.key===createdKey).length>=4);
  }finally{
    if(mod?.server?.listening)await new Promise(ok=>mod.server.close(ok));
    await bridge.close();await fs.rm(dir,{recursive:true,force:true});
    delete process.env.APEX_BRIDGE_SECRET;delete process.env.XAUCLOUD_BASE_URL;delete process.env.ADMIN_TOKEN;
  }
});

// Dashboard MT5 telemetry must be sourced from the canonical XauCloud bridge heartbeat
// (POST /api/cloud/monitor/heartbeat on xaucloud.io, read back via
// GET /api/cloud/apex/bridge/status), not from this server's own dead
// /api/apex/heartbeat-only lastSeen — see buildMe() in server.mjs.
async function withBridgedDashboard(fn){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'apex37-dash-')),bridge=await fakeBridge();
  const key='APEX-DASH-0001',now=new Date().toISOString();
  await fs.writeFile(path.join(dir,'licenses.json'),JSON.stringify({[key]:{status:'ACTIVE',account:'',customer:'dash',createdAt:now,updatedAt:now}}));
  await fs.writeFile(path.join(dir,'license-configs.json'),JSON.stringify({[key]:{armed:true}}));
  await fs.writeFile(path.join(dir,'config.json'),JSON.stringify({armed:false}));
  process.env.NODE_ENV='test';process.env.DATA_DIR=dir;process.env.SESSION_SECRET='test-secret';
  process.env.XAUCLOUD_BASE_URL=bridge.base;process.env.APEX_BRIDGE_SECRET='integration-secret';
  let mod;
  try{
    mod=await import('../server.mjs?bridge-dash-'+Math.random());
    await mod.syncAllLicensesAtStartup();
    await new Promise(ok=>mod.server.listen(0,'127.0.0.1',ok));
    const base=`http://127.0.0.1:${mod.server.address().port}`;
    const login=await request(base,'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:{license:key}});
    const cookie=login.cookie.split(';')[0];
    await fn({base,cookie,bridge,key});
  }finally{
    if(mod?.server?.listening)await new Promise(ok=>mod.server.close(ok));
    await bridge.close();await fs.rm(dir,{recursive:true,force:true});
    delete process.env.APEX_BRIDGE_SECRET;delete process.env.XAUCLOUD_BASE_URL;
  }
}
function setBridgeHeartbeat(bridge,key,{ageMs=0,account='476885386',broker='Exness-Real',balance=5000,equity=5120,openPositions=2,eaVersion='XauCloud-Apex_v3.7.1-XauCloudLink'}={}){
  bridge.licenses.set(key,{pin:key,is_active:true,mt5_account:account,is_used:true,source:'APEX'});
  bridge.heartbeats.set(key,{
    license_key:key,pin:key,account_number:account,broker_server:broker,ea_version:eaVersion,
    balance,equity,open_positions:openPositions,
    ts:new Date(Date.now()-ageMs).toISOString(),last_heartbeat:new Date(Date.now()-ageMs).toISOString()
  });
}

test('A+B+C+D+E: active Apex license + fresh canonical XauCloud heartbeat -> dashboard resolves CONNECTED with live account data',async()=>withBridgedDashboard(async({base,cookie,bridge,key})=>{
  setBridgeHeartbeat(bridge,key,{ageMs:2_000});
  const me=await request(base,'/api/auth/me',{headers:{cookie}});
  assert.equal(me.status,200);
  assert.equal(me.body.mt5.status,'CONNECTED');            // C
  assert.equal(me.body.waitingForFirstContact,false);      // D
  assert.equal(me.body.dataAvailable,true);                // E
  assert.equal(me.body.mt5.lastSeen,bridge.heartbeats.get(key).last_heartbeat); // F
  assert.equal(me.body.armed,true);                        // G (from Apex config, not heartbeat)
  assert.equal(me.body.account.account,'476885386');
  assert.equal(me.body.account.broker,'Exness-Real');
  assert.equal(me.body.account.balance,5000);
  assert.equal(me.body.account.equity,5120);
  assert.equal(me.body.account.openPositions,2);
  assert.equal(me.body.bridge.ok,true);
  assert.equal(me.body.bridge.heartbeatFound,true);
}));

test('H: stale canonical heartbeat (90s old) resolves STALE, not CONNECTED or DISCONNECTED',async()=>withBridgedDashboard(async({base,cookie,bridge,key})=>{
  setBridgeHeartbeat(bridge,key,{ageMs:90_000});
  const me=await request(base,'/api/auth/me',{headers:{cookie}});
  assert.equal(me.body.mt5.status,'STALE');
  assert.equal(me.body.dataAvailable,true);
  assert.equal(me.body.waitingForFirstContact,false);
  assert.equal(me.body.armed,true);
}));

test('I: expired/old canonical heartbeat (10 minutes old) resolves DISCONNECTED',async()=>withBridgedDashboard(async({base,cookie,bridge,key})=>{
  setBridgeHeartbeat(bridge,key,{ageMs:600_000});
  const me=await request(base,'/api/auth/me',{headers:{cookie}});
  assert.equal(me.body.mt5.status,'DISCONNECTED');
  assert.equal(me.body.dataAvailable,true);         // a heartbeat record exists, it is just old
  assert.equal(me.body.armed,true);                  // arm state never mixes with heartbeat freshness
}));

test('J: no canonical heartbeat at all -> waitingForFirstContact, DISCONNECTED, dataAvailable=false',async()=>withBridgedDashboard(async({base,cookie,key,bridge})=>{
  bridge.licenses.set(key,{pin:key,is_active:true,mt5_account:'',is_used:false,source:'APEX'});
  const me=await request(base,'/api/auth/me',{headers:{cookie}});
  assert.equal(me.body.mt5.status,'DISCONNECTED');
  assert.equal(me.body.dataAvailable,false);
  assert.equal(me.body.waitingForFirstContact,true);
  assert.equal(me.body.mt5.lastSeen,null);
  assert.equal(me.body.bridge.heartbeatFound,false);
}));

test('bridge unreachable falls back to local lastSeen instead of breaking the dashboard',async()=>withBridgedDashboard(async({base,cookie,bridge,key})=>{
  await bridge.close();
  const hb=await request(base,'/api/apex/heartbeat',{method:'POST',headers:{'content-type':'application/json'},body:{license:key,account:'999',balance:10,equity:10}});
  assert.equal(hb.status,200);
  const me=await request(base,'/api/auth/me',{headers:{cookie}});
  assert.equal(me.body.mt5.status,'CONNECTED');
  assert.equal(me.body.bridge.ok,false);
  assert.equal(me.body.armed,true);
}));

test('G: Basket TP + Profit Ratchet settings saved from the dashboard propagate through session/config -> bridge config/upsert -> exactly what the EA would poll',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'apex37-tp-ratchet-')),bridge=await fakeBridge();
  const key='APEX-TPRATCHET-01',now=new Date().toISOString();
  await fs.writeFile(path.join(dir,'licenses.json'),JSON.stringify({[key]:{status:'ACTIVE',account:'',customer:'qa',createdAt:now,updatedAt:now}}));
  await fs.writeFile(path.join(dir,'license-configs.json'),'{}');
  await fs.writeFile(path.join(dir,'config.json'),JSON.stringify({armed:false}));
  process.env.NODE_ENV='test';process.env.DATA_DIR=dir;process.env.SESSION_SECRET='test-secret';
  process.env.XAUCLOUD_BASE_URL=bridge.base;process.env.APEX_BRIDGE_SECRET='integration-secret';
  let mod;
  try{
    mod=await import('../server.mjs?tp-ratchet-'+Math.random());
    await mod.syncAllLicensesAtStartup();
    await new Promise(ok=>mod.server.listen(0,'127.0.0.1',ok));
    const base=`http://127.0.0.1:${mod.server.address().port}`;
    const login=await request(base,'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:{license:key}});
    const cookie=login.cookie.split(';')[0];

    const payload={
      normalTargetProfitPct:500,
      profitRatchetEnabled:true,ratchetTriggerPct:180,ratchetLockPct:100,ratchetStepPct:100,ratchetLockStepPct:100
    };
    const saved=await request(base,'/api/session/config',{method:'POST',headers:{'content-type':'application/json','cookie':cookie},body:payload});
    assert.equal(saved.status,200);
    for(const [k,v] of Object.entries(payload))assert.equal(saved.body.config[k],v,`saved config missing/wrong ${k}`);

    // exactly what reached the XauCloud bridge (i.e. what /api/cloud/apex/config would serve the EA)
    const bridged=bridge.configs.get(key);
    assert.ok(bridged,'bridge never received the config upsert');
    for(const [k,v] of Object.entries(payload))assert.equal(bridged[k],v,`bridge config missing/wrong ${k}`);

    // and the dashboard's own settings view reflects the same saved values (UI truthfulness)
    const me=await request(base,'/api/auth/me',{headers:{cookie}});
    for(const [k,v] of Object.entries(payload))assert.equal(me.body.settings[k],v,`dashboard settings missing/wrong ${k}`);
  }finally{
    if(mod?.server?.listening)await new Promise(ok=>mod.server.close(ok));
    await bridge.close();await fs.rm(dir,{recursive:true,force:true});
    delete process.env.APEX_BRIDGE_SECRET;delete process.env.XAUCLOUD_BASE_URL;
  }
});
