import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('dashboard key routes authenticate, isolate licenses, reject CSRF, and never echo keys into EA/config/events',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'astra-http-'));
  process.env.NODE_ENV='test';process.env.DATA_DIR=dir;process.env.SESSION_SECRET='astra-test-session';
  delete process.env.APEX_BRIDGE_SECRET;delete process.env.XAUCLOUD_BASE_URL;
  const {server}=await import('../server.mjs?astra-http='+Math.random());
  const licenses={A:{status:'ACTIVE',account:'111'},B:{status:'ACTIVE',account:'222'},EXPIRED:{status:'ACTIVE',expiresAt:'2000-01-01'}};
  await fs.writeFile(path.join(dir,'licenses.json'),JSON.stringify(licenses));
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const base='http://127.0.0.1:'+server.address().port;
  async function req(route,{method='GET',cookie,body,headers={}}={}) {
    const r=await fetch(base+route,{method,headers:{...(body!==undefined?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{}),...headers},body:body===undefined?undefined:JSON.stringify(body)});
    return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};
  }
  try{
    assert.equal((await req('/api/session/astra')).status,401);
    const a=(await req('/api/auth/login',{method:'POST',body:{license:'A'}})).cookie;
    const b=(await req('/api/auth/login',{method:'POST',body:{license:'B'}})).cookie;
    const fake='sk-test-THIS_IS_A_SYNTHETIC_TEST_KEY_6789';
    const saved=await req('/api/session/astra',{method:'POST',cookie:a,body:{apiKey:fake,enabled:false,model:'gpt-6-astra'}});
    assert.equal(saved.status,200);assert.equal(saved.data.hasKey,true);assert.ok(!JSON.stringify(saved.data).includes(fake));
    assert.equal((await req('/api/session/astra',{cookie:b})).data.hasKey,false);
    assert.equal((await req('/api/session/astra',{method:'POST',cookie:a,body:{enabled:true},headers:{'sec-fetch-site':'cross-site'}})).status,403);
    assert.equal((await req('/api/apex/astra/status?license=A&account=111')).status,405);
    const ea=await req('/api/apex/astra/status',{method:'POST',body:{license:'A',account:'111'}});assert.equal(ea.data.status,'DISABLED');assert.ok(!JSON.stringify(ea.data).includes(fake));
    assert.equal((await req('/api/apex/astra/status',{method:'POST',body:{license:'A',account:'222'}})).status,403);
    assert.equal((await req('/api/apex/astra/context',{method:'POST',body:{license:'A',account:'111',snapshot:{}}})).data.status,'DISABLED');
    assert.equal((await req('/api/ea/config?license=A&account=111')).data.apiKey,undefined);
    assert.equal((await req('/api/auth/me',{cookie:a})).data.astra.maskedKey.endsWith('6789'),true);
    const events=await fs.readFile(path.join(dir,'events.ndjson'),'utf8').catch(()=> '');assert.ok(!events.includes(fake));
    assert.ok(!(await fs.readFile(path.join(dir,'astra-vault.json'),'utf8')).includes(fake));
    assert.equal((await req('/api/session/astra',{method:'DELETE',cookie:a,body:{}})).data.hasKey,false);
    assert.equal((await req('/api/auth/login',{method:'POST',body:{license:'EXPIRED'}})).status,401);
  }finally{await new Promise(r=>server.close(r));await fs.rm(dir,{force:true,recursive:true});}
});
