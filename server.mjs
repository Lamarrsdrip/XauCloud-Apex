import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname=path.dirname(fileURLToPath(import.meta.url));
const PORT=Number(process.env.PORT||8787);
const ADMIN_TOKEN=process.env.ADMIN_TOKEN||'change-me-admin';
const SESSION_SECRET=process.env.SESSION_SECRET||'change-me-session-secret';
const SESSION_TTL_MS=30*24*60*60*1000;
const DATA=path.resolve(process.env.DATA_DIR||path.join(__dirname,'data'));
const CONFIG=path.join(DATA,'config.json');
const LICENSE_CONFIGS=path.join(DATA,'license-configs.json');
const EVENTS=path.join(DATA,'events.ndjson');
const LICENSES=path.join(DATA,'licenses.json');
const XAUCLOUD_BASE_URL=String(process.env.XAUCLOUD_BASE_URL||'https://xaucloud.io').trim().replace(/\/+$/,'');
const APEX_BRIDGE_SECRET=String(process.env.APEX_BRIDGE_SECRET||'');

const DEFAULT={
  armed:false,account:'0',symbolContains:'XAUUSD',
  targetMode:'MULTIPLIER',accountProfile:'NORMAL',
  targetEquity:1000,targetMultiplier:100,
  normalTargetProfitPct:0,
  baseMarginPct:100,layerMultiplier:2,maxLayers:0,
  normalL1MarginPct:15,normalL2MarginPct:50,normalL3PlusMarginPct:100,
  normalFixedSLGoldMove:30,
  profitRatchetEnabled:true,ratchetTriggerPct:180,ratchetLockPct:100,ratchetStepPct:100,ratchetLockStepPct:100,
  masterBreakEvenEnabled:true,masterBreakEvenTriggerPct:50,
  recoveryExitEnabled:true,recoveryExitArmPctOfSL:40,
  entryScore:76,addScore:70,impulseAtr:1.8,sweepAtr:.05,
  rejectionBars:5,watchExpiryMinutes:12,addSpacingAtr:.22,
  rejectionZoneAtr:.12,requireM3Confirm:true,requireM5Context:false,
  cooldownMinutes:0,learningEnabled:true,learningMinCampaigns:8,
  learningMaxScoreAdjustment:5
};

const num=(v,d,a,b)=>{v=Number(v);return Number.isFinite(v)?Math.max(a,Math.min(b,v)):d};
export function clean(x={}){
  return {
    ...DEFAULT,...x,
    armed:Boolean(x.armed),
    account:String(x.account??'0'),
    symbolContains:String(x.symbolContains||'XAUUSD').slice(0,32),
    targetMode:['MULTIPLIER','EQUITY'].includes(x.targetMode)?x.targetMode:'MULTIPLIER',
    accountProfile:['NORMAL','UNLIMITED'].includes(x.accountProfile)?x.accountProfile:'NORMAL',
    targetEquity:num(x.targetEquity,1000,.01,1e12),
    targetMultiplier:num(x.targetMultiplier,100,1.001,1e9),
    normalTargetProfitPct:num(x.normalTargetProfitPct,0,0,1e6),
    baseMarginPct:num(x.baseMarginPct,100,.01,100),
    layerMultiplier:num(x.layerMultiplier,2,1,10),
    maxLayers:Math.round(num(x.maxLayers,0,0,50)),
    normalL1MarginPct:num(x.normalL1MarginPct,15,.01,100),
    normalL2MarginPct:num(x.normalL2MarginPct,50,.01,100),
    normalL3PlusMarginPct:num(x.normalL3PlusMarginPct,100,.01,100),
    normalFixedSLGoldMove:num(x.normalFixedSLGoldMove,30,0,1e6),
    profitRatchetEnabled:x.profitRatchetEnabled!==false,
    ratchetTriggerPct:num(x.ratchetTriggerPct,180,.01,1e6),
    ratchetLockPct:num(x.ratchetLockPct,100,0,1e6),
    ratchetStepPct:num(x.ratchetStepPct,100,.01,1e6),
    ratchetLockStepPct:num(x.ratchetLockStepPct,100,0,1e6),
    masterBreakEvenEnabled:x.masterBreakEvenEnabled!==false,
    masterBreakEvenTriggerPct:num(x.masterBreakEvenTriggerPct,50,.01,1e6),
    recoveryExitEnabled:x.recoveryExitEnabled!==false,
    recoveryExitArmPctOfSL:num(x.recoveryExitArmPctOfSL,40,.01,1e6),
    entryScore:num(x.entryScore,76,40,100),
    addScore:num(x.addScore,70,40,100),
    impulseAtr:num(x.impulseAtr,1.8,.5,10),
    sweepAtr:num(x.sweepAtr,.05,0,2),
    rejectionBars:Math.round(num(x.rejectionBars,5,1,12)),
    watchExpiryMinutes:Math.round(num(x.watchExpiryMinutes,12,2,60)),
    addSpacingAtr:num(x.addSpacingAtr,.22,.02,5),
    rejectionZoneAtr:num(x.rejectionZoneAtr,.12,.02,2),
    requireM3Confirm:x.requireM3Confirm!==false,
    requireM5Context:Boolean(x.requireM5Context),
    cooldownMinutes:Math.round(num(x.cooldownMinutes,0,0,1440)),
    learningEnabled:x.learningEnabled!==false,
    learningMinCampaigns:Math.round(num(x.learningMinCampaigns,8,4,200)),
    learningMaxScoreAdjustment:num(x.learningMaxScoreAdjustment,5,0,15)
  };
}

