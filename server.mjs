import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname=path.dirname(fileURLToPath(import.meta.url));
const PORT=Number(process.env.PORT||8787);
const ADMIN_TOKEN=process.env.ADMIN_TOKEN||'change-me-admin';
const EA_TOKEN=process.env.EA_TOKEN||'change-me-ea';
const SESSION_SECRET=process.env.SESSION_SECRET||'change-me-session-secret';
const SESSION_TTL_MS=30*24*60*60*1000;
const DATA=path.resolve(process.env.DATA_DIR||path.join(__dirname,'data'));
const CONFIG=path.join(DATA,'config.json');
const EVENTS=path.join(DATA,'events.ndjson');
const STATE=path.join(DATA,'state.json');
const LICENSES=path.join(DATA,'licenses.json');

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

const OBSOLETE_FIELDS=[
  'normalAccountMaxMultiplier','enableInvalidationExit','invalidationGivebackPct',
  'normalProfitFloorEnabled',
  'ratchetTriggerMoney','ratchetLockMoney','ratchetStepMoney','ratchetLockStepMoney'
];

async function atomic(file,obj){const t=file+'.tmp'+process.pid;await fs.writeFile(t,JSON.stringify(obj,null,2));await fs.rename(t,file)}
async function ensure(){
  await fs.mkdir(DATA,{recursive:true});
  try{await fs.access(CONFIG)}catch{await atomic(CONFIG,DEFAULT)}
  try{await fs.access(LICENSES)}catch{await atomic(LICENSES,{})}
}
async function read(file,fallback){try{return JSON.parse(await fs.readFile(file,'utf8'))}catch{return fallback}}
const num=(v,d,a,b)=>{v=Number(v);return Number.isFinite(v)?Math.max(a,Math.min(b,v)):d};

