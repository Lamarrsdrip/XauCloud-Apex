import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {clean,learn} from '../server.mjs';

test('defaults match the current NORMAL plan: 30% base margin, 2x layering, +100% target',()=>{
 const c=JSON.parse(fs.readFileSync(new URL('../data/config.json',import.meta.url)));
 assert.equal(c.baseMarginPct,30);
 assert.equal(c.layerMultiplier,2);
 assert.equal(c.maxLayers,0);
 assert.equal(c.cooldownMinutes,0);
 assert.equal(c.normalTargetProfitPct,100);
 assert.equal(c.accountProfile,'NORMAL');
});

test('clean() bounds and defaults untrusted input',()=>{
 const c=clean({baseMarginPct:'not a number',layerMultiplier:999,maxLayers:-5,targetMode:'BOGUS'});
 assert.equal(c.baseMarginPct,30);
 assert.equal(c.layerMultiplier,10);
 assert.equal(c.maxLayers,0);
 assert.equal(c.targetMode,'MULTIPLIER');
});

test('clean() defaults normalTargetProfitPct to +100% for NORMAL accounts, not the old +1000%',()=>{
 const c=clean({});
 assert.equal(c.normalTargetProfitPct,100);
 assert.equal(c.accountProfile,'NORMAL');
});

test('clean() strips obsolete removed fields (normalAccountMaxMultiplier, enableInvalidationExit, invalidationGivebackPct) instead of persisting them',()=>{
 const c=clean({normalAccountMaxMultiplier:3,enableInvalidationExit:true,invalidationGivebackPct:.5,baseMarginPct:30});
 assert.equal(c.normalAccountMaxMultiplier,undefined);
 assert.equal(c.enableInvalidationExit,undefined);
 assert.equal(c.invalidationGivebackPct,undefined);
 assert.equal(Object.keys(c).includes('normalAccountMaxMultiplier'),false);
});

test('clean() validates accountProfile is NORMAL or UNLIMITED only',()=>{
 assert.equal(clean({accountProfile:'UNLIMITED'}).accountProfile,'UNLIMITED');
 assert.equal(clean({accountProfile:'BOGUS'}).accountProfile,'NORMAL');
});

const cfg=clean({learningEnabled:true,learningMinCampaigns:8,learningMaxScoreAdjustment:5});

function campaign(id,{outcome,impulseMult,wickRatio,m3,m5}){
 return [
  {type:'CAMPAIGN_START',campaignId:id,signature:'SELL_UPSIDE_LIQUIDITY_EXHAUST',impulseMult,wickRatio,m3,m5},
  {type:'CAMPAIGN_END',campaignId:id,signature:'SELL_UPSIDE_LIQUIDITY_EXHAUST',outcome,mfe:100,mae:-20,layers:3},
 ];
}

test('learn() stays OBSERVATION_ONLY below the minimum sample and applies no score adjustment',()=>{
 const events=[...campaign('c1',{outcome:'TARGET_HIT',impulseMult:2.5,wickRatio:3.5,m3:true,m5:true})];
 const model=learn(events,cfg);
 assert.equal(model.authority,'OBSERVATION_ONLY');
 assert.equal(model.entryScoreAdjustment,0);
 assert.equal(model.addScoreAdjustment,0);
 assert.equal(model.completedCampaigns,1);
});

test('learn() switches to BOUNDED_ADAPTIVE only once the minimum sample is met',()=>{
 const events=[];
 for(let i=0;i<8;i++)events.push(...campaign('c'+i,{outcome:i<5?'TARGET_HIT':'POSITIONS_GONE',impulseMult:2.5,wickRatio:3.5,m3:true,m5:true}));
 const model=learn(events,cfg);
 assert.equal(model.completedCampaigns,8);
 assert.equal(model.targetHits,5);
 assert.equal(model.authority,'BOUNDED_ADAPTIVE');
 assert.ok(Math.abs(model.entryScoreAdjustment)<=cfg.learningMaxScoreAdjustment);
});

test('learn() distinguishes PROFIT_FLOOR_HIT (protected exit) from a genuine broker/margin failure — it is not treated as a loss',()=>{
 const events=[
  ...campaign('p1',{outcome:'PROFIT_FLOOR_HIT',impulseMult:2,wickRatio:2,m3:true,m5:true}),
  ...campaign('f1',{outcome:'POSITIONS_GONE',impulseMult:2,wickRatio:2,m3:true,m5:true}),
 ];
 const model=learn(events,cfg);
 assert.equal(model.completedCampaigns,2);
 assert.equal(model.protectedExits,1);
 assert.equal(model.genuineFailures,1);
 assert.equal(model.targetHits,0);
 // a protected exit counts toward the positive outcome rate, a genuine failure does not
 assert.equal(model.positiveOutcomeRate,0.5);
});

