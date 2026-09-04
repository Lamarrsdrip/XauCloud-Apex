import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {clean,learn,classifyMt5} from '../server.mjs';

test('classifyMt5: no heartbeat ever recorded is DISCONNECTED',()=>{
 assert.equal(classifyMt5(null),'DISCONNECTED');
 assert.equal(classifyMt5(undefined),'DISCONNECTED');
});
test('classifyMt5: <45s old heartbeat is CONNECTED (matches the EA\'s ~8s config-poll cadence)',()=>{
 assert.equal(classifyMt5(new Date(Date.now()-1000).toISOString()),'CONNECTED');
 assert.equal(classifyMt5(new Date(Date.now()-44000).toISOString()),'CONNECTED');
});
test('classifyMt5: 45-300s old heartbeat is STALE',()=>{
 assert.equal(classifyMt5(new Date(Date.now()-46000).toISOString()),'STALE');
 assert.equal(classifyMt5(new Date(Date.now()-299000).toISOString()),'STALE');
});
test('classifyMt5: >300s old heartbeat is DISCONNECTED',()=>{
 assert.equal(classifyMt5(new Date(Date.now()-301000).toISOString()),'DISCONNECTED');
});

test('defaults match the v3.5 NORMAL plan: 15/50/100 margin ladder, hard TP disabled, $30 fixed SL, 180% ratchet trigger, +50% break-even, 40% recovery-to-entry',()=>{
 const c=JSON.parse(fs.readFileSync(new URL('../data/config.json',import.meta.url)));
 assert.equal(c.baseMarginPct,100);
 assert.equal(c.layerMultiplier,2);
 assert.equal(c.maxLayers,0);
 assert.equal(c.cooldownMinutes,0);
 assert.equal(c.normalTargetProfitPct,0);
 assert.equal(c.accountProfile,'NORMAL');
 assert.equal(c.normalL1MarginPct,15);
 assert.equal(c.normalL2MarginPct,50);
 assert.equal(c.normalL3PlusMarginPct,100);
 assert.equal(c.normalFixedSLGoldMove,30);
 assert.equal(c.profitRatchetEnabled,true);
 assert.equal(c.ratchetTriggerPct,180);
 assert.equal(c.ratchetLockPct,100);
 assert.equal(c.ratchetStepPct,100);
 assert.equal(c.ratchetLockStepPct,100);
 assert.equal(c.masterBreakEvenEnabled,true);
 assert.equal(c.masterBreakEvenTriggerPct,50);
 assert.equal(c.recoveryExitEnabled,true);
 assert.equal(c.recoveryExitArmPctOfSL,40);
});

test('clean() bounds and defaults untrusted input',()=>{
 const c=clean({baseMarginPct:'not a number',layerMultiplier:999,maxLayers:-5,targetMode:'BOGUS'});
 assert.equal(c.baseMarginPct,100);
 assert.equal(c.layerMultiplier,10);
 assert.equal(c.maxLayers,0);
 assert.equal(c.targetMode,'MULTIPLIER');
});

test('clean() defaults normalTargetProfitPct to 0 (hard TP disabled) so the percentage ratchet is the intended default exit',()=>{
 const c=clean({});
 assert.equal(c.normalTargetProfitPct,0);
 assert.equal(c.accountProfile,'NORMAL');
});

test('clean() allows 0 as a valid normalTargetProfitPct (does not clamp it away as if invalid)',()=>{
 assert.equal(clean({normalTargetProfitPct:0}).normalTargetProfitPct,0);
});

test('clean() bounds margin to (0,100]: in-range values pass through, out-of-range clamp to the nearest bound, and only non-finite input falls back to the default',()=>{
 assert.equal(clean({baseMarginPct:150}).baseMarginPct,100);
 assert.equal(clean({baseMarginPct:-5}).baseMarginPct,.01);
 assert.equal(clean({baseMarginPct:'abc'}).baseMarginPct,100);
 assert.equal(clean({baseMarginPct:Infinity}).baseMarginPct,100);
 assert.equal(clean({baseMarginPct:NaN}).baseMarginPct,100);
});

