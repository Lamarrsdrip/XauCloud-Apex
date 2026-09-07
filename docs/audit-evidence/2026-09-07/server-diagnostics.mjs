import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import http from 'node:http';import assert from 'node:assert/strict';
const key='APEX-AUDIT-SYNTHETIC-ONLY',dir=await fs.mkdtemp(path.join(os.tmpdir(),'apex-audit-'));
const ts=new Date().toISOString();
const remote={ok:true,license:{exists:true,active:true,account:'111',lastSeen:ts},mt5:{status:'CONNECTED',lastSeen:ts},heartbeat:{account_number:'111',balance:100,equity:110,ea_version:'3.7.1',last_heartbeat:ts},recentEvents:[{license:key,account:'111',type:'CAMPAIGN_START',campaignId:'test',ts,direction:-1},{license:key,account:'111',type:'COMMAND_ACK',revision:1,ts}],config:{},commandRevision:1};
const bridge=http.createServer(async(req,res)=>{for await(const c of req){}res.setHeader('content-type','application/json');res.end(JSON.stringify(req.url.includes('/status')?remote:{ok:true}));});
await new Promise(ok=>bridge.listen(0,'127.0.0.1',ok));
Object.assign(process.env,{NODE_ENV:'test',DATA_DIR:dir,SESSION_SECRET:'audit-only-secret',ADMIN_TOKEN:'audit-only-admin',APEX_BRIDGE_SECRET:'audit-only-bridge',XAUCLOUD_BASE_URL:`http://127.0.0.1:${bridge.address().port}`});
const {server,clean}=await import('./XauCloud-Apex/server.mjs');
await fs.writeFile(path.join(dir,'licenses.json'),JSON.stringify({[key]:{status:'ACTIVE',account:'111',commandRevision:1,pendingCommand:'ARM'}}));
await new Promise(ok=>server.listen(0,'127.0.0.1',ok));const base=`http://127.0.0.1:${server.address().port}`;
const results=[];
try{
const login=await fetch(base+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({license:key})});assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0];
const me=await (await fetch(base+'/api/auth/me',{headers:{cookie}})).json();assert.equal(me.mt5.status,'CONNECTED');assert.equal(me.campaign,null);assert.equal(me.history.length,0);assert.equal(me.command.lastAckRevision,0);
results.push({test:'canonical_events_dashboard',remoteEvents:2,connected:me.mt5.status,campaign:me.campaign,history:me.history,lastAckRevision:me.command.lastAckRevision});
const unknown=clean({armed:'false',licenseStatus:'ACTIVE',ratchetTriggerPct:100,ratchetLockPct:500});assert.equal(unknown.armed,true);assert.equal(unknown.licenseStatus,'ACTIVE');results.push({test:'config_validation',stringFalseArms:unknown.armed,unknownProtocolKeyRetained:unknown.licenseStatus,trigger:unknown.ratchetTriggerPct,lock:unknown.ratchetLockPct});
const created=await fetch(base+'/api/admin/licenses',{method:'POST',headers:{authorization:'Bearer audit-only-admin','content-type':'application/json'},body:JSON.stringify({key:'APEX-AUDIT-PROFILE-ONLY',accountProfile:'UNLIMITED'})});const cb=await created.json();assert.equal(created.status,200);
const login2=await fetch(base+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({license:'APEX-AUDIT-PROFILE-ONLY'})});const me2=await(await fetch(base+'/api/auth/me',{headers:{cookie:login2.headers.get('set-cookie').split(';')[0]}})).json();assert.equal(me2.license.accountProfile,'UNLIMITED');assert.equal(me2.accountProfile,'NORMAL');results.push({test:'admin_profile_mismatch',licenseProfile:me2.license.accountProfile,executionConfigProfile:me2.accountProfile});
await fs.writeFile('work/server-diagnostics.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
}finally{await new Promise(ok=>server.close(ok));await new Promise(ok=>bridge.close(ok));await fs.rm(dir,{recursive:true,force:true});}