test('learn() joins CAMPAIGN_START features to CAMPAIGN_END outcome by campaignId, bucketed and sample-gated',()=>{
 const events=[];
 // 6 high-impulse wins -> enough samples to report a real positiveRate for the high bucket
 for(let i=0;i<6;i++)events.push(...campaign('hi'+i,{outcome:'TARGET_HIT',impulseMult:2.5,wickRatio:3.5,m3:true,m5:true}));
 // 2 low-impulse losses -> below FEATURE_MIN_SAMPLE, must not report a confident rate
 for(let i=0;i<2;i++)events.push(...campaign('lo'+i,{outcome:'POSITIONS_GONE',impulseMult:0.5,wickRatio:1.0,m3:false,m5:false}));
 const model=learn(events,cfg);
 const hi=model.featureInsights.impulseMult['impulse_high(>=2x_ATR)'];
 assert.equal(hi.campaigns,6);
 assert.equal(hi.positiveRate,1);
 const lo=model.featureInsights.impulseMult['impulse_low(<1x_ATR)'];
 assert.equal(lo.campaigns,2);
 assert.equal(lo.positiveRate,null);
 assert.match(lo.note,/insufficient_sample/);
});

test('learn() ignores a CAMPAIGN_END with no matching CAMPAIGN_START for feature bucketing but still counts it in the aggregate rate',()=>{
 const orphanEnd=[{type:'CAMPAIGN_END',campaignId:'no-start-here',signature:'X',outcome:'TARGET_HIT',mfe:1,mae:-1,layers:1}];
 const model=learn(orphanEnd,cfg);
 assert.equal(model.completedCampaigns,1);
 assert.deepEqual(model.featureInsights,{});
});

// ---------- live HTTP tests: auth, licensing, session, EA enforcement ----------
import {server} from '../server.mjs';
import http from 'node:http';

async function withServer(fn){
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const port=server.address().port;
 try{return await fn(`http://127.0.0.1:${port}`)}
 finally{await new Promise(r=>server.close(r))}
}

function req(base,path,{method='GET',headers={},body,cookie}={}){
 return new Promise((resolve,reject)=>{
  const h={...headers};
  if(cookie)h.cookie=cookie;
  let data;
  if(body!==undefined){data=JSON.stringify(body);h['content-type']='application/json'}
  const r=http.request(base+path,{method,headers:h},res=>{
   let chunks='';
   res.on('data',c=>chunks+=c);
   res.on('end',()=>{
    let parsed;try{parsed=JSON.parse(chunks)}catch{parsed=chunks}
    resolve({status:res.statusCode,headers:res.headers,body:parsed});
   });
  });
  r.on('error',reject);
  if(data)r.write(data);
  r.end();
 });
}

test('health endpoint is public and unauthenticated',async()=>{
 await withServer(async base=>{
  const r=await req(base,'/health');
  assert.equal(r.status,200);
  assert.equal(r.body.ok,true);
 });
});

test('admin endpoints reject requests without ADMIN_TOKEN',async()=>{
 await withServer(async base=>{
  const r=await req(base,'/api/admin/status');
  assert.equal(r.status,401);
 });
});

test('EA endpoints reject requests without EA_TOKEN',async()=>{
 await withServer(async base=>{
  const r=await req(base,'/api/ea/config?account=1');
  assert.equal(r.status,401);
 });
});

test('license login rejects an unknown license key',async()=>{
 await withServer(async base=>{
  const r=await req(base,'/api/auth/login',{method:'POST',body:{license:'APEX-DOES-NOT-EXIST'}});
  assert.equal(r.status,401);
  assert.equal(r.body.error,'LICENSE_NOT_FOUND');
 });
});

test('license login requires a license value',async()=>{
 await withServer(async base=>{
  const r=await req(base,'/api/auth/login',{method:'POST',body:{}});
  assert.equal(r.status,400);
 });
});

test('/api/auth/me rejects requests with no session cookie',async()=>{
 await withServer(async base=>{
  const r=await req(base,'/api/auth/me');
  assert.equal(r.status,401);
 });
});