test('clean() fixed SL: 0 is a valid disabled value, negative clamps up to 0 (never goes negative), non-finite falls back to the v3.4 default of 30',()=>{
 assert.equal(clean({normalFixedSLGoldMove:0}).normalFixedSLGoldMove,0);
 assert.equal(clean({normalFixedSLGoldMove:25}).normalFixedSLGoldMove,25);
 assert.equal(clean({normalFixedSLGoldMove:-5}).normalFixedSLGoldMove,0);
 assert.equal(clean({normalFixedSLGoldMove:'abc'}).normalFixedSLGoldMove,30);
});

test('clean() ratchet fields: trigger/step are held just above 0 (never 0 or negative), lock/lockStep allow exactly 0, non-finite falls back to the v3.4 default (trigger=180)',()=>{
 assert.equal(clean({ratchetTriggerPct:0}).ratchetTriggerPct,.01);
 assert.equal(clean({ratchetTriggerPct:-10}).ratchetTriggerPct,.01);
 assert.equal(clean({ratchetTriggerPct:'abc'}).ratchetTriggerPct,180);
 assert.equal(clean({ratchetStepPct:0}).ratchetStepPct,.01);
 assert.equal(clean({ratchetLockPct:0}).ratchetLockPct,0);
 assert.equal(clean({ratchetLockStepPct:0}).ratchetLockStepPct,0);
 assert.equal(clean({profitRatchetEnabled:false}).profitRatchetEnabled,false);
});

test('clean() three-tier NORMAL margin ladder: bounds each tier to (0,100], non-finite falls back to its own v3.4 default (15/50/100)',()=>{
 assert.equal(clean({normalL1MarginPct:150}).normalL1MarginPct,100);
 assert.equal(clean({normalL1MarginPct:-5}).normalL1MarginPct,.01);
 assert.equal(clean({normalL1MarginPct:'abc'}).normalL1MarginPct,15);
 assert.equal(clean({normalL2MarginPct:'abc'}).normalL2MarginPct,50);
 assert.equal(clean({normalL3PlusMarginPct:'abc'}).normalL3PlusMarginPct,100);
 assert.equal(clean({normalL2MarginPct:250}).normalL2MarginPct,100);
});

test('clean() master break-even: trigger held above 0, non-finite falls back to default 50; enabled defaults true and only an explicit false disables it',()=>{
 assert.equal(clean({masterBreakEvenTriggerPct:0}).masterBreakEvenTriggerPct,.01);
 assert.equal(clean({masterBreakEvenTriggerPct:-10}).masterBreakEvenTriggerPct,.01);
 assert.equal(clean({masterBreakEvenTriggerPct:'abc'}).masterBreakEvenTriggerPct,50);
 assert.equal(clean({}).masterBreakEvenEnabled,true);
 assert.equal(clean({masterBreakEvenEnabled:false}).masterBreakEvenEnabled,false);
 assert.equal(clean({masterBreakEvenEnabled:'nonsense'}).masterBreakEvenEnabled,true);
});

test('clean() recovery-to-entry exit: threshold held above 0, non-finite falls back to default 40; enabled defaults true and only an explicit false disables it',()=>{
 assert.equal(clean({recoveryExitArmPctOfSL:0}).recoveryExitArmPctOfSL,.01);
 assert.equal(clean({recoveryExitArmPctOfSL:-10}).recoveryExitArmPctOfSL,.01);
 assert.equal(clean({recoveryExitArmPctOfSL:'abc'}).recoveryExitArmPctOfSL,40);
 assert.equal(clean({}).recoveryExitEnabled,true);
 assert.equal(clean({recoveryExitEnabled:false}).recoveryExitEnabled,false);
 assert.equal(clean({recoveryExitEnabled:'nonsense'}).recoveryExitEnabled,true);
});

