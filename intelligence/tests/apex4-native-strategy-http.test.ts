import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('native strategy is license scoped, persisted and acknowledged by terminal wire',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'apex-native-mode-'));
 process.env.NODE_ENV='test';process.env.DATA_DIR=dir;process.env.APEX4_NATIVE_BASKET='1';
 delete process.env.APEX4_CANDIDATE;delete process.env.APEX_BRIDGE_SECRET;delete process.env.XAUCLOUD_BASE_URL;delete process.env.APEX4_KNOWLEDGE_FILE;
 const {server}=await import('../../server.mjs');
 const license='APEX-000000-001000-000000',account='123456';
 await fs.writeFile(path.join(dir,'licenses.json'),JSON.stringify({[license]:{status:'ACTIVE',account},'APEX-000000-001000-000001':{status:'ACTIVE'}}));
 await fs.writeFile(path.join(dir,'config.json'),JSON.stringify({armed:false}));
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{await new Promise<void>(resolve=>server.close(()=>resolve()));await fs.rm(dir,{recursive:true,force:true});});
 const address=server.address();const base='http://127.0.0.1:'+(typeof address==='object'?address?.port:0);
 const post=(route:string,payload:unknown,cookie='')=>fetch(base+route,{method:'POST',headers:{'content-type':'application/json',cookie},body:JSON.stringify(payload)});
 const login=await post('/api/auth/login',{license});assert.equal(login.status,200);
 const cookie=login.headers.get('set-cookie')?.split(';')[0]??'';
 const route='/api/session/native-strategy',terminal='/api/apex/v4/native-outlook';
 assert.equal((await post(route,{strategy:'OUTLOOK'})).status,401);
 assert.equal((await post(route,{strategy:'invalid'},cookie)).status,400);
 const b={license,account,environment:'DEMO',basketActive:false,side:0,anchor:0,target:0,positions:0,orders:0,strategy:'BOTH',terminalArmed:false};
 for(const strategy of ['OUTLOOK','PULLBACK','BOTH','OFF']){
  assert.equal((await post(route,{strategy},cookie)).status,200);
  assert.equal(await (await post(terminal,b)).text(),'NONE|NOT_ARMED|'+strategy);
  const me=await (await fetch(base+'/api/auth/me',{headers:{cookie}})).json();
  assert.equal(me.candidate.strategy,strategy);
  assert.equal(me.candidate.appliedStrategy,'BOTH');
 }
 const newLicense='APEX-000000-001000-000001';
 assert.equal(await (await post(terminal,{...b,license:newLicense,account:'654321'})).text(),'NONE|NOT_ARMED|BOTH');
 assert.equal((await post(terminal,{...b,license:newLicense,account:'wrong'})).status,403);
 const licenses=JSON.parse(await fs.readFile(path.join(dir,'licenses.json'),'utf8'));
 assert.equal(licenses[newLicense].account,'654321');
 assert.equal((await post(terminal,{...b,account:'wrong'})).status,403);
 assert.equal((await post(terminal,{...b,environment:'REAL'})).status,403);
 const {strategy,...old}=b;
 assert.equal(await (await post(terminal,old)).text(),'NONE|NOT_ARMED');
});