test('full license lifecycle: admin issues a license, user logs in, session reads it back, and an unbound account auto-binds then rejects a mismatched account',async()=>{
 await withServer(async base=>{
  const ADMIN_TOKEN=process.env.ADMIN_TOKEN||'change-me-admin';
  const EA_TOKEN=process.env.EA_TOKEN||'change-me-ea';

  const create=await req(base,'/api/admin/licenses',{method:'POST',headers:{authorization:`Bearer ${ADMIN_TOKEN}`},body:{accountProfile:'NORMAL'}});
  assert.equal(create.status,200);
  const key=create.body.license.key;
  assert.match(key,/^APEX-/);
  assert.equal(create.body.license.status,'ACTIVE');
  assert.equal(create.body.license.account,'');

  const login=await req(base,'/api/auth/login',{method:'POST',body:{license:key}});
  assert.equal(login.status,200);
  const setCookie=login.headers['set-cookie'][0];
  assert.match(setCookie,/HttpOnly/);
  assert.match(setCookie,/Secure/);
  assert.match(setCookie,/SameSite=Strict/);
  const cookie=setCookie.split(';')[0];

  const meBeforeContact=await req(base,'/api/auth/me',{cookie});
  assert.equal(meBeforeContact.status,200);
  assert.equal(meBeforeContact.body.dataAvailable,false);
  assert.equal(meBeforeContact.body.waitingForFirstContact,true);

  // EA contacts with this license and account 111 -> auto-binds
  const eaConfig=await req(base,`/api/ea/config?account=111&license=${key}`,{headers:{authorization:`Bearer ${EA_TOKEN}`}});
  assert.equal(eaConfig.status,200);
  assert.equal(eaConfig.body.licenseStatus,'ACTIVE');

  const licList=await req(base,'/api/admin/licenses',{headers:{authorization:`Bearer ${ADMIN_TOKEN}`}});
  const bound=licList.body.licenses.find(l=>l.key===key);
  assert.equal(bound.account,'111');

  // a different account with the same license is now a mismatch and cannot arm
  const mismatch=await req(base,`/api/ea/config?account=999&license=${key}`,{headers:{authorization:`Bearer ${EA_TOKEN}`}});
  assert.equal(mismatch.status,200);
  assert.equal(mismatch.body.licenseStatus,'ACCOUNT_MISMATCH');
  assert.equal(mismatch.body.armed,false);
 });
});

test('EA cannot arm with a disabled license even if the stored config has armed:true',async()=>{
 await withServer(async base=>{
  const ADMIN_TOKEN=process.env.ADMIN_TOKEN||'change-me-admin';
  const EA_TOKEN=process.env.EA_TOKEN||'change-me-ea';
  const create=await req(base,'/api/admin/licenses',{method:'POST',headers:{authorization:`Bearer ${ADMIN_TOKEN}`},body:{status:'DISABLED'}});
  const key=create.body.license.key;
  const eaConfig=await req(base,`/api/ea/config?account=222&license=${key}`,{headers:{authorization:`Bearer ${EA_TOKEN}`}});
  assert.equal(eaConfig.status,200);
  assert.equal(eaConfig.body.licenseStatus,'LICENSE_DISABLED');
  assert.equal(eaConfig.body.armed,false);
 });
});

test('EA config poll with no license param at all is treated as LICENSE_NOT_FOUND, not a crash',async()=>{
 await withServer(async base=>{
  const EA_TOKEN=process.env.EA_TOKEN||'change-me-ea';
  const eaConfig=await req(base,'/api/ea/config?account=333',{headers:{authorization:`Bearer ${EA_TOKEN}`}});
  assert.equal(eaConfig.status,200);
  assert.equal(eaConfig.body.licenseStatus,'LICENSE_NOT_FOUND');
  assert.equal(eaConfig.body.armed,false);
 });
});

test('malformed JSON body returns 400, not a 500 crash',async()=>{
 await withServer(async base=>{
  const ADMIN_TOKEN=process.env.ADMIN_TOKEN||'change-me-admin';
  const r=await new Promise((resolve,reject)=>{
   const rq=http.request(base+'/api/admin/config',{method:'POST',headers:{authorization:`Bearer ${ADMIN_TOKEN}`,'content-type':'application/json'}},res=>{
    let c='';res.on('data',d=>c+=d);res.on('end',()=>resolve({status:res.statusCode}));
   });
   rq.on('error',reject);
   rq.write('{not valid json');
   rq.end();
  });
  assert.equal(r.status,400);
 });
});

test('logout clears the session cookie',async()=>{
 await withServer(async base=>{
  const r=await req(base,'/api/auth/logout',{method:'POST'});
  assert.equal(r.status,200);
  assert.match(r.headers['set-cookie'][0],/Max-Age=0/);
 });
});