test('clean() strips obsolete removed fields (normalAccountMaxMultiplier, enableInvalidationExit, invalidationGivebackPct, normalProfitFloorEnabled) instead of persisting them',()=>{
 const c=clean({normalAccountMaxMultiplier:3,enableInvalidationExit:true,invalidationGivebackPct:.5,normalProfitFloorEnabled:true,baseMarginPct:100});
 assert.equal(c.normalAccountMaxMultiplier,undefined);
 assert.equal(c.enableInvalidationExit,undefined);
 assert.equal(c.invalidationGivebackPct,undefined);
 assert.equal(c.normalProfitFloorEnabled,undefined);
 assert.equal(Object.keys(c).includes('normalAccountMaxMultiplier'),false);
 assert.equal(Object.keys(c).includes('normalProfitFloorEnabled'),false);
});

test('clean() strips the old money-based ratchet fields from the wrong v3.0.0 build — must never reach the current config schema',()=>{
 const c=clean({ratchetTriggerMoney:200,ratchetLockMoney:100,ratchetStepMoney:100,ratchetLockStepMoney:100});
 assert.equal(Object.keys(c).includes('ratchetTriggerMoney'),false);
 assert.equal(Object.keys(c).includes('ratchetLockMoney'),false);
 assert.equal(Object.keys(c).includes('ratchetStepMoney'),false);
 assert.equal(Object.keys(c).includes('ratchetLockStepMoney'),false);
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
  // critical fix: settings (effective default values) must be visible even before the EA has ever connected,
  // decoupled from dataAvailable/live telemetry — a user must be able to review/adjust defaults pre-EA-contact.
  assert.ok(meBeforeContact.body.settings,'settings must be present before first EA contact');
  assert.equal(meBeforeContact.body.settings.normalL1MarginPct,15);
  assert.equal(meBeforeContact.body.settings.normalL2MarginPct,50);
  assert.equal(meBeforeContact.body.settings.normalL3PlusMarginPct,100);
  assert.equal(meBeforeContact.body.settings.normalFixedSLGoldMove,30);
  assert.equal(meBeforeContact.body.settings.ratchetTriggerPct,180);
  assert.equal(meBeforeContact.body.settings.masterBreakEvenEnabled,true);
  assert.equal(meBeforeContact.body.settings.masterBreakEvenTriggerPct,50);
  assert.equal(meBeforeContact.body.settings.recoveryExitEnabled,true);
  assert.equal(meBeforeContact.body.settings.recoveryExitArmPctOfSL,40);

  // EA contacts with this license and account 111 -> auto-binds
  const eaConfig=await req(base,`/api/ea/config?account=111&license=${key}`,{headers:{authorization:`Bearer ${EA_TOKEN}`}});
  assert.equal(eaConfig.status,200);
  assert.equal(eaConfig.body.licenseStatus,'ACTIVE');

  const licList=await req(base,'/api/admin/licenses',{headers:{authorization:`Bearer ${ADMIN_TOKEN}`}});
  const bound=licList.body.licenses.find(l=>l.key===key);
  assert.equal(bound.account,'111');
  assert.ok(bound.lastSeen,'admin view must expose the license-scoped heartbeat');

  // critical fix: a config poll ALONE (zero trade/config-sync events) must already read back as
  // MT5 CONNECTED with dataAvailable:true — the website must never require an event to admit contact.
  const meAfterPollOnly=await req(base,'/api/auth/me',{cookie});
  assert.equal(meAfterPollOnly.status,200);
  assert.equal(meAfterPollOnly.body.dataAvailable,true);
  assert.equal(meAfterPollOnly.body.waitingForFirstContact,undefined);
  assert.equal(meAfterPollOnly.body.mt5.status,'CONNECTED');
  assert.ok(meAfterPollOnly.body.mt5.lastSeen);
  assert.equal(meAfterPollOnly.body.account.account,'111');
  assert.equal(meAfterPollOnly.body.armed,false);
  assert.equal(meAfterPollOnly.body.campaign,null);
  assert.deepEqual(meAfterPollOnly.body.history,[]);
  assert.equal(meAfterPollOnly.body.effectiveConfig,null,'no CONFIG_SYNC/event landed yet, so no effective-config snapshot exists');

  // a different account with the same license is now a mismatch and cannot arm, and must not
  // disturb the already-bound account's heartbeat
  const mismatch=await req(base,`/api/ea/config?account=999&license=${key}`,{headers:{authorization:`Bearer ${EA_TOKEN}`}});
  assert.equal(mismatch.status,200);
  assert.equal(mismatch.body.licenseStatus,'ACCOUNT_MISMATCH');
  assert.equal(mismatch.body.armed,false);
  const licList2=await req(base,'/api/admin/licenses',{headers:{authorization:`Bearer ${ADMIN_TOKEN}`}});
  assert.equal(licList2.body.licenses.find(l=>l.key===key).account,'111');
 });
});