async function atomic(file,obj){
  await fs.mkdir(path.dirname(file),{recursive:true});
  const tmp=file+'.tmp-'+process.pid+'-'+Date.now();
  await fs.writeFile(tmp,JSON.stringify(obj,null,2));
  await fs.rename(tmp,file);
}
async function read(file,fallback){try{return JSON.parse(await fs.readFile(file,'utf8'))}catch{return fallback}}
async function ensure(){
  await fs.mkdir(DATA,{recursive:true});
  try{await fs.access(CONFIG)}catch{await atomic(CONFIG,DEFAULT)}
  try{await fs.access(LICENSES)}catch{await atomic(LICENSES,{})}
  try{await fs.access(LICENSE_CONFIGS)}catch{await atomic(LICENSE_CONFIGS,{})}
}
async function body(req){
  let s='';
  for await(const c of req){s+=c;if(s.length>2e6)throw Object.assign(new Error('too_large'),{httpStatus:413})}
  if(!s)return {};
  try{return JSON.parse(s)}catch{throw Object.assign(new Error('invalid_json'),{httpStatus:400})}
}
function json(res,code,obj){
  res.writeHead(code,{'content-type':'application/json','cache-control':'no-store'});
  res.end(JSON.stringify(obj));
}
function clientIp(req){
  const f=req.headers['x-forwarded-for'];
  return f?String(f).split(',')[0].trim():(req.socket.remoteAddress||'unknown');
}
function maskLicense(k){k=String(k||'');return k.length<=8?'***':k.slice(0,5)+'...'+k.slice(-4)}
function licenseStatusFor(lic){
  if(!lic)return 'LICENSE_NOT_FOUND';
  if(lic.status==='DISABLED')return 'LICENSE_DISABLED';
  if(lic.expiresAt&&Date.now()>Date.parse(lic.expiresAt))return 'LICENSE_EXPIRED';
  return lic.status==='ACTIVE'?'ACTIVE':'LICENSE_DISABLED';
}
async function readLicenses(){return read(LICENSES,{})}
async function writeLicenses(x){await atomic(LICENSES,x)}
async function readLicenseConfigs(){return read(LICENSE_CONFIGS,{})}
async function getLicenseConfig(key){
  const all=await readLicenseConfigs();
  const global=clean(await read(CONFIG,DEFAULT));
  return clean({...global,...(all[key]||{})});
}
async function saveLicenseConfig(key,partial,{bumpRevision=true}={}){
  const all=await readLicenseConfigs();
  const prev=await getLicenseConfig(key);
  const next=clean({...prev,...partial});
  const licenses=await readLicenses();
  const lic=licenses[key];
  if(!lic)throw Object.assign(new Error('license_not_found'),{httpStatus:404});
  all[key]=next;
  const revision=bumpRevision?Number(lic.commandRevision||0)+1:Number(lic.commandRevision||0);
  if(bumpRevision){
    lic.commandRevision=revision;
    lic.pendingCommand=next.armed?'ARM':'DISARM';
    lic.commandUpdatedAt=new Date().toISOString();
    lic.updatedAt=lic.commandUpdatedAt;
    licenses[key]=lic;
  }
  await syncBridgeConfig(key,next,revision);
  await atomic(LICENSE_CONFIGS,all);
  if(bumpRevision)await writeLicenses(licenses);
  return next;
}
export function normalizeLicense(v){return String(v||'').trim().toUpperCase().replace(/ /g,'')}
function bridgeConfigured(){return Boolean(XAUCLOUD_BASE_URL&&APEX_BRIDGE_SECRET)}
function bridgeFailure(message,status=502,detail=null){
  return Object.assign(new Error(message),{httpStatus:status,detail});
}
async function bridgeRequest(route,{method='GET',payload}={}){
  if(!APEX_BRIDGE_SECRET)throw bridgeFailure('APEX_BRIDGE_SECRET_NOT_CONFIGURED',503);
  let response;
  try{
    response=await fetch(XAUCLOUD_BASE_URL+route,{
      method,
      headers:{'accept':'application/json','content-type':'application/json','x-apex-bridge-secret':APEX_BRIDGE_SECRET},
      body:payload===undefined?undefined:JSON.stringify(payload)
    });
  }catch(e){
    throw bridgeFailure('XAUCLOUD_BRIDGE_UNREACHABLE',502,{message:String(e?.message||e)});
  }
  const text=await response.text();
  let data;
  try{data=text?JSON.parse(text):{}}catch{throw bridgeFailure('XAUCLOUD_BRIDGE_NON_JSON_RESPONSE',502,{status:response.status})}
  if(!response.ok||data?.ok===false){
    throw bridgeFailure(String(data?.error||'XAUCLOUD_BRIDGE_REQUEST_FAILED'),response.status>=400?response.status:502,data);
  }
  return data;
}
async function syncBridgeLicense(key,lic,{resetAccount=false}={}){
  if(!bridgeConfigured())return null;
  return bridgeRequest('/api/cloud/apex/bridge/license/upsert',{method:'POST',payload:{
    license:normalizeLicense(key),active:licenseStatusFor(lic)==='ACTIVE',account:String(lic?.account||''),
    customer:String(lic?.customer||''),expiresAt:lic?.expiresAt??null,resetAccount:Boolean(resetAccount)
  }});
}
async function syncBridgeConfig(key,config,commandRevision=0){
  if(!bridgeConfigured())return null;
  return bridgeRequest('/api/cloud/apex/bridge/config/upsert',{method:'POST',payload:{
    license:normalizeLicense(key),config:clean(config),commandRevision:Number(commandRevision||0)
  }});
}
async function readBridgeStatus(key){
  return bridgeRequest('/api/cloud/apex/bridge/status?license='+encodeURIComponent(normalizeLicense(key)));
}
async function bridgeSelfTest(key,lic){
  const remote=await readBridgeStatus(key);
  const localActive=licenseStatusFor(lic)==='ACTIVE';
  const localAccount=String(lic?.account||'').trim();
  const remoteAccount=String(remote?.license?.account||'').trim();
  return {
    bridgeConfigured:bridgeConfigured(),localLicenseExists:Boolean(lic),mirrorExists:remote?.license?.exists===true,
    activeMatches:remote?.license?.active===localActive,
    accountExactMatch:remoteAccount===localAccount,
    accountBindingCompatible:!localAccount||remoteAccount===localAccount,
    bridgeConfigExists:remote?.configExists===true,
    localActive,remoteActive:remote?.license?.active===true,
    localAccount,remoteAccount
  };
}
async function syncAllLicensesAtStartup(){
  if(!bridgeConfigured())throw bridgeFailure('APEX_BRIDGE_SECRET_NOT_CONFIGURED',503);
  const licenses=await readLicenses();
  for(const [rawKey,lic] of Object.entries(licenses)){
    const key=normalizeLicense(rawKey);
    if(!key)continue;
    await syncBridgeLicense(key,lic);
    await syncBridgeConfig(key,await getLicenseConfig(key),Number(lic.commandRevision||0));
    const check=await bridgeSelfTest(key,lic);
    if(!check.mirrorExists||!check.activeMatches||!check.accountBindingCompatible||!check.bridgeConfigExists)
      throw bridgeFailure('XAUCLOUD_BRIDGE_SELF_TEST_FAILED',502,{license:maskLicense(key),check});
    console.log(`APEX_BRIDGE_SYNC_OK license=${maskLicense(key)} active=${check.localActive} accountBound=${Boolean(check.remoteAccount)} config=true`);
  }
  console.log(`APEX_BRIDGE_STARTUP_OK licenses=${Object.keys(licenses).length}`);
}
async function validateEa(licenseKey,account){
  const key=normalizeLicense(licenseKey), accountS=String(account||'');
  const licenses=await readLicenses();
  const lic=licenses[key];
  const status=licenseStatusFor(lic);
  if(status!=='ACTIVE')return {ok:false,status,key,licenses};
  // An explicitly admin-bound account is enforced. Blank account means license works on demo or live.
  if(lic.account&&String(lic.account)!==accountS)return {ok:false,status:'ACCOUNT_MISMATCH',key,licenses};
  return {ok:true,status:'ACTIVE',key,lic,licenses};
}
async function stampHeartbeat(v,payload){
  const now=new Date().toISOString(), lic=v.lic;
  lic.lastSeen=now;
  lic.lastAccount=String(payload.account||'');
  lic.broker=String(payload.broker||'').slice(0,120);
  lic.server=String(payload.server||'').slice(0,120);
  lic.currency=String(payload.currency||'').slice(0,20);
  lic.eaVersion=String(payload.eaVersion||payload.version||'').slice(0,120);
  lic.tradeMode=Number(payload.tradeMode||0);
  lic.symbol=String(payload.symbol||'').slice(0,40);
  lic.balance=Number(payload.balance||0);
  lic.equity=Number(payload.equity||0);
  lic.freeMargin=Number(payload.freeMargin||0);
  lic.campaignActive=Boolean(payload.campaignActive);
  lic.layers=Number(payload.layers||0);
  lic.updatedAt=now;
  v.licenses[v.key]=lic;
  await writeLicenses(v.licenses);
  return lic;
}
async function appendEvent(e){
  await fs.mkdir(DATA,{recursive:true});
  await fs.appendFile(EVENTS,JSON.stringify({ts:new Date().toISOString(),...e})+'\n');
}
async function allEvents(){
  try{return (await fs.readFile(EVENTS,'utf8')).trim().split('\n').filter(Boolean).map(x=>{try{return JSON.parse(x)}catch{return null}}).filter(Boolean)}
  catch{return[]}
}

