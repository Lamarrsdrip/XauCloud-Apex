import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

async function request(base,p,opt={}){
  const r=await fetch(base+p,{method:opt.method||'GET',headers:opt.headers||{},body:opt.body?JSON.stringify(opt.body):undefined});
  return {status:r.status,body:await r.json(),cookie:r.headers.get('set-cookie')};
}
async function withServer(fn){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'apex37-'));
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