test('an EA event (e.g. CONFIG_SYNC) also establishes first contact, even with zero config polls',async()=>{
 await withServer(async base=>{
  const ADMIN_TOKEN=process.env.ADMIN_TOKEN||'change-me-admin';
  const EA_TOKEN=process.env.EA_TOKEN||'change-me-ea';
  const create=await req(base,'/api/admin/licenses',{method:'POST',headers:{authorization:`Bearer ${ADMIN_TOKEN}`},body:{}});
  const key=create.body.license.key;

  const login=await req(base,'/api/auth/login',{method:'POST',body:{license:key}});
  const cookie=login.headers['set-cookie'][0].split(';')[0];

  const ev=await req(base,'/api/ea/event',{method:'POST',headers:{authorization:`Bearer ${EA_TOKEN}`},body:{
   type:'CONFIG_SYNC',account:'444',license:key,eaVersion:'XauCloud-Apex_v3.5.1',broker:'Exness',currency:'USD',configSource:'REMOTE'
  }});
  assert.equal(ev.status,200);

  const me=await req(base,'/api/auth/me',{cookie});
  assert.equal(me.body.dataAvailable,true);
  assert.equal(me.body.mt5.status,'CONNECTED');
  assert.equal(me.body.account.account,'444');
  assert.equal(me.body.account.broker,'Exness');
  assert.equal(me.body.account.currency,'USD');
  assert.equal(me.body.effectiveConfig.eaVersion,'XauCloud-Apex_v3.5.1');
  assert.equal(me.body.effectiveConfig.configSource,'REMOTE');
 });
});

test('an EA event under a mismatched account for an already-bound license is rejected (403) and does not update the heartbeat',async()=>{
 await withServer(async base=>{
  const ADMIN_TOKEN=process.env.ADMIN_TOKEN||'change-me-admin';
  const EA_TOKEN=process.env.EA_TOKEN||'change-me-ea';
  const create=await req(base,'/api/admin/licenses',{method:'POST',headers:{authorization:`Bearer ${ADMIN_TOKEN}`},body:{account:'555'}});
  const key=create.body.license.key;

  const bad=await req(base,'/api/ea/event',{method:'POST',headers:{authorization:`Bearer ${EA_TOKEN}`},body:{type:'CONFIG_SYNC',account:'999',license:key}});
  assert.equal(bad.status,403);
  assert.equal(bad.body.error,'ACCOUNT_MISMATCH');

  const licList=await req(base,'/api/admin/licenses',{headers:{authorization:`Bearer ${ADMIN_TOKEN}`}});
  const lic=licList.body.licenses.find(l=>l.key===key);
  assert.equal(lic.lastSeen,null,'a rejected event must not stamp a heartbeat');
 });
});