// --- Website sessions ---
function b64u(buf){return buf.toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')}
function fromB64u(s){return Buffer.from(s.replace(/-/g,'+').replace(/_/g,'/'),'base64')}
function sign(p){return b64u(crypto.createHmac('sha256',SESSION_SECRET).update(p).digest())}
function makeSession(licenseKey){
  const now=Date.now(),p=b64u(Buffer.from(JSON.stringify({lic:licenseKey,iat:now,exp:now+SESSION_TTL_MS})));
  return p+'.'+sign(p);
}
function verifySession(token){
  if(!token)return null;
  const i=token.lastIndexOf('.');if(i<0)return null;
  const p=token.slice(0,i),sig=token.slice(i+1),exp=sign(p);
  const a=Buffer.from(sig),b=Buffer.from(exp);if(a.length!==b.length||!crypto.timingSafeEqual(a,b))return null;
  let x;try{x=JSON.parse(fromB64u(p).toString('utf8'))}catch{return null}
  return x.exp&&Date.now()<x.exp?x:null;
}
function cookies(req){
  const out={};for(const part of String(req.headers.cookie||'').split(';')){
    const i=part.indexOf('=');if(i>0)out[part.slice(0,i).trim()]=decodeURIComponent(part.slice(i+1).trim());
  }return out;
}
function setSession(res,t){res.setHeader('Set-Cookie',`apex_session=${encodeURIComponent(t)}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${Math.floor(SESSION_TTL_MS/1000)}`)}
function clearSession(res){res.setHeader('Set-Cookie','apex_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0')}

export function classifyMt5(lastSeen){
  if(!lastSeen)return 'DISCONNECTED';
  const a=(Date.now()-Date.parse(lastSeen))/1000;
  return a<45?'CONNECTED':a<180?'STALE':'DISCONNECTED';
}
function humanEvent(e){
  const d=e.direction>0?'BUY':e.direction<0?'SELL':'';
  switch(e.type){
    case 'WATCH_ARMED':return `Potential ${e.watchDir>0?'BUY':'SELL'} reversal setup detected`;
    case 'CAMPAIGN_START':return `${d} campaign started`;
    case 'LAYER_OPEN':return `Market confirmed continuation — added position ${e.layer}`;
    case 'CAMPAIGN_END':return `${d} campaign ended — ${e.outcome||'closed'}`;
    case 'ORDER_FAIL':return `Order failed — broker code ${e.retcode||''}`;
    case 'CAMPAIGN_RECOVERED':return 'Apex recovered an open campaign after restart';
    default:return null;
  }
}
function buildHistory(events){
  const starts={};for(const e of events)if(e.type==='CAMPAIGN_START'&&e.campaignId)starts[e.campaignId]=e;
  return events.filter(e=>e.type==='CAMPAIGN_END').slice(-50).reverse().map(e=>({
    campaignId:e.campaignId,direction:e.direction>0?'BUY':'SELL',startedAt:starts[e.campaignId]?.ts||null,
    endedAt:e.ts,layers:e.layers,outcome:e.outcome,mfe:e.mfe,mae:e.mae
  }));
}
function learningShape(events){
  const ends=events.filter(e=>e.type==='CAMPAIGN_END');
  const positive=ends.filter(e=>['TARGET_HIT','PROFIT_FLOOR_HIT'].includes(e.outcome)).length;
  return {schema:4,completedCampaigns:ends.length,positiveOutcomeRate:ends.length?positive/ends.length:0,
    entryScoreAdjustment:0,addScoreAdjustment:0,authority:'OBSERVATION_ONLY',bySignature:{},featureInsights:{}};
}
function settingsView(c){return {
  accountProfile:c.accountProfile,normalTargetProfitPct:c.normalTargetProfitPct,baseMarginPct:c.baseMarginPct,
  layerMultiplier:c.layerMultiplier,maxLayers:c.maxLayers,normalL1MarginPct:c.normalL1MarginPct,
  normalL2MarginPct:c.normalL2MarginPct,normalL3PlusMarginPct:c.normalL3PlusMarginPct,
  normalFixedSLGoldMove:c.normalFixedSLGoldMove,profitRatchetEnabled:c.profitRatchetEnabled,
  ratchetTriggerPct:c.ratchetTriggerPct,ratchetLockPct:c.ratchetLockPct,ratchetStepPct:c.ratchetStepPct,
  ratchetLockStepPct:c.ratchetLockStepPct,masterBreakEvenEnabled:c.masterBreakEvenEnabled,
  masterBreakEvenTriggerPct:c.masterBreakEvenTriggerPct,recoveryExitEnabled:c.recoveryExitEnabled,
  recoveryExitArmPctOfSL:c.recoveryExitArmPctOfSL,
  advanced:{entryScore:c.entryScore,addScore:c.addScore,impulseAtr:c.impulseAtr,sweepAtr:c.sweepAtr,
    rejectionBars:c.rejectionBars,watchExpiryMinutes:c.watchExpiryMinutes,rejectionZoneAtr:c.rejectionZoneAtr,
    addSpacingAtr:c.addSpacingAtr,requireM3Confirm:c.requireM3Confirm,requireM5Context:c.requireM5Context}
}}
async function buildMe(key){
  const licenses=await readLicenses(),lic=licenses[key],status=licenseStatusFor(lic),cfg=await getLicenseConfig(key);
  const base={key,status,account:lic?.account||null,lastAccount:lic?.lastAccount||null,accountProfile:lic?.accountProfile||cfg.accountProfile,expiresAt:lic?.expiresAt||null,customer:lic?.customer||null};
  if(status!=='ACTIVE')return {license:base,dataAvailable:false,armed:false,mt5:{status:'DISCONNECTED',lastSeen:null},settings:settingsView(cfg)};
  const all=await allEvents(),acct=lic.lastAccount||lic.account||'';
  const events=acct?all.filter(e=>String(e.account)===String(acct)):all.filter(e=>normalizeLicense(e.license)===key);
  const mt5=classifyMt5(lic.lastSeen);
  return {
    license:base,dataAvailable:Boolean(lic.lastSeen),waitingForFirstContact:!lic.lastSeen,
    armed:cfg.armed,accountProfile:cfg.accountProfile,
    mt5:{status:mt5,lastSeen:lic.lastSeen||null},
    command:{revision:Number(lic.commandRevision||0),pending:lic.pendingCommand||null,lastAckRevision:Number(lic.lastAckRevision||0),lastAckStatus:lic.lastAckStatus||null,lastAckAt:lic.lastAckAt||null},
    account:{account:lic.lastAccount||lic.account||null,broker:lic.broker||null,server:lic.server||null,currency:lic.currency||null,
      balance:lic.balance??null,equity:lic.equity??null,freeMargin:lic.freeMargin??null,asOf:lic.lastSeen||null,tradeMode:lic.tradeMode??null},
    campaign:null,history:buildHistory(events),learning:learningShape(events),
    recentHuman:events.slice(-60).reverse().map(e=>({ts:e.ts,type:e.type,text:humanEvent(e)})).filter(x=>x.text).slice(0,30),
    effectiveConfig:lic.eaVersion?{eaVersion:lic.eaVersion,configSource:'REMOTE/CACHED_LOCAL',asOf:lic.lastSeen}:null,
    settings:settingsView(cfg)
  };
}
function genLicense(){
  const seg=()=>crypto.randomBytes(3).toString('hex').toUpperCase();
  return `APEX-${seg()}-${seg()}-${seg()}`;
}
function adminOk(req){return req.headers.authorization===`Bearer ${ADMIN_TOKEN}`}

const server=http.createServer(async(req,res)=>{
  try{
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('X-Frame-Options','DENY');
    res.setHeader('Referrer-Policy','no-referrer');
    const u=new URL(req.url,'http://localhost');

    if(req.method==='GET'&&u.pathname==='/health')
      return json(res,200,{ok:true,service:'xaucloud-apex',version:'3.7.0',link:'command-center-style'});

    // New canonical MT5 heartbeat. JSON body only: avoids fragile custom auth headers.
    if(req.method==='POST'&&u.pathname==='/api/apex/heartbeat'){
      const b=await body(req),v=await validateEa(b.license,b.account);
      if(!v.ok){console.warn(`APEX_HEARTBEAT_DENIED ip=${clientIp(req)} license=${maskLicense(b.license)} status=${v.status}`);return json(res,200,{ok:false,licenseStatus:v.status,armed:false})}
      const lic=await stampHeartbeat(v,b),cfg=await getLicenseConfig(v.key);
      return json(res,200,{ok:true,licenseStatus:'ACTIVE',...cfg,commandRevision:Number(lic.commandRevision||0),serverTime:new Date().toISOString()});
    }

    if(req.method==='POST'&&u.pathname==='/api/apex/command/ack'){
      const b=await body(req),v=await validateEa(b.license,b.account);
      if(!v.ok)return json(res,403,{ok:false,error:v.status});
      const lic=v.lic,rev=Number(b.revision||0);
      if(rev>=Number(lic.lastAckRevision||0)){lic.lastAckRevision=rev;lic.lastAckStatus=String(b.status||'ACK');lic.lastAckAt=new Date().toISOString();v.licenses[v.key]=lic;await writeLicenses(v.licenses)}
      return json(res,200,{ok:true});
    }

    if(req.method==='POST'&&u.pathname==='/api/apex/event'){
      const b=await body(req),v=await validateEa(b.license,b.account);
      if(!v.ok)return json(res,403,{ok:false,error:v.status});
      await stampHeartbeat(v,b);
      await appendEvent({...b,license:v.key});
      return json(res,200,{ok:true});
    }

    // Compatibility for already-attached older EA versions.
    if(req.method==='GET'&&u.pathname==='/api/ea/config'){
      const license=normalizeLicense(req.headers['x-apex-license']||u.searchParams.get('license')||'');
      const account=String(u.searchParams.get('account')||'');
      const v=await validateEa(license,account);
      if(!v.ok)return json(res,200,{...DEFAULT,armed:false,licenseStatus:v.status});
      const lic=await stampHeartbeat(v,{account}),cfg=await getLicenseConfig(v.key);
      return json(res,200,{...cfg,licenseStatus:'ACTIVE',commandRevision:Number(lic.commandRevision||0),learning:learningShape(await allEvents())});
    }
    if(req.method==='POST'&&u.pathname==='/api/ea/event'){
      const b=await body(req);
      const license=normalizeLicense(req.headers['x-apex-license']||b.license||'');
      const v=await validateEa(license,b.account);
      if(!v.ok)return json(res,403,{error:v.status});
      await stampHeartbeat(v,b);await appendEvent({...b,license:v.key});return json(res,200,{ok:true});
    }

    // Website auth.
    if(req.method==='POST'&&u.pathname==='/api/auth/login'){
      const b=await body(req),key=normalizeLicense(b.license),licenses=await readLicenses();
      if(licenseStatusFor(licenses[key])!=='ACTIVE')return json(res,401,{error:'LICENSE_NOT_ACTIVE'});
      setSession(res,makeSession(key));return json(res,200,{ok:true});
    }
    if(req.method==='POST'&&u.pathname==='/api/auth/logout'){clearSession(res);return json(res,200,{ok:true})}
    if(req.method==='GET'&&u.pathname==='/api/auth/me'){
      const s=verifySession(cookies(req).apex_session);if(!s)return json(res,401,{error:'no_session'});
      return json(res,200,await buildMe(s.lic));
    }
    if(req.method==='POST'&&u.pathname==='/api/session/config'){
      const s=verifySession(cookies(req).apex_session);if(!s)return json(res,401,{error:'no_session'});
      const licenses=await readLicenses();if(licenseStatusFor(licenses[s.lic])!=='ACTIVE')return json(res,403,{error:'license_not_active'});
      const b=await body(req),cfg=await saveLicenseConfig(s.lic,b,{bumpRevision:true});
      return json(res,200,{ok:true,config:cfg,commandRevision:Number((await readLicenses())[s.lic].commandRevision||0)});
    }

    // Admin.
    if(req.method==='GET'&&u.pathname==='/api/admin/licenses'){
      if(!adminOk(req))return json(res,401,{error:'unauthorized'});
      const ls=await readLicenses();return json(res,200,{licenses:Object.entries(ls).map(([key,v])=>({key,...v,status:licenseStatusFor(v)}))});
    }
    if(req.method==='POST'&&u.pathname==='/api/admin/licenses'){
      if(!adminOk(req))return json(res,401,{error:'unauthorized'});
      const b=await body(req),ls=await readLicenses(),key=normalizeLicense(b.key)||genLicense(),old=ls[key]||{},now=new Date().toISOString();
      const next={...old,status:['ACTIVE','DISABLED'].includes(b.status)?b.status:(old.status||'ACTIVE'),
        account:b.account!==undefined?String(b.account||''):(old.account||''),
        customer:b.customer!==undefined?String(b.customer||''):(old.customer||''),
        accountProfile:['NORMAL','UNLIMITED'].includes(b.accountProfile)?b.accountProfile:(old.accountProfile||'NORMAL'),
        expiresAt:b.expiresAt!==undefined?(b.expiresAt||null):(old.expiresAt||null),
        commandRevision:Number(old.commandRevision||0),createdAt:old.createdAt||now,updatedAt:now};
      await syncBridgeLicense(key,next,{resetAccount:b.account!==undefined&&!String(b.account||'')});
      await syncBridgeConfig(key,await getLicenseConfig(key),Number(next.commandRevision||0));
      ls[key]=next;
      await writeLicenses(ls);return json(res,200,{ok:true,license:{key,...ls[key],status:licenseStatusFor(ls[key])}});
    }
    if(req.method==='GET'&&u.pathname==='/api/admin/bridge/status'){
      if(!adminOk(req))return json(res,401,{error:'unauthorized'});
      const key=normalizeLicense(u.searchParams.get('license')||'');
      if(!key)return json(res,400,{ok:false,error:'license_required'});
      const licenses=await readLicenses(),lic=licenses[key];
      if(!lic)return json(res,404,{ok:false,error:'local_license_not_found',license:maskLicense(key)});
      const check=await bridgeSelfTest(key,lic);
      return json(res,200,{ok:true,license:maskLicense(key),...check});
    }
    if(req.method==='GET'&&u.pathname==='/api/admin/status'){
      if(!adminOk(req))return json(res,401,{error:'unauthorized'});
      return json(res,200,{ok:true,licenses:(await readLicenses()),configs:(await readLicenseConfigs())});
    }

    if(req.method==='GET'&&u.pathname==='/'){
      const html=await fs.readFile(path.join(__dirname,'public','index.html'));
      res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});
      return res.end(html);
    }
    return json(res,404,{error:'not_found'});
  }catch(e){
    console.error(e);
    return json(res,e?.httpStatus||500,{error:e?.message||'internal_error'});
  }
});

await ensure();
if(process.env.NODE_ENV!=='test'){
  await syncAllLicensesAtStartup();
  server.listen(PORT,'0.0.0.0',()=>console.log(`XauCloud Apex v3.7 listening on ${PORT}`));
}
export {server,syncAllLicensesAtStartup};