export function clean(x={}){
  for(const f of OBSOLETE_FIELDS) delete x[f];
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

async function body(req){
  let s='';
  for await(const c of req){s+=c;if(s.length>2e6)throw Object.assign(new Error('too_large'),{httpStatus:413})}
  if(!s)return {};
  try{return JSON.parse(s)}catch{throw Object.assign(new Error('invalid_json'),{httpStatus:400})}
}
function auth(req,token){return req.headers.authorization===`Bearer ${token}`}
function json(res,code,obj){res.writeHead(code,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(obj))}
async function event(e){await fs.appendFile(EVENTS,JSON.stringify({ts:new Date().toISOString(),...e})+'\n')}
async function allEvents(){try{return (await fs.readFile(EVENTS,'utf8')).trim().split('\n').filter(Boolean).map(x=>{try{return JSON.parse(x)}catch{return null}}).filter(Boolean)}catch{return[]}}

// ---------- rate limiting (login brute-force protection) ----------
const loginAttempts=new Map();
function rateLimited(ip){
  const now=Date.now(),windowMs=10*60*1000,max=10;
  const rec=loginAttempts.get(ip);
  if(!rec||now>rec.resetAt){loginAttempts.set(ip,{count:1,resetAt:now+windowMs});return false}
  rec.count++;
  return rec.count>max;
}
function clientIp(req){
  const fwd=req.headers['x-forwarded-for'];
  if(fwd)return String(fwd).split(',')[0].trim();
  return req.socket.remoteAddress||'unknown';
}

// ---------- admin-token brute-force lockout ----------
const adminFails=new Map();
const ADMIN_FAIL_WINDOW_MS=10*60*1000,ADMIN_FAIL_MAX=8,ADMIN_LOCKOUT_MS=15*60*1000;
function adminAuthOk(req){
  const ip=clientIp(req),now=Date.now();
  const rec=adminFails.get(ip);
  if(rec&&rec.blockedUntil>now)return false;
  const ok=auth(req,ADMIN_TOKEN);
  if(ok){adminFails.delete(ip);return true}
  const count=(rec&&rec.resetAt>now?rec.count:0)+1;
  adminFails.set(ip,{count,resetAt:now+ADMIN_FAIL_WINDOW_MS,blockedUntil:count>=ADMIN_FAIL_MAX?now+ADMIN_LOCKOUT_MS:0});
  return false;
}

// ---------- sessions (HMAC-signed, HttpOnly cookie) ----------
function b64u(buf){return buf.toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')}
function fromB64u(s){return Buffer.from(s.replace(/-/g,'+').replace(/_/g,'/'),'base64')}
function sign(payloadB64){return b64u(crypto.createHmac('sha256',SESSION_SECRET).update(payloadB64).digest())}
function makeSession(licenseKey){
  const now=Date.now();
  const p=b64u(Buffer.from(JSON.stringify({lic:licenseKey,iat:now,exp:now+SESSION_TTL_MS})));
  return p+'.'+sign(p);
}
function verifySession(token){
  if(!token)return null;
  const i=token.lastIndexOf('.');
  if(i<0)return null;
  const p=token.slice(0,i),sig=token.slice(i+1);
  const expected=sign(p);
  const a=Buffer.from(sig),b=Buffer.from(expected);
  if(a.length!==b.length||!crypto.timingSafeEqual(a,b))return null;
  let payload;
  try{payload=JSON.parse(fromB64u(p).toString('utf8'))}catch{return null}
  if(!payload.exp||Date.now()>payload.exp)return null;
  return payload;
}
function parseCookies(req){
  const out={},h=req.headers.cookie;
  if(!h)return out;
  for(const part of h.split(';')){
    const idx=part.indexOf('=');
    if(idx<0)continue;
    out[part.slice(0,idx).trim()]=decodeURIComponent(part.slice(idx+1).trim());
  }
  return out;
}
function setSessionCookie(res,token){
  res.setHeader('Set-Cookie',`apex_session=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${Math.floor(SESSION_TTL_MS/1000)}`);
}
function clearSessionCookie(res){
  res.setHeader('Set-Cookie','apex_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0');
}

// ---------- licenses ----------
async function readLicenses(){return await read(LICENSES,{})}
async function writeLicenses(obj){await atomic(LICENSES,obj)}
function genLicenseKey(){
  const seg=()=>crypto.randomBytes(3).toString('hex').toUpperCase();
  return `APEX-${seg()}-${seg()}-${seg()}`;
}
function licenseStatusFor(lic){
  if(!lic)return 'LICENSE_NOT_FOUND';
  if(lic.status==='DISABLED')return 'LICENSE_DISABLED';
  if(lic.expiresAt&&Date.now()>Date.parse(lic.expiresAt))return 'LICENSE_EXPIRED';
  if(lic.status!=='ACTIVE')return 'LICENSE_DISABLED';
  return 'ACTIVE';
}
async function checkEaLicense(licenseKey,account){
  if(!licenseKey)return {ok:false,code:'LICENSE_NOT_FOUND'};
  const licenses=await readLicenses();
  const lic=licenses[licenseKey];
  const status=licenseStatusFor(lic);
  if(status!=='ACTIVE')return {ok:false,code:status};
  if(lic.account&&lic.account!==account)return {ok:false,code:'ACCOUNT_MISMATCH'};
  if(!lic.account){
    lic.account=account;
    lic.updatedAt=new Date().toISOString();
    licenses[licenseKey]=lic;
    await writeLicenses(licenses);
  }
  return {ok:true,license:lic};
}

// ---------- learning ----------
const FEATURE_MIN_SAMPLE=5;
function bucketImpulse(v){if(v<1)return'impulse_low(<1x_ATR)';if(v<2)return'impulse_mid(1-2x_ATR)';return'impulse_high(>=2x_ATR)'}
function bucketWick(v){if(v<1.5)return'wick_low(<1.5x_body)';if(v<3)return'wick_mid(1.5-3x_body)';return'wick_high(>=3x_body)'}
function addToBucket(buckets,name,key,win){const b=buckets[name]??={};const c=b[key]??={campaigns:0,wins:0};c.campaigns++;if(win)c.wins++;b[key]=c;buckets[name]=b}

export function learn(events,cfg){
  const starts={};
  for(const e of events) if(e.type==='CAMPAIGN_START'&&e.campaignId) starts[e.campaignId]=e;
  const ends=events.filter(e=>e.type==='CAMPAIGN_END');
  const rows=ends.map(e=>({...e,start:starts[e.campaignId]||null}));
  const targetHits=rows.filter(r=>r.outcome==='TARGET_HIT').length;
  const protectedExits=rows.filter(r=>r.outcome==='PROFIT_FLOOR_HIT').length;
  const genuineFailures=rows.filter(r=>!['TARGET_HIT','PROFIT_FLOOR_HIT'].includes(r.outcome)).length;
  const completed=rows.length;
  const positive=targetHits+protectedExits;
  const positiveRate=completed?positive/completed:0;

  let entryAdj=0,addAdj=0;
  if(cfg.learningEnabled&&completed>=cfg.learningMinCampaigns){
    const centered=(.60-positiveRate)*10;
    entryAdj=Math.max(-cfg.learningMaxScoreAdjustment,Math.min(cfg.learningMaxScoreAdjustment,centered));
    const addCentered=(.55-positiveRate)*8;
    addAdj=Math.max(-cfg.learningMaxScoreAdjustment,Math.min(cfg.learningMaxScoreAdjustment,addCentered));
  }

  const by={};
  for(const r of rows){
    const k=r.signature||'UNKNOWN';
    const b=by[k]??={campaigns:0,targetHits:0,protectedExits:0,failures:0,mfe:0,mae:0,layers:0};
    b.campaigns++;
    if(r.outcome==='TARGET_HIT') b.targetHits++;
    else if(r.outcome==='PROFIT_FLOOR_HIT') b.protectedExits++;
    else b.failures++;
    b.mfe+=Number(r.mfe||0); b.mae+=Number(r.mae||0); b.layers+=Number(r.layers||0);
    by[k]=b;
  }
  for(const b of Object.values(by)){
    b.positiveRate=b.campaigns?(b.targetHits+b.protectedExits)/b.campaigns:0;
    b.avgMfe=b.campaigns?b.mfe/b.campaigns:0;
    b.avgMae=b.campaigns?b.mae/b.campaigns:0;
    b.avgLayers=b.campaigns?b.layers/b.campaigns:0;
  }

  const buckets={};
  for(const r of rows){
    if(!r.start)continue;
    const win=['TARGET_HIT','PROFIT_FLOOR_HIT'].includes(r.outcome);
    const im=Number(r.start.impulseMult),wk=Number(r.start.wickRatio),m3=r.start.m3,m5=r.start.m5;
    if(Number.isFinite(im))addToBucket(buckets,'impulseMult',bucketImpulse(im),win);
    if(Number.isFinite(wk))addToBucket(buckets,'wickRatio',bucketWick(wk),win);
    if(m3!==undefined)addToBucket(buckets,'m3Confirmed',String(m3),win);
    if(m5!==undefined)addToBucket(buckets,'m5Context',String(m5),win);
  }
  const featureInsights={};
  for(const[name,vals]of Object.entries(buckets)){
    featureInsights[name]={};
    for(const[key,c]of Object.entries(vals)){
      featureInsights[name][key]=c.campaigns>=FEATURE_MIN_SAMPLE
        ?{campaigns:c.campaigns,positiveRate:Number((c.wins/c.campaigns).toFixed(3))}
        :{campaigns:c.campaigns,positiveRate:null,note:`insufficient_sample_min_${FEATURE_MIN_SAMPLE}`};
    }
  }

  return {
    schema:4,
    completedCampaigns:completed,
    targetHits,
    protectedExits,
    genuineFailures,
    positiveOutcomeRate:positiveRate,
    entryScoreAdjustment:Number(entryAdj.toFixed(2)),
    addScoreAdjustment:Number(addAdj.toFixed(2)),
    authority:completed>=cfg.learningMinCampaigns?'BOUNDED_ADAPTIVE':'OBSERVATION_ONLY',
    bySignature:by,
    featureInsights
  };
}

function publicState(cfg,state,learning,recent){
  const last=state?.lastEA||{};
  const latestStart=recent.find(e=>e.type==='CAMPAIGN_START');
  const latestEnd=recent.find(e=>e.type==='CAMPAIGN_END');
  const campaignActive=Boolean(last.campaignId)&&(!latestEnd||!latestStart||new Date(latestStart.ts)>new Date(latestEnd.ts));
  return {
    config:cfg,
    state:{updatedAt:state?.updatedAt||null,lastSeen:state?.lastSeen||null,lastEA:last,campaignActive},
    learning,
    recent:recent.slice(0,50)
  };
}

// ---------- human-readable dashboard shaping ----------
function classifyMt5(lastSeenIso){
  if(!lastSeenIso)return 'DISCONNECTED';
  const ageSec=(Date.now()-Date.parse(lastSeenIso))/1000;
  if(ageSec<45)return 'CONNECTED';
  if(ageSec<300)return 'STALE';
  return 'DISCONNECTED';
}
function humanEvent(e){
  const dir=e.direction>0?'BUY':e.direction<0?'SELL':'';
  switch(e.type){
    case 'WATCH_ARMED': return `Potential ${e.watchDir>0?'BUY':'SELL'} reversal setup detected`;
    case 'CAMPAIGN_START': return `${dir} campaign started`;
    case 'LAYER_OPEN': return `Market confirmed continuation — added position ${e.layer}`;
    case 'PROFIT_RATCHET_EXIT': return `Protected profit secured at ${Number(e.protectedPct||0).toFixed(0)}% — closing campaign`;
    case 'MASTER_SL_MOVED': return 'Master position stop-loss updated';
    case 'MASTER_BE_ARMED': return 'Break-even secured — master stop-loss moved to entry price';
    case 'RECOVERY_EXIT_ARMED': return `Setup marked damaged — ${Number(e.adversePctOfSL||0).toFixed(0)}% adverse move reached, will exit if price recovers to entry`;
    case 'RECOVERY_TO_ENTRY_EXIT': return 'Damaged setup recovered to entry — closing campaign to wait for a fresh setup';
    case 'CAMPAIGN_END':
      if(e.outcome==='TARGET_HIT')return `${dir} campaign complete — target reached`;
      if(e.outcome==='PROFIT_FLOOR_HIT')return 'Protected profit secured — campaign closed';
      if(e.outcome==='MASTER_SL_BASKET_EXIT')return `${dir} campaign closed — stop loss hit`;
      if(e.outcome==='MASTER_LEG_CLOSED')return `${dir} campaign closed — master position closed`;
      if(e.outcome==='RECOVERY_TO_ENTRY_EXIT')return `${dir} campaign closed — damaged setup recovered to entry`;
      return `${dir} campaign ended — broker/margin stop-out`;
    case 'CAMPAIGN_RECOVERED': return 'Apex reconnected to an in-progress campaign after a restart';
    case 'ADD_BLOCKED': return 'Add skipped — no available margin capacity';
    case 'ORDER_FAIL': return `Order failed (broker rejected, code ${e.retcode})`;
    case 'MASTER_SL_MOVE_FAIL': return 'Master stop-loss update failed';
    case 'CONFIG_SYNC': case 'MARGIN_CALC': return null;
    default: return e.type;
  }
}
function findActiveCampaign(events){
  let lastStart=null,lastEnd=null;
  for(const e of events){
    if(e.type==='CAMPAIGN_START')lastStart=e;
    if(e.type==='CAMPAIGN_END')lastEnd=e;
  }
  if(!lastStart)return null;
  if(lastEnd&&Date.parse(lastEnd.ts)>=Date.parse(lastStart.ts))return null;
  const campaignId=lastStart.campaignId;
  const layerEvents=events.filter(e=>e.type==='LAYER_OPEN'&&e.campaignId===campaignId);
  const totalVolume=layerEvents.reduce((s,e)=>s+Number(e.volume||0),0);
  const latest=events[events.length-1];
  const startEquity=Number(lastStart.equity??lastStart.balance??0);
  const currentEquity=Number(latest.equity??latest.balance??startEquity);
  const targetEquity=Number(lastStart.targetEquity??0);
  const profitPct=startEquity?((currentEquity-startEquity)/startEquity)*100:0;
  const targetPct=startEquity&&targetEquity?((targetEquity-startEquity)/startEquity)*100:0;
  const progressPct=targetPct>0?Math.max(0,Math.min(100,(profitPct/targetPct)*100)):0;
  return {
    campaignId,
    direction:lastStart.direction>0?'BUY':'SELL',
    signature:lastStart.signature||null,
    startedAt:lastStart.ts,
    startEquity,currentEquity,targetEquity,
    profitPct,targetPct,progressPct,
    layers:latest.layers??layerEvents.length,
    totalVolume,
    floatingPL:currentEquity-startEquity,
    asOf:latest.ts,
    layerDetail:layerEvents.map(e=>({layer:e.layer,volume:e.volume,marginPct:e.marginPct,price:e.price,reason:e.reason,ts:e.ts}))
  };
}
function buildHistory(events){
  const starts={};
  for(const e of events) if(e.type==='CAMPAIGN_START'&&e.campaignId) starts[e.campaignId]=e;
  return events.filter(e=>e.type==='CAMPAIGN_END').map(e=>{
    const start=starts[e.campaignId]||null;
    const startEquity=start?Number(start.equity??start.balance??0):null;
    const endEquity=Number(e.equity??e.balance??0);
    const profitPct=startEquity?((endEquity-startEquity)/startEquity)*100:null;
    return {
      campaignId:e.campaignId,
      direction:e.direction>0?'BUY':'SELL',
      signature:e.signature||null,
      startedAt:start?.ts||null,
      endedAt:e.ts,
      startEquity,endEquity,profitPct,
      layers:e.layers,
      outcome:e.outcome,
      outcomeLabel:e.outcome==='TARGET_HIT'?'TARGET HIT':e.outcome==='PROFIT_FLOOR_HIT'?'PROFIT PROTECTED':e.outcome==='MASTER_SL_BASKET_EXIT'?'STOP LOSS HIT':e.outcome==='MASTER_LEG_CLOSED'?'MASTER POSITION CLOSED':'BROKER/MARGIN STOP-OUT',
      reason:e.reason||null,
      mfe:e.mfe,mae:e.mae,durationSec:e.durationSec
    };
  }).reverse();
}
function settingsView(cfg){
  return {
    accountProfile:cfg.accountProfile,
    normalTargetProfitPct:cfg.normalTargetProfitPct,
    baseMarginPct:cfg.baseMarginPct,
    layerMultiplier:cfg.layerMultiplier,
    maxLayers:cfg.maxLayers,
    normalL1MarginPct:cfg.normalL1MarginPct,
    normalL2MarginPct:cfg.normalL2MarginPct,
    normalL3PlusMarginPct:cfg.normalL3PlusMarginPct,
    normalFixedSLGoldMove:cfg.normalFixedSLGoldMove,
    profitRatchetEnabled:cfg.profitRatchetEnabled,
    ratchetTriggerPct:cfg.ratchetTriggerPct,
    ratchetLockPct:cfg.ratchetLockPct,
    ratchetStepPct:cfg.ratchetStepPct,
    ratchetLockStepPct:cfg.ratchetLockStepPct,
    masterBreakEvenEnabled:cfg.masterBreakEvenEnabled,
    masterBreakEvenTriggerPct:cfg.masterBreakEvenTriggerPct,
    recoveryExitEnabled:cfg.recoveryExitEnabled,
    recoveryExitArmPctOfSL:cfg.recoveryExitArmPctOfSL,
    advanced:{
      entryScore:cfg.entryScore,addScore:cfg.addScore,impulseAtr:cfg.impulseAtr,sweepAtr:cfg.sweepAtr,
      rejectionBars:cfg.rejectionBars,watchExpiryMinutes:cfg.watchExpiryMinutes,rejectionZoneAtr:cfg.rejectionZoneAtr,
      addSpacingAtr:cfg.addSpacingAtr,requireM3Confirm:cfg.requireM3Confirm,requireM5Context:cfg.requireM5Context
    }
  };
}
async function buildMe(licenseKey){
  const licenses=await readLicenses();
  const lic=licenses[licenseKey];
  const status=licenseStatusFor(lic);
  const baseLicense={key:licenseKey,status,account:lic?.account||null,accountProfile:lic?.accountProfile||null,expiresAt:lic?.expiresAt||null,customer:lic?.customer||null};
  if(status!=='ACTIVE')return {license:baseLicense,dataAvailable:false};

  // The saved/effective-default config is always visible to an ACTIVE license, even before
  // the EA has ever made contact — settings must never depend on live EA data to render.
  const cfg=clean(await read(CONFIG,DEFAULT));
  const settings=settingsView(cfg);
  const state=await read(STATE,{});
  const allEv=await allEvents();
  const events=lic.account?allEv.filter(e=>String(e.account)===String(lic.account)):allEv;
  const latest=events[events.length-1]||null;

  if(lic.account&&!latest){
    return {license:baseLicense,dataAvailable:false,mt5:{status:'DISCONNECTED',lastSeen:null},waitingForFirstContact:true,settings};
  }
  if(!lic.account){
    return {license:baseLicense,dataAvailable:false,mt5:{status:'DISCONNECTED',lastSeen:null},waitingForFirstContact:true,settings};
  }

  const mt5Status=classifyMt5(state.lastSeen);
  const campaign=findActiveCampaign(events);
  const history=buildHistory(events).slice(0,50);
  const learning=learn(events,cfg);
  const recentHuman=events.slice(-60).reverse().map(e=>({ts:e.ts,type:e.type,text:humanEvent(e)})).filter(e=>e.text!==null).slice(0,30);

  return {
    license:baseLicense,
    dataAvailable:true,
    armed:cfg.armed,
    accountProfile:cfg.accountProfile,
    mt5:{status:mt5Status,lastSeen:state.lastSeen||null},
    account:latest?{account:latest.account,broker:latest.broker||null,currency:latest.currency||null,balance:latest.balance,equity:latest.equity,freeMargin:latest.freeMargin,asOf:latest.ts}:null,
    campaign,
    history,
    learning,
    recentHuman,
    effectiveConfig:latest?{
      l1MarginPct:latest.l1MarginPct,
      l2MarginPct:latest.l2MarginPct,
      l3PlusMarginPct:latest.l3PlusMarginPct,
      takeProfitPct:latest.takeProfitPct,
      fixedSLGoldMove:latest.fixedSLGoldMove,
      beEnabled:latest.beEnabled,
      beTriggerPct:latest.beTriggerPct,
      recoveryExitEnabled:latest.recoveryExitEnabled,
      recoveryArmPctOfSL:latest.recoveryArmPctOfSL,
      ratchetEnabled:latest.ratchetEnabled,
      ratchetTriggerPct:latest.ratchetTriggerPct,
      ratchetLockPct:latest.ratchetLockPct,
      ratchetStepPct:latest.ratchetStepPct,
      ratchetLockStepPct:latest.ratchetLockStepPct,
      configSource:latest.configSource||null,
      eaVersion:latest.eaVersion||null,
      asOf:latest.ts
    }:null,
    settings
  };
}
async function writeConfigMerge(partial){
  for(const f of OBSOLETE_FIELDS) delete partial[f];
  const current=clean(await read(CONFIG,DEFAULT));
  const cfg=clean({...current,...partial});
  await atomic(CONFIG,cfg);
  await event({type:'CONFIG',config:cfg});
  return cfg;
}

const server=http.createServer(async(req,res)=>{
  try{
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('X-Frame-Options','DENY');
    res.setHeader('Referrer-Policy','no-referrer');

    const u=new URL(req.url,'http://localhost');

    if(u.pathname==='/health')
      return json(res,200,{ok:true,service:'xaucloud-apex',version:'3.5.1'});

    // ---------- EA contract ----------
    if(req.method==='GET'&&u.pathname==='/api/ea/config'){
      if(!auth(req,EA_TOKEN))return json(res,401,{error:'unauthorized'});
      const cfg=clean(await read(CONFIG,DEFAULT));
      const account=u.searchParams.get('account')||'0';
      if(cfg.account!=='0'&&cfg.account!==account)return json(res,403,{error:'account_not_allowed'});
      const licenseKey=u.searchParams.get('license')||'';
      const lic=await checkEaLicense(licenseKey,account);
      const st=await read(STATE,{});
      st.lastSeen=new Date().toISOString();
      atomic(STATE,st).catch(()=>{});
      const out={...cfg,learning:learn(await allEvents(),cfg),licenseStatus:lic.ok?'ACTIVE':lic.code};
      if(!lic.ok)out.armed=false;
      return json(res,200,out);
    }

    if(req.method==='POST'&&u.pathname==='/api/ea/event'){
      if(!auth(req,EA_TOKEN))return json(res,401,{error:'unauthorized'});
      const b=await body(req);
      await event({type:String(b.type||'EA_EVENT'),...b});
      const st=await read(STATE,{});
      st.updatedAt=new Date().toISOString();
      st.lastSeen=st.updatedAt;
      st.lastEA=b;
      await atomic(STATE,st);
      return json(res,200,{ok:true});
    }

    // ---------- admin (raw debug + license issuance) ----------
    if(req.method==='GET'&&u.pathname==='/api/admin/status'){
      if(!adminAuthOk(req))return json(res,401,{error:'unauthorized'});
      const cfg=clean(await read(CONFIG,DEFAULT)),events=await allEvents(),state=await read(STATE,{});
      return json(res,200,publicState(cfg,state,learn(events,cfg),events.slice().reverse()));
    }

    if(req.method==='POST'&&u.pathname==='/api/admin/config'){
      if(!adminAuthOk(req))return json(res,401,{error:'unauthorized'});
      const incoming=await body(req);
      const cfg=await writeConfigMerge(incoming);
      return json(res,200,{ok:true,config:cfg});
    }

    if(req.method==='GET'&&u.pathname==='/api/admin/licenses'){
      if(!adminAuthOk(req))return json(res,401,{error:'unauthorized'});
      const licenses=await readLicenses();
      return json(res,200,{licenses:Object.entries(licenses).map(([key,l])=>({key,...l,status:licenseStatusFor(l)}))});
    }

    if(req.method==='POST'&&u.pathname==='/api/admin/licenses'){
      if(!adminAuthOk(req))return json(res,401,{error:'unauthorized'});
      const b=await body(req);
      const licenses=await readLicenses();
      const key=b.key&&licenses[b.key]?b.key:(b.key||genLicenseKey());
      const existing=licenses[key]||{};
      const now=new Date().toISOString();
      const rec={
        status:['ACTIVE','DISABLED'].includes(b.status)?b.status:(existing.status||'ACTIVE'),
        account:b.account!==undefined?String(b.account||''):(existing.account||''),
        accountProfile:['NORMAL','UNLIMITED'].includes(b.accountProfile)?b.accountProfile:(existing.accountProfile||'NORMAL'),
        expiresAt:b.expiresAt!==undefined?(b.expiresAt||null):(existing.expiresAt||null),
        customer:b.customer!==undefined?String(b.customer||''):(existing.customer||''),
        createdAt:existing.createdAt||now,
        updatedAt:now
      };
      licenses[key]=rec;
      await writeLicenses(licenses);
      return json(res,200,{ok:true,license:{key,...rec,status:licenseStatusFor(rec)}});
    }

    // ---------- license auth (public user login) ----------
    if(req.method==='POST'&&u.pathname==='/api/auth/login'){
      const ip=clientIp(req);
      if(rateLimited(ip))return json(res,429,{error:'too_many_attempts'});
      const b=await body(req);
      const licenseKey=String(b.license||'').trim().toUpperCase();
      if(!licenseKey)return json(res,400,{error:'license_required'});
      const licenses=await readLicenses();
      const lic=licenses[licenseKey];
      const status=licenseStatusFor(lic);
      if(status!=='ACTIVE')return json(res,401,{error:status});
      setSessionCookie(res,makeSession(licenseKey));
      return json(res,200,{ok:true});
    }

    if(req.method==='POST'&&u.pathname==='/api/auth/logout'){
      clearSessionCookie(res);
      return json(res,200,{ok:true});
    }

    if(req.method==='GET'&&u.pathname==='/api/auth/me'){
      const cookies=parseCookies(req);
      const session=verifySession(cookies.apex_session);
      if(!session)return json(res,401,{error:'no_session'});
      return json(res,200,await buildMe(session.lic));
    }

    if(req.method==='POST'&&u.pathname==='/api/session/config'){
      const cookies=parseCookies(req);
      const session=verifySession(cookies.apex_session);
      if(!session)return json(res,401,{error:'no_session'});
      const licenses=await readLicenses();
      const lic=licenses[session.lic];
      if(licenseStatusFor(lic)!=='ACTIVE')return json(res,403,{error:'license_not_active'});
      const b=await body(req);
      const cfg=await writeConfigMerge(b);
      return json(res,200,{ok:true,config:cfg});
    }

    // ---------- static shell ----------
    if(req.method==='GET'&&u.pathname==='/'){
      const html=await fs.readFile(path.join(__dirname,'public','index.html'));
      res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});
      return res.end(html);
    }

    return json(res,404,{error:'not_found'});
  }catch(e){
    if(e&&e.httpStatus)return json(res,e.httpStatus,{error:e.message});
    console.error(e);
    return json(res,500,{error:'internal_error'});
  }
});

await fs.mkdir(DATA,{recursive:true});
if(process.env.NODE_ENV!=='test'){
  await ensure();
  server.listen(PORT,'0.0.0.0',()=>console.log(`XauCloud Apex listening on 0.0.0.0:${PORT}`));
}
export{server};