test('an EA event under an unknown license is rejected (403), not silently accepted',async()=>{
 await withServer(async base=>{
  const EA_TOKEN=process.env.EA_TOKEN||'change-me-ea';
  const bad=await req(base,'/api/ea/event',{method:'POST',headers:{authorization:`Bearer ${EA_TOKEN}`},body:{type:'CONFIG_SYNC',account:'1',license:'APEX-DOES-NOT-EXIST'}});
  assert.equal(bad.status,403);
  assert.equal(bad.body.error,'LICENSE_NOT_FOUND');
 });
});

test('an EA event under a disabled license is rejected (403)',async()=>{
 await withServer(async base=>{
  const ADMIN_TOKEN=process.env.ADMIN_TOKEN||'change-me-admin';
  const EA_TOKEN=process.env.EA_TOKEN||'change-me-ea';
  const create=await req(base,'/api/admin/licenses',{method:'POST',headers:{authorization:`Bearer ${ADMIN_TOKEN}`},body:{status:'DISABLED'}});
  const key=create.body.license.key;
  const bad=await req(base,'/api/ea/event',{method:'POST',headers:{authorization:`Bearer ${EA_TOKEN}`},body:{type:'CONFIG_SYNC',account:'1',license:key}});
  assert.equal(bad.status,403);
  assert.equal(bad.body.error,'LICENSE_DISABLED');
 });
});

test('an EA event under an expired license is rejected (403)',async()=>{
 await withServer(async base=>{
  const ADMIN_TOKEN=process.env.ADMIN_TOKEN||'change-me-admin';
  const EA_TOKEN=process.env.EA_TOKEN||'change-me-ea';
  const create=await req(base,'/api/admin/licenses',{method:'POST',headers:{authorization:`Bearer ${ADMIN_TOKEN}`},body:{expiresAt:new Date(Date.now()-1000).toISOString()}});
  const key=create.body.license.key;
  const bad=await req(base,'/api/ea/event',{method:'POST',headers:{authorization:`Bearer ${EA_TOKEN}`},body:{type:'CONFIG_SYNC',account:'1',license:key}});
  assert.equal(bad.status,403);
  assert.equal(bad.body.error,'LICENSE_EXPIRED');
 });
});

test('license/account isolation: two different licenses never share a heartbeat, account, or dashboard data',async()=>{
 await withServer(async base=>{
  const ADMIN_TOKEN=process.env.ADMIN_TOKEN||'change-me-admin';
  const EA_TOKEN=process.env.EA_TOKEN||'change-me-ea';
  const a=await req(base,'/api/admin/licenses',{method:'POST',headers:{authorization:`Bearer ${ADMIN_TOKEN}`},body:{}});
  const b=await req(base,'/api/admin/licenses',{method:'POST',headers:{authorization:`Bearer ${ADMIN_TOKEN}`},body:{}});
  const keyA=a.body.license.key,keyB=b.body.license.key;

  // only license A's EA ever contacts the backend
  await req(base,`/api/ea/config?account=AAA&license=${keyA}`,{headers:{authorization:`Bearer ${EA_TOKEN}`}});

  const loginA=await req(base,'/api/auth/login',{method:'POST',body:{license:keyA}});
  const cookieA=loginA.headers['set-cookie'][0].split(';')[0];
  const loginB=await req(base,'/api/auth/login',{method:'POST',body:{license:keyB}});
  const cookieB=loginB.headers['set-cookie'][0].split(';')[0];

  const meA=await req(base,'/api/auth/me',{cookie:cookieA});
  assert.equal(meA.body.mt5.status,'CONNECTED');
  assert.equal(meA.body.account.account,'AAA');

  // license B, which the EA never touched, must still show fully disconnected/waiting
  const meB=await req(base,'/api/auth/me',{cookie:cookieB});
  assert.equal(meB.body.dataAvailable,false);
  assert.equal(meB.body.waitingForFirstContact,true);
  assert.equal(meB.body.mt5.status,'DISCONNECTED');
  assert.equal(meB.body.mt5.lastSeen,null);
 });
});

