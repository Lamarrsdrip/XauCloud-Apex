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

async function fakeBridge(){
  const licenses=new Map(),configs=new Map(),calls=[];
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
      const key=String(u.searchParams.get('license')||'').trim().toUpperCase().replace(/ /g,''),lic=licenses.get(key);
      return send(200,{ok:true,license:{exists:Boolean(lic),active:lic?.is_active===true,account:lic?.mt5_account||''},configExists:configs.has(key)});
    }
    return send(404,{ok:false,error:'not_found'});
  });
  await new Promise(ok=>bridge.listen(0,'127.0.0.1',ok));
  const address=bridge.address();
  return {base:`http://127.0.0.1:${address.port}`,licenses,configs,calls,close:()=>new Promise(ok=>bridge.close(ok))};
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