test('arm/disarm: toggling Apex Armed persists to config and is reflected in both /api/auth/me and the next /api/ea/config poll',async()=>{
 await withServer(async base=>{
  const ADMIN_TOKEN=process.env.ADMIN_TOKEN||'change-me-admin';
  const EA_TOKEN=process.env.EA_TOKEN||'change-me-ea';
  const create=await req(base,'/api/admin/licenses',{method:'POST',headers:{authorization:`Bearer ${ADMIN_TOKEN}`},body:{}});
  const key=create.body.license.key;
  await req(base,`/api/ea/config?account=777&license=${key}`,{headers:{authorization:`Bearer ${EA_TOKEN}`}});
  const login=await req(base,'/api/auth/login',{method:'POST',body:{license:key}});
  const cookie=login.headers['set-cookie'][0].split(';')[0];

  const meBefore=await req(base,'/api/auth/me',{cookie});
  assert.equal(meBefore.body.armed,false);

  const arm=await req(base,'/api/session/config',{method:'POST',cookie,body:{armed:true}});
  assert.equal(arm.status,200);
  assert.equal(arm.body.config.armed,true);

  const meAfter=await req(base,'/api/auth/me',{cookie});
  assert.equal(meAfter.body.armed,true);

  const eaPoll=await req(base,`/api/ea/config?account=777&license=${key}`,{headers:{authorization:`Bearer ${EA_TOKEN}`}});
  assert.equal(eaPoll.body.armed,true);
  assert.equal(eaPoll.body.licenseStatus,'ACTIVE');
 });
});

test('admin editing a license (e.g. accountProfile) preserves its existing heartbeat/telemetry instead of wiping it',async()=>{
 await withServer(async base=>{
  const ADMIN_TOKEN=process.env.ADMIN_TOKEN||'change-me-admin';
  const EA_TOKEN=process.env.EA_TOKEN||'change-me-ea';
  const create=await req(base,'/api/admin/licenses',{method:'POST',headers:{authorization:`Bearer ${ADMIN_TOKEN}`},body:{}});
  const key=create.body.license.key;
  await req(base,`/api/ea/config?account=888&license=${key}`,{headers:{authorization:`Bearer ${EA_TOKEN}`}});

  const beforeEdit=await req(base,'/api/admin/licenses',{headers:{authorization:`Bearer ${ADMIN_TOKEN}`}});
  const lastSeenBefore=beforeEdit.body.licenses.find(l=>l.key===key).lastSeen;
  assert.ok(lastSeenBefore);

  const edit=await req(base,'/api/admin/licenses',{method:'POST',headers:{authorization:`Bearer ${ADMIN_TOKEN}`},body:{key,accountProfile:'UNLIMITED'}});
  assert.equal(edit.body.license.accountProfile,'UNLIMITED');
  assert.equal(edit.body.license.lastSeen,lastSeenBefore,'unrelated admin edit must not wipe the heartbeat');
  assert.equal(edit.body.license.account,'888','unrelated admin edit must not wipe the account binding');
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

test('the correct admin token succeeds when there is no prior lockout',async()=>{
 await withServer(async base=>{
  const ADMIN_TOKEN=process.env.ADMIN_TOKEN||'change-me-admin';
  const r=await req(base,'/api/admin/status',{headers:{authorization:`Bearer ${ADMIN_TOKEN}`}});
  assert.equal(r.status,200);
 });
});

test('repeated wrong admin tokens lock out that client, and a correct token during the lockout still fails',async()=>{
 await withServer(async base=>{
  for(let i=0;i<8;i++){
   const r=await req(base,'/api/admin/status',{headers:{authorization:'Bearer wrong-token'}});
   assert.equal(r.status,401);
  }
  const ADMIN_TOKEN=process.env.ADMIN_TOKEN||'change-me-admin';
  const stillLocked=await req(base,'/api/admin/status',{headers:{authorization:`Bearer ${ADMIN_TOKEN}`}});
  assert.equal(stillLocked.status,401);
 });
});
