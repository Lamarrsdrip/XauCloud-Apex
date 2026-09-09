import http from 'node:http';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createNotificationEngine } from './notifications.mjs';
import { resolvePersistentDataDir, preparePersistentRuntimeData } from './runtime-data.mjs';
import { fileURLToPath } from 'node:url';

const __dirname=path.dirname(fileURLToPath(import.meta.url));
const MANIFEST=JSON.parse(fsSync.readFileSync(path.join(__dirname,'version.json'),'utf8'));
const CONFIG_SCHEMA=Number(MANIFEST.configSchema||2);
const PORT=Number(process.env.PORT||8787);
const IS_PRODUCTION=process.env.NODE_ENV==='production';

// APEX-AUDIT-024: the public fallback strings are accepted ONLY outside production.
// A production process refuses to start without real, sufficiently long secrets.
const DEFAULT_ADMIN_TOKEN='change-me-admin';
const DEFAULT_SESSION_SECRET='change-me-session-secret';
const ADMIN_TOKEN=process.env.ADMIN_TOKEN||DEFAULT_ADMIN_TOKEN;
const SESSION_SECRET=process.env.SESSION_SECRET||DEFAULT_SESSION_SECRET;
export function secretProblems(env=process.env){
  const problems=[];
  const admin=String(env.ADMIN_TOKEN||'');
  const session=String(env.SESSION_SECRET||'');
  if(!admin)problems.push('ADMIN_TOKEN_MISSING');
  else if(admin===DEFAULT_ADMIN_TOKEN)problems.push('ADMIN_TOKEN_IS_THE_PUBLISHED_DEFAULT');
  else if(admin.length<24)problems.push('ADMIN_TOKEN_TOO_SHORT_MIN_24');
  if(!session)problems.push('SESSION_SECRET_MISSING');
  else if(session===DEFAULT_SESSION_SECRET)problems.push('SESSION_SECRET_IS_THE_PUBLISHED_DEFAULT');
  else if(session.length<32)problems.push('SESSION_SECRET_TOO_SHORT_MIN_32');
  if(String(env.XAUCLOUD_BASE_URL||'').startsWith('http://'))problems.push('XAUCLOUD_BASE_URL_NOT_HTTPS');
  return problems;
}
export function assertProductionSecrets(env=process.env){
  if(env.NODE_ENV!=='production')return [];
  const problems=secretProblems(env);
  if(problems.length){
    // Never print the values themselves -- only which variable is unacceptable.
    throw Object.assign(new Error('INSECURE_PRODUCTION_CONFIGURATION: '+problems.join(', ')),{httpStatus:500,problems});
  }
  return [];
}

export function canonicalizeTimestamp(value, fallback=new Date()){
  const fb=fallback instanceof Date?fallback:new Date(fallback);
  const iso=()=>fb.toISOString();
  if(value==null||value==='') return iso();
  if(typeof value==='number' && Number.isFinite(value)){
    const ms=value>0 && value<1e12?value*1000:value;
    const d=new Date(ms);
    return Number.isNaN(d.getTime())?iso():d.toISOString();
  }
  const s=String(value).trim();
  if(/^-?\d+(\.\d+)?$/.test(s)){
    const n=Number(s);
    const ms=n>0 && n<1e12?n*1000:n;
    const d=new Date(ms);
    return Number.isNaN(d.getTime())?iso():d.toISOString();
  }
  const d=new Date(s);
  return Number.isNaN(d.getTime())?iso():d.toISOString();
}

export function classifyConfigDelivery(delivery, configured){
  const localSaved=true;
  if(!configured) return {status:'BRIDGE_NOT_CONFIGURED',queued:false,localSaved};
  if(delivery==null) return {status:'BRIDGE_NOT_CONFIGURED',queued:false,localSaved};
  if(delivery.queued) return {status:'QUEUED_FOR_BRIDGE',queued:true,localSaved,reason:delivery.reason||null};
  if(delivery.ok===false) return {status:'BRIDGE_FAILED',queued:false,localSaved,reason:delivery.reason||delivery.error||null};
  return {status:'BRIDGE_DELIVERED',queued:false,localSaved};
}

export function licenseAllowsUnlimited(lic){
  if(!lic) return false;
  if(lic.unlimitedEntitled===true) return true;
  const tier=String(lic.licenseTier||'').toUpperCase();
  if(tier==='UNLIMITED') return true;
  // Historical admin-created licenses stored the entitlement on the LICENSE record
  // as accountProfile, before licenseTier existed. Customer config is NOT this field.
  if(!lic.licenseTier && String(lic.accountProfile||'').toUpperCase()==='UNLIMITED') return true;
  return false;
}

export function numOrNull(v){
  if(v===null||v===undefined||v==='') return null;
  const n=typeof v==='number'?v:Number(v);
  return Number.isFinite(n)?n:null;
}

const SESSION_TTL_DAYS=Math.max(1,Number(process.env.SESSION_TTL_DAYS||3650));
const SESSION_TTL_MS=SESSION_TTL_DAYS*24*60*60*1000;
const LEGACY_DATA=path.join(__dirname,'data');
const DATA=resolvePersistentDataDir({legacyDataDir:LEGACY_DATA,env:process.env,isProduction:process.env.NODE_ENV!=='test'});
const CONFIG=path.join(DATA,'config.json');
const LICENSE_CONFIGS=path.join(DATA,'license-configs.json');
const EVENTS=path.join(DATA,'events.ndjson');
const LICENSES=path.join(DATA,'licenses.json');
const OUTBOX=path.join(DATA,'bridge-outbox.ndjson');
const MANAGER_LEASES=path.join(DATA,'manager-leases.json');
const APEX_PUBLIC_ORIGIN=String(process.env.APEX_PUBLIC_ORIGIN||'https://apex.xaucloud.io').trim().replace(/\/+$/,'');
const NOTIFICATIONS=createNotificationEngine({dataDir:DATA,origin:APEX_PUBLIC_ORIGIN,logger:console});
const XAUCLOUD_BASE_URL=String(process.env.XAUCLOUD_BASE_URL||'https://xaucloud.io').trim().replace(/\/+$/,'');
const APEX_BRIDGE_SECRET=String(process.env.APEX_BRIDGE_SECRET||'');
// APEX-AUDIT-021: every remote call is deadline-bounded.
const BRIDGE_TIMEOUT_MS=Number(process.env.APEX_BRIDGE_TIMEOUT_MS||4000);

//======================= configuration schema =========================
// APEX-AUDIT-019: ONE typed allowlist. Anything not named here is not configuration.
// Server-derived identity (licenseStatus, commandRevision, configHash, schema) lives
// OUTSIDE this namespace and is attached to the response envelope afterwards, so a
// stored config can never overwrite it.
const SCHEMA={
  armed:{t:'bool',d:false},
  account:{t:'str',d:'0',max:64},
  symbolContains:{t:'str',d:'XAUUSD',max:32},
  targetMode:{t:'enum',d:'MULTIPLIER',values:['MULTIPLIER','EQUITY']},
  accountProfile:{t:'enum',d:'NORMAL',values:['NORMAL','UNLIMITED']},
  targetEquity:{t:'num',d:1000,min:.01,max:1e12},
  targetMultiplier:{t:'num',d:100,min:1.001,max:1e9},
  normalTargetProfitPct:{t:'num',d:0,min:0,max:1e6},
  baseMarginPct:{t:'num',d:100,min:.01,max:100},
  layerMultiplier:{t:'num',d:2,min:1,max:10},
  maxLayers:{t:'int',d:0,min:0,max:50},
  normalL1MarginPct:{t:'num',d:15,min:.01,max:100},
  normalL2MarginPct:{t:'num',d:50,min:.01,max:100},
  normalL3PlusMarginPct:{t:'num',d:100,min:.01,max:100},
  normalFixedSLGoldMove:{t:'num',d:30,min:0,max:1e6},
  // 0 = AUTO. Only legal while the broker's own margin model is trustworthy. When the
  // terminal reports a pathological model (e.g. 1:2000000000 with marginAt1Lot=0) the EA
  // refuses to size until this is set, rather than guessing a leverage.
  normalReferenceLeverage:{t:'int',d:0,min:0,max:1000000},
  profitRatchetEnabled:{t:'bool',d:true},
  ratchetTriggerPct:{t:'num',d:180,min:.01,max:1e6},
  ratchetLockPct:{t:'num',d:100,min:0,max:1e6},
  ratchetStepPct:{t:'num',d:100,min:.01,max:1e6},
  ratchetLockStepPct:{t:'num',d:100,min:0,max:1e6},
  masterBreakEvenEnabled:{t:'bool',d:true},
  masterBreakEvenTriggerPct:{t:'num',d:50,min:.01,max:1e6},
  recoveryExitEnabled:{t:'bool',d:true},
  recoveryExitArmPctOfSL:{t:'num',d:40,min:.01,max:1e6},
  // APEX-AUDIT-014 owner exposure controls. 0 = disabled = v3.7.1 behaviour.
  // No value is chosen here: OWNER DECISION REQUIRED before any of these do anything.
  maxBasketLots:{t:'num',d:0,min:0,max:1e6},
  minMarginLevelPct:{t:'num',d:0,min:0,max:1e6},
  marginReservePct:{t:'num',d:0,min:0,max:99},
  entryScore:{t:'num',d:76,min:40,max:100},
  addScore:{t:'num',d:70,min:40,max:100},
  impulseAtr:{t:'num',d:1.8,min:.5,max:10},
  sweepAtr:{t:'num',d:.05,min:0,max:2},
  rejectionBars:{t:'int',d:5,min:1,max:12},
  watchExpiryMinutes:{t:'int',d:12,min:2,max:60},
  addSpacingAtr:{t:'num',d:.22,min:.02,max:5},
  rejectionZoneAtr:{t:'num',d:.12,min:.02,max:2},
  requireM3Confirm:{t:'bool',d:true},
  requireM5Context:{t:'bool',d:false},
  cooldownMinutes:{t:'int',d:0,min:0,max:1440},
  learningEnabled:{t:'bool',d:true},
  learningMinCampaigns:{t:'int',d:8,min:4,max:200},
  learningMaxScoreAdjustment:{t:'num',d:5,min:0,max:15}
};
export const DEFAULT=Object.fromEntries(Object.entries(SCHEMA).map(([k,s])=>[k,s.d]));
export const CONFIG_FIELDS=Object.keys(SCHEMA);

function numeric(v){
  if(typeof v==='number')return Number.isFinite(v)?v:null;
  if(typeof v==='string'&&v.trim()!==''){const n=Number(v.trim());return Number.isFinite(n)?n:null}
  return null;
}
// Strict field validation. Returns {value} or {error}.
function validateField(key,raw){
  const s=SCHEMA[key];
  if(!s)return {error:'unknown_field'};
  if(s.t==='bool'){
    // APEX-AUDIT-019: Boolean('false') === true was the defect. Only a real boolean counts.
    if(typeof raw==='boolean')return {value:raw};
    return {error:'expected_boolean'};
  }
  if(s.t==='str'){
    if(typeof raw!=='string')return {error:'expected_string'};
    return {value:raw.slice(0,s.max||256)};
  }
  if(s.t==='enum'){
    if(typeof raw!=='string')return {error:'expected_string'};
    if(!s.values.includes(raw))return {error:'not_in_enum:'+s.values.join('|')};
    return {value:raw};
  }
  const n=numeric(raw);
  if(n===null)return {error:'expected_number'};
  if(n<s.min||n>s.max)return {error:`out_of_range_${s.min}_${s.max}`};
  return {value:s.t==='int'?Math.round(n):n};
}
function crossFieldErrors(cfg){
  const errors=[];
  if(cfg.profitRatchetEnabled&&cfg.ratchetLockPct>cfg.ratchetTriggerPct)
    errors.push({field:'ratchetLockPct',error:'lock_exceeds_trigger'});
  if(cfg.targetMode==='EQUITY'&&!(cfg.targetEquity>0))
    errors.push({field:'targetEquity',error:'required_for_equity_target_mode'});
  return errors;
}
// STRICT validator used by every write path. Unknown keys and wrong types are refused.
export function validateConfig(patch={},base=DEFAULT){
  const errors=[];
  const next={...DEFAULT,...base};
  for(const [k,v] of Object.entries(patch||{})){
    const r=validateField(k,v);
    if(r.error)errors.push({field:k,error:r.error});
    else next[k]=r.value;
  }
  for(const e of crossFieldErrors(next))errors.push(e);
  return {ok:errors.length===0,errors,config:next};
}
// LENIENT normaliser for reading stored/legacy data. Drops unknown keys, refuses
// non-boolean booleans, clamps numbers, and repairs the lock>trigger inconsistency.
export function clean(x={}){
  const out={};
  for(const [k,s] of Object.entries(SCHEMA)){
    if(!(k in (x||{}))){out[k]=s.d;continue}
    const r=validateField(k,x[k]);
    if(r.error){
      if(s.t==='num'||s.t==='int'){
        const n=numeric(x[k]);
        out[k]=n===null?s.d:(s.t==='int'?Math.round(Math.max(s.min,Math.min(s.max,n))):Math.max(s.min,Math.min(s.max,n)));
      }else out[k]=s.d;
    }else out[k]=r.value;
  }
  if(out.profitRatchetEnabled&&out.ratchetLockPct>out.ratchetTriggerPct)out.ratchetLockPct=out.ratchetTriggerPct;
  return out;
}
export function configHash(cfg){
  const canonical=CONFIG_FIELDS.map(k=>`${k}=${cfg[k]}`).join('|');
  return crypto.createHash('sha256').update(canonical).digest('hex').slice(0,16);
}

//======================= durable storage ==============================
// APEX-AUDIT-020: unique temp names (never pid+ms, which two workers can collide on),
// and a missing file is distinguished from a corrupt one -- corruption is an explicit
// failure, never a silent "empty database".
async function atomic(file,obj){
  await fs.mkdir(path.dirname(file),{recursive:true});
  const tmp=`${file}.tmp-${process.pid}-${crypto.randomUUID()}`;
  await fs.writeFile(tmp,JSON.stringify(obj,null,2));
  await fs.rename(tmp,file);
}
async function readJson(file,fallback){
  let raw;
  try{raw=await fs.readFile(file,'utf8')}
  catch(e){
    if(e&&e.code==='ENOENT')return fallback;
    throw Object.assign(new Error('STORAGE_UNREADABLE:'+path.basename(file)),{httpStatus:500,cause:String(e?.code||e)});
  }
  if(raw.trim()==='')return fallback;
  try{return JSON.parse(raw)}
  catch{throw Object.assign(new Error('STORAGE_CORRUPT:'+path.basename(file)),{httpStatus:500})}
}
async function migrateLegacyData(){
  if(path.resolve(DATA)===path.resolve(LEGACY_DATA))return;
  await fs.mkdir(DATA,{recursive:true});
  const names=['config.json','license-configs.json','licenses.json','events.ndjson','bridge-outbox.ndjson'];
  for(const name of names){
    const src=path.join(LEGACY_DATA,name),dst=path.join(DATA,name);
    try{await fs.access(dst);continue}catch{}
    try{
      await fs.copyFile(src,dst,fsSync.constants.COPYFILE_EXCL);
      console.log(`APEX_DATA_MIGRATED ${name} -> ${DATA}`);
    }catch(e){
      if(e?.code!=='ENOENT'&&e?.code!=='EEXIST')throw e;
    }
  }
}
async function ensure(){
  // Production identity/config data is prepared in persistent storage BEFORE normal startup.
  // Existing persistent licenses always win merge conflicts; no release can seed over them.
  await preparePersistentRuntimeData({dataDir:DATA,legacyDataDir:LEGACY_DATA,logger:console});
  await migrateLegacyData();
  await fs.mkdir(DATA,{recursive:true});
  try{await fs.access(CONFIG)}catch{await atomic(CONFIG,DEFAULT)}
  try{await fs.access(LICENSES)}catch{await atomic(LICENSES,{})}
  try{await fs.access(LICENSE_CONFIGS)}catch{await atomic(LICENSE_CONFIGS,{})}
}

// Single-process serialisation of read-modify-write per license (APEX-AUDIT-020).
const locks=new Map();
async function withLock(key,fn){
  const prev=locks.get(key)||Promise.resolve();
  let release;
  const next=new Promise(r=>{release=r});
  const chain=prev.then(()=>next);
  locks.set(key,chain);
  await prev;
  try{return await fn()}
  finally{release();if(locks.get(key)===chain)locks.delete(key)}
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
export function normalizeLicense(v){return String(v||'').trim().toUpperCase().replace(/ /g,'')}

// APEX-AUDIT-024: authentication throttling. Per-IP, in-memory, no credential logging.
const attempts=new Map();
function throttle(scope,ip,limit=20,windowMs=60_000){
  const k=scope+'|'+ip,now=Date.now();
  const rec=attempts.get(k)||{n:0,reset:now+windowMs};
  if(now>rec.reset){rec.n=0;rec.reset=now+windowMs}
  rec.n++;attempts.set(k,rec);
  return rec.n<=limit;
}

export function licenseStatusFor(lic,now=Date.now()){
  if(!lic)return 'LICENSE_NOT_FOUND';
  if(lic.status==='DISABLED')return 'LICENSE_DISABLED';
  // APEX-AUDIT-022: expiry is evaluated on EVERY request against server time, so a
  // license that crosses its expiry mid-session is denied without needing a restart.
  if(lic.expiresAt&&now>Date.parse(lic.expiresAt))return 'LICENSE_EXPIRED';
  return lic.status==='ACTIVE'?'ACTIVE':'LICENSE_DISABLED';
}
async function readLicenses(){return readJson(LICENSES,{})}
async function writeLicenses(x){await atomic(LICENSES,x)}
async function readLicenseConfigs(){return readJson(LICENSE_CONFIGS,{})}
async function getLicenseConfig(key){
  const all=await readLicenseConfigs();
  const global=clean(await readJson(CONFIG,DEFAULT));
  return clean({...global,...(all[key]||{})});
}

//======================= bridge outbox ================================
// APEX-AUDIT-020/021: the local commit happens FIRST, then the remote delivery is
// queued durably with an idempotency key. A process kill between the two no longer
// loses an acknowledged update, and the HTTP request never waits on the remote.
let outboxDraining=false;
async function outboxAppend(entry){
  await fs.mkdir(DATA,{recursive:true});
  await fs.appendFile(OUTBOX,JSON.stringify({id:crypto.randomUUID(),queuedAt:new Date().toISOString(),attempts:0,...entry})+'\n');
}
async function outboxRead(){
  try{
    return (await fs.readFile(OUTBOX,'utf8')).trim().split('\n').filter(Boolean)
      .map(l=>{try{return JSON.parse(l)}catch{return null}}).filter(Boolean);
  }catch(e){if(e&&e.code==='ENOENT')return [];throw e}
}
async function outboxRewrite(entries){
  const tmp=`${OUTBOX}.tmp-${process.pid}-${crypto.randomUUID()}`;
  await fs.writeFile(tmp,entries.map(e=>JSON.stringify(e)).join('\n')+(entries.length?'\n':''));
  await fs.rename(tmp,OUTBOX);
}
export async function drainOutbox({max=50}={}){
  if(outboxDraining)return {drained:0,pending:null,skipped:'already_draining'};
  outboxDraining=true;
  try{
    const entries=await outboxRead();
    if(!entries.length)return {drained:0,pending:0};
    if(!bridgeConfigured())return {drained:0,pending:entries.length,reason:'BRIDGE_NOT_CONFIGURED'};
    const keep=[];let drained=0;
    for(const e of entries){
      if(drained>=max){keep.push(e);continue}
      try{
        await bridgeRequest(e.route,{method:'POST',payload:e.payload,idempotencyKey:e.id});
        drained++;
      }catch(err){
        keep.push({...e,attempts:Number(e.attempts||0)+1,lastError:String(err?.message||err)});
      }
    }
    await outboxRewrite(keep);
    return {drained,pending:keep.length};
  }finally{outboxDraining=false}
}

//======================= bridge transport =============================
function bridgeConfigured(){return Boolean(XAUCLOUD_BASE_URL&&APEX_BRIDGE_SECRET)}
function bridgeFailure(message,status=502,detail=null){
  return Object.assign(new Error(message),{httpStatus:status,detail});
}
async function bridgeRequest(route,{method='GET',payload,idempotencyKey,timeoutMs=BRIDGE_TIMEOUT_MS}={}){
  if(!APEX_BRIDGE_SECRET)throw bridgeFailure('APEX_BRIDGE_SECRET_NOT_CONFIGURED',503);
  let response;
  const headers={'accept':'application/json','content-type':'application/json','x-apex-bridge-secret':APEX_BRIDGE_SECRET};
  if(idempotencyKey)headers['x-apex-idempotency-key']=String(idempotencyKey);
  try{
    response=await fetch(XAUCLOUD_BASE_URL+route,{
      method,headers,
      body:payload===undefined?undefined:JSON.stringify(payload),
      signal:AbortSignal.timeout(timeoutMs)          // APEX-AUDIT-021: bounded deadline
    });
  }catch(e){
    const timedOut=e&&(e.name==='TimeoutError'||e.name==='AbortError');
    throw bridgeFailure(timedOut?'XAUCLOUD_BRIDGE_TIMEOUT':'XAUCLOUD_BRIDGE_UNREACHABLE',504,{message:String(e?.message||e),timeoutMs});
  }
  const text=await response.text();
  let data;
  try{data=text?JSON.parse(text):{}}catch{throw bridgeFailure('XAUCLOUD_BRIDGE_NON_JSON_RESPONSE',502,{status:response.status})}
  if(!response.ok||data?.ok===false){
    throw bridgeFailure(String(data?.error||'XAUCLOUD_BRIDGE_REQUEST_FAILED'),response.status>=400?response.status:502,data);
  }
  return data;
}
async function syncBridgeLicense(key,lic,{resetAccount=false,queueOnFailure=false}={}){
  if(!bridgeConfigured())return null;
  const payload={
    license:normalizeLicense(key),active:licenseStatusFor(lic)==='ACTIVE',account:String(lic?.account||''),
    customer:String(lic?.customer||''),expiresAt:lic?.expiresAt??null,resetAccount:Boolean(resetAccount)
  };
  try{return await bridgeRequest('/api/cloud/apex/bridge/license/upsert',{method:'POST',payload})}
  catch(e){
    if(!queueOnFailure)throw e;
    await outboxAppend({route:'/api/cloud/apex/bridge/license/upsert',payload,kind:'license',license:normalizeLicense(key)});
    return {queued:true,reason:String(e?.message||e)};
  }
}
async function syncBridgeConfig(key,config,commandRevision=0,{queueOnFailure=false,extra={}}={}){
  if(!bridgeConfigured())return null;
  const leases=await readJson(MANAGER_LEASES,{}).catch(()=>({}));
  const lease=leases[normalizeLicense(key)]||null;
  const payload={
    license:normalizeLicense(key),
    config:{
      ...clean(config),
      ...(lease?{
        managerInstanceId:lease.instanceId,
        managerGeneration:lease.generation,
        managerLeaseUntil:Math.floor(lease.expiresAt/1000),
        managerAccount:lease.account||'',
        managerSymbol:lease.symbol||'',
        managerMagic:lease.magic||0
      }:{}),
      ...extra
    },
    commandRevision:Number(commandRevision||0)
  };
  try{return await bridgeRequest('/api/cloud/apex/bridge/config/upsert',{method:'POST',payload})}
  catch(e){
    if(!queueOnFailure)throw e;
    await outboxAppend({route:'/api/cloud/apex/bridge/config/upsert',payload,kind:'config',license:normalizeLicense(key)});
    return {queued:true,reason:String(e?.message||e)};
  }
}

const MANAGER_LEASE_MS=45_000;
export function nextManagerLease(current,claim,now=Date.now()){
  const instanceId=String(claim?.instanceId||'').trim();
  if(!instanceId) return {lease:current||null,changed:false,reason:'NO_INSTANCE_ID'};
  if(current && current.instanceId===instanceId && current.expiresAt>now){
    return {lease:{...current,expiresAt:now+MANAGER_LEASE_MS,account:claim.account||current.account,symbol:claim.symbol||current.symbol,magic:claim.magic||current.magic,lastSeen:now},changed:true,reason:'REFRESH'};
  }
  if(current && current.instanceId!==instanceId && current.expiresAt>now){
    return {lease:current,changed:false,reason:'HELD_BY_OTHER'};
  }
  const generation=Number(current?.generation||0)+1;
  return {lease:{instanceId,generation,expiresAt:now+MANAGER_LEASE_MS,account:claim.account||'',symbol:claim.symbol||'',magic:claim.magic||0,lastSeen:now},changed:true,reason:current?'TAKEOVER_AFTER_EXPIRY':'GRANT'};
}

async function reconcileManagerLeases(){
  if(!bridgeConfigured())return {checked:0,updated:0,reason:'BRIDGE_NOT_CONFIGURED'};
  const licenses=await readLicenses();
  const leases=await readJson(MANAGER_LEASES,{});
  let checked=0,updated=0;
  for(const [rawKey,lic] of Object.entries(licenses)){
    if(licenseStatusFor(lic)!=='ACTIVE')continue;
    const key=normalizeLicense(rawKey);
    checked++;
    const st=await readBridgeStatusSafe(key);
    const hb=st.ok && st.data?.heartbeat && typeof st.data.heartbeat==='object'?st.data.heartbeat:null;
    const instanceId=String(hb?.instance_id||hb?.instanceId||lic.instanceId||'').trim();
    if(!instanceId)continue;
    const claim={
      instanceId,
      account:String(hb?.account_number||lic.lastAccount||lic.account||''),
      symbol:String(hb?.symbol||lic.symbol||''),
      magic:Number(hb?.magic||lic.magic||0)
    };
    const nxt=nextManagerLease(leases[key],claim,Date.now());
    if(!nxt.changed)continue;
    leases[key]=nxt.lease;
    updated++;
    await syncBridgeConfig(key,await getLicenseConfig(key),Number(lic.commandRevision||0),{queueOnFailure:true}).catch(()=>null);
  }
  if(updated) await atomic(MANAGER_LEASES,leases);
  return {checked,updated};
}
async function readBridgeStatus(key){
  return bridgeRequest('/api/cloud/apex/bridge/status?license='+encodeURIComponent(normalizeLicense(key)));
}
async function readBridgeStatusSafe(key){
  if(!bridgeConfigured())return {ok:false,reason:'BRIDGE_NOT_CONFIGURED',data:null};
  try{return {ok:true,reason:null,data:await readBridgeStatus(key)}}
  catch(e){return {ok:false,reason:String(e?.message||'BRIDGE_REQUEST_FAILED'),data:null}}
}

async function readBridgeLicenses(){return bridgeRequest('/api/cloud/apex/bridge/licenses');}
async function readBridgeEventPage(key,before='',limit=250){
  const q=new URLSearchParams({license:normalizeLicense(key),limit:String(limit)});if(before)q.set('before',before);
  return bridgeRequest('/api/cloud/apex/bridge/events?'+q.toString());
}
async function readBridgeEventsUntilKnown(key,known,{maxPages=20,limit=250}={}){
  if(!bridgeConfigured())return [];
  const out=[];let before='';
  for(let page=0;page<maxPages;page++){
    const r=await readBridgeEventPage(key,before,limit);const rows=Array.isArray(r?.events)?r.events:[];
    if(!rows.length)break;
    let hitKnown=false;
    for(const row of rows){const id=row.eventId||row.event_id||row.id||eventId(row);if(known?.has(id)){hitKnown=true;continue}out.push(row);}
    if(hitKnown||!r.nextBefore)break;before=String(r.nextBefore);
  }
  return out;
}
async function recoverLicensesFromBridge(){
  if(!bridgeConfigured())return {recovered:0,reason:'BRIDGE_NOT_CONFIGURED'};
  const remote=await readBridgeLicenses();const rows=Array.isArray(remote?.licenses)?remote.licenses:[];
  const licenses=await readLicenses();const configs=await readLicenseConfigs();let recovered=0;
  for(const row of rows){
    const key=normalizeLicense(row.license);if(!key)continue;
    const status=row.active===true?'ACTIVE':'DISABLED';
    if(!licenses[key]){
      licenses[key]={status,account:String(row.account||''),customer:String(row.customer||''),expiresAt:row.expiresAt??null,
        commandRevision:0,createdAt:row.createdAt||new Date().toISOString(),updatedAt:row.updatedAt||new Date().toISOString(),source:'XAUCLOUD_MONGO_RECOVERY'};
      recovered++;
    }else{
      licenses[key].status=status;licenses[key].account=String(row.account||licenses[key].account||'');
      if(row.expiresAt!==undefined)licenses[key].expiresAt=row.expiresAt;
    }
    const st=await readBridgeStatusSafe(key);
    if(st.ok&&st.data?.configExists){
      const remoteRev=Number(st.data.commandRevision||0),localRev=Number(licenses[key].commandRevision||0);
      if(remoteRev>=localRev){configs[key]=clean(st.data.config||{});licenses[key].commandRevision=remoteRev;licenses[key].configHash=configHash(configs[key]);}
    }
  }
  if(rows.length){await writeLicenses(licenses);await atomic(LICENSE_CONFIGS,configs);}
  return {recovered,total:rows.length};
}

// Server-side notification reconciler. The website does NOT need to be open.
// It consumes the same canonical XauCloud bridge events already produced by Apex 3.8.1.
let notificationBridgeBusy=false;
async function reconcileNotificationBridgeEvents(){
  if(notificationBridgeBusy)return {checked:0,events:0,skipped:'already_running'};
  notificationBridgeBusy=true;
  let checked=0,events=0;
  try{
    const licenses=await readLicenses();
    for(const [rawKey,lic] of Object.entries(licenses)){
      if(licenseStatusFor(lic)!=='ACTIVE')continue;
      const key=normalizeLicense(rawKey);
      if(!key)continue;
      checked++;
      const bridge=await readBridgeStatusSafe(key);
      if(!bridge.ok||!Array.isArray(bridge.data?.recentEvents))continue;
      const r=await NOTIFICATIONS.reconcileCanonicalEvents(key,bridge.data.recentEvents)
        .catch(e=>{console.error('APEX_PUSH_BRIDGE_EVENT_FAILED',String(e?.message||e));return {queued:0}});
      events+=Number(r?.queued||0);
    }
    return {checked,events};
  }finally{notificationBridgeBusy=false}
}

//======================= config persistence ===========================
// APEX-AUDIT-020: optimistic concurrency. A caller that read revision N and tries to
// write on top of revision N+1 is refused with 409 instead of silently clobbering.
async function saveLicenseConfig(key,partial,{bumpRevision=true,expectedRevision=null,strict=true}={}){
  return withLock('cfg:'+key,async()=>{
    const all=await readLicenseConfigs();
    const prev=await getLicenseConfig(key);
    const licenses=await readLicenses();
    const lic=licenses[key];
    if(!lic)throw Object.assign(new Error('license_not_found'),{httpStatus:404});
    if(partial && partial.accountProfile==='UNLIMITED' && !licenseAllowsUnlimited(lic))
      throw Object.assign(new Error('UNLIMITED_NOT_ENTITLED'),{httpStatus:403,
        detail:{licenseTier:lic.licenseTier||lic.accountProfile||'NORMAL'}});
    const currentRevision=Number(lic.commandRevision||0);
    if(expectedRevision!==null&&Number(expectedRevision)!==currentRevision)
      throw Object.assign(new Error('revision_conflict'),{httpStatus:409,detail:{expectedRevision:Number(expectedRevision),currentRevision}});

    const v=validateConfig(partial,prev);
    if(strict&&!v.ok)throw Object.assign(new Error('invalid_config'),{httpStatus:400,detail:{errors:v.errors}});
    const next=clean(v.config);
    if(next.accountProfile==='UNLIMITED' && !licenseAllowsUnlimited(lic)){
      if(partial && partial.accountProfile==='UNLIMITED')
        throw Object.assign(new Error('UNLIMITED_NOT_ENTITLED'),{httpStatus:403,
          detail:{licenseTier:lic.licenseTier||lic.accountProfile||'NORMAL'}});
      next.accountProfile='NORMAL';
    }
    const revision=bumpRevision?currentRevision+1:currentRevision;
    all[key]=next;

    // Local commit FIRST, remote delivery afterwards through the durable outbox.
    await atomic(LICENSE_CONFIGS,all);
    if(bumpRevision){
      lic.commandRevision=revision;
      lic.pendingCommand=next.armed?'ARM':'DISARM';
      lic.commandUpdatedAt=new Date().toISOString();
      lic.updatedAt=lic.commandUpdatedAt;
      lic.configHash=configHash(next);
      licenses[key]=lic;
      await writeLicenses(licenses);
    }
    const delivery=await syncBridgeConfig(key,next,revision,{queueOnFailure:true});
    return {config:next,revision,configHash:configHash(next),
      delivery:classifyConfigDelivery(delivery,bridgeConfigured())};
  });
}

//======================= startup reconciliation =======================
// APEX-AUDIT-021: this no longer gates `listen`. It is still exported and awaitable so
// an operator (and the test suite) can run it explicitly and see it fail loudly.
export const bridgeSyncState={status:'PENDING',startedAt:null,finishedAt:null,error:null,licenses:0,lastAttemptAt:null};

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
    remoteCommandRevision:Number(remote?.commandRevision||0),
    localCommandRevision:Number(lic?.commandRevision||0),
    localActive,remoteActive:remote?.license?.active===true,
    localAccount,remoteAccount
  };
}
export async function syncAllLicensesAtStartup(){
  bridgeSyncState.status='RUNNING';bridgeSyncState.startedAt=new Date().toISOString();
  bridgeSyncState.lastAttemptAt=bridgeSyncState.startedAt;bridgeSyncState.error=null;
  try{
    if(!bridgeConfigured())throw bridgeFailure('APEX_BRIDGE_SECRET_NOT_CONFIGURED',503);
    // Best-effort ONLY. Recovery rebuilds the local cache from Mongo after a Hostinger
    // redeploy, but it must never be able to stop Apex from starting: a XauCloud that
    // has not yet deployed /bridge/licenses answers 404, and an older Apex release must
    // still boot against it. Losing recovery degrades to "start from the local cache".
    const recovery=await recoverLicensesFromBridge()
      .catch(e=>({recovered:0,reason:String(e?.message||e)}));
    if(recovery?.reason&&recovery.reason!=='BRIDGE_NOT_CONFIGURED')
      console.error(`APEX_LICENSE_RECOVERY_SKIPPED reason=${recovery.reason}`);
    else if(recovery?.recovered)
      console.log(`APEX_LICENSE_RECOVERY_OK recovered=${recovery.recovered} of=${recovery.total}`);
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
    bridgeSyncState.licenses=Object.keys(licenses).length;
    bridgeSyncState.status='OK';bridgeSyncState.finishedAt=new Date().toISOString();
    console.log(`APEX_BRIDGE_STARTUP_OK licenses=${bridgeSyncState.licenses}`);
    return bridgeSyncState;
  }catch(e){
    bridgeSyncState.status='ERROR';bridgeSyncState.finishedAt=new Date().toISOString();
    bridgeSyncState.error=String(e?.message||e);
    throw e;
  }
}

//======================= EA authentication ============================
// APEX-AUDIT-022: ONE binding policy for every EA-facing route (canonical and legacy).
// Expiry is checked here on every request; the first non-empty account atomically
// claims an unbound license, and every later request must match it exactly.
async function validateEa(licenseKey,account,{claim=true}={}){
  const key=normalizeLicense(licenseKey),accountS=String(account||'').trim();
  return withLock('lic:'+key,async()=>{
    const licenses=await readLicenses();
    const lic=licenses[key];
    const status=licenseStatusFor(lic);
    if(status!=='ACTIVE')return {ok:false,status,key,licenses};
    const bound=String(lic.account||'').trim();
    if(bound){
      if(!accountS)return {ok:false,status:'ACCOUNT_REQUIRED',key,licenses};
      if(bound!==accountS)return {ok:false,status:'ACCOUNT_MISMATCH',key,licenses};
      return {ok:true,status:'ACTIVE',key,lic,licenses};
    }
    // Unbound: atomic first-claim inside the per-license lock (matches the canonical
    // XauCloud resolveMonitorLicense semantics -- a blank account no longer silently
    // lets an unlimited number of different MT5 accounts share one license).
    if(!accountS)return {ok:false,status:'ACCOUNT_REQUIRED',key,licenses};
    if(claim){
      lic.account=accountS;
      lic.activatedAt=lic.activatedAt||new Date().toISOString();
      lic.updatedAt=new Date().toISOString();
      licenses[key]=lic;
      await writeLicenses(licenses);
      await syncBridgeLicense(key,lic,{queueOnFailure:true}).catch(()=>null);
      console.log(`APEX_LICENSE_FIRST_CLAIM license=${maskLicense(key)} account=${accountS}`);
    }
    return {ok:true,status:'ACTIVE',key,lic,licenses,claimed:claim};
  });
}
async function stampHeartbeat(v,payload){
  return withLock('lic:'+v.key,async()=>{
    const now=new Date().toISOString();
    const licenses=await readLicenses();
    const lic=licenses[v.key]||v.lic;
    lic.lastSeen=now;
    lic.lastAccount=String(payload.account??payload.account_number??'');
    lic.broker=String(payload.broker||payload.broker_server||'').slice(0,120);
    lic.server=String(payload.server||payload.broker_server||'').slice(0,120);
    lic.currency=String(payload.currency||'').slice(0,20);
    lic.eaVersion=String(payload.eaVersion||payload.version||payload.ea_version||'').slice(0,120);
    lic.buildId=String(payload.buildId||payload.build_id||'').slice(0,40);
    lic.tradeMode=Number(payload.tradeMode||0);
    lic.symbol=String(payload.symbol||'').slice(0,40);
    lic.balance=Number(payload.balance||0);
    lic.equity=Number(payload.equity||0);
    lic.freeMargin=Number(payload.freeMargin??payload.free_margin??0);
    lic.marginLevel=Number(payload.marginLevel??payload.margin_level??0);
    lic.openPositions=Number(payload.openPositions??payload.open_positions??0);
    lic.basketVolume=Number(payload.basketVolume??payload.basket_volume??0);
    lic.campaignActive=Boolean(payload.campaignActive??payload.campaign_active);
    lic.campaignState=String(payload.campaignState||payload.campaign_state||'').slice(0,20);
    lic.layers=Number(payload.layers||0);
    // APEX-AUDIT-018: what the EA has actually APPLIED, kept separate from what the
    // dashboard DESIRES. These two are rendered independently.
    lic.appliedRevision=Number(payload.appliedRevision??payload.applied_revision??lic.appliedRevision??0);
    lic.appliedConfigHash=String(payload.configHash||payload.config_hash||lic.appliedConfigHash||'').slice(0,64);
    lic.terminalConnected=payload.terminalConnected??payload.mt5_connected??null;
    lic.terminalTradeAllowed=payload.terminalTradeAllowed??payload.trading_allowed??null;
    lic.eaTradeAllowed=payload.eaTradeAllowed??payload.algo_trading??null;
    lic.observerOnly=Boolean(payload.observerOnly??payload.observer_only);
    lic.preflightBlock=String(payload.preflightBlock||payload.preflight_block||'').slice(0,64);
    lic.scanGate=String(payload.scanGate||payload.scan_gate||'').slice(0,64);
    lic.instanceId=String(payload.instance_id||payload.instanceId||lic.instanceId||'').slice(0,120);
    lic.magic=Number(payload.magic??lic.magic??0);
    lic.updatedAt=now;
    licenses[v.key]=lic;
    await writeLicenses(licenses);
    v.licenses=licenses;v.lic=lic;
    return lic;
  });
}

//======================= canonical event store ========================
// APEX-AUDIT-017: canonical events are the source of truth. They are INGESTED into the
// durable local log (deduplicated by stable event id) so history is not limited to the
// remote's latest-60 window, and campaign/ACK state is PROJECTED from that log.
function eventId(e){
  if(e.eventId)return String(e.eventId);
  if(e.id)return String(e.id);
  return crypto.createHash('sha1')
    .update([e.ts||e.emittedAt||'',e.type||'',e.campaignId||'',e.layer??'',e.revision??'',e.account||''].join('|'))
    .digest('hex');
}
async function appendEvent(e){
  await fs.mkdir(DATA,{recursive:true});
  const row={...e};
  row.ts=canonicalizeTimestamp(e.ts||e.emittedAt);
  row.emittedAtRaw=e.emittedAt??e.ts??null;
  row.eventId=eventId(row);
  await fs.appendFile(EVENTS,JSON.stringify(row)+'\n');
  // Push is best-effort and fully decoupled from trading/event acceptance.
  NOTIFICATIONS.ingest(row).catch(err=>console.error('APEX_PUSH_INGEST_FAILED',String(err?.message||err)));
  return row;
}
async function allEvents(){
  try{
    return (await fs.readFile(EVENTS,'utf8')).trim().split('\n').filter(Boolean)
      .map(x=>{try{return JSON.parse(x)}catch{return null}}).filter(Boolean);
  }catch(e){if(e&&e.code==='ENOENT')return [];throw e}
}
async function ingestRemoteEvents(key,remoteEvents,known){
  if(!Array.isArray(remoteEvents)||!remoteEvents.length)return 0;
  const lines=[];
  for(const raw of remoteEvents){
    const row={...raw,license:key};
    row.ts=canonicalizeTimestamp(row.ts||row.emittedAt);
    row.emittedAtRaw=raw.emittedAt??raw.ts??null;
    row.eventId=eventId(row);
    if(known.has(row.eventId))continue;
    known.add(row.eventId);
    lines.push(JSON.stringify(row));
  }
  if(!lines.length)return 0;
  await fs.mkdir(DATA,{recursive:true});
  await fs.appendFile(EVENTS,lines.join('\n')+'\n');
  return lines.length;
}
function sortEvents(events){
  return [...events].sort((a,b)=>{
    const ta=Date.parse(canonicalizeTimestamp(a.ts||a.emittedAt,0))||0;
    const tb=Date.parse(canonicalizeTimestamp(b.ts||b.emittedAt,0))||0;
    return ta===tb?String(a.eventId||'').localeCompare(String(b.eventId||'')):ta-tb;
  });
}
// Projects the CURRENT campaign from the reconciled event stream.
export function projectCampaign(events){
  let c=null;
  for(const e of sortEvents(events)){
    switch(e.type){
      case 'CAMPAIGN_START':
        c={campaignId:e.campaignId||null,direction:e.direction>0?'BUY':e.direction<0?'SELL':null,
           startedAt:e.ts,state:'ACTIVE',layers:Number(e.layers||1),signature:e.signature||null,
           entryPrice:e.entryPrice??null,targetEquity:e.targetEquity??null,cycleStart:e.cycleStart??null,
           setupId:e.setupId||null,bosKind:e.bosKind||null,score:e.score??null,
           scoreFloorGivenMandatory:e.scoreFloorGivenMandatory??null,
           closingOutcome:null,closingReason:null,earnedFloorPct:0,lastEventAt:e.ts};
        break;
      case 'CAMPAIGN_RECOVERED':
        if(!c)c={campaignId:e.campaignId||null,direction:e.direction>0?'BUY':e.direction<0?'SELL':null,
                 startedAt:e.ts,state:e.campaignState==='CLOSING'?'CLOSING':'ACTIVE',layers:Number(e.layers||0),
                 signature:e.signature||'RECOVERED',anchorsKnown:e.anchorsKnown!==false,lastEventAt:e.ts};
        break;
      case 'LAYER_OPEN':
        if(c){c.layers=Number(e.layer||c.layers);c.lastEventAt=e.ts;c.basketVolume=e.basketVolume??c.basketVolume}
        break;
      case 'PROFIT_FLOOR_EARNED':
        if(c){c.earnedFloorPct=Number(e.earnedFloorPct||c.earnedFloorPct||0);c.lastEventAt=e.ts}
        break;
      case 'CLOSING_REQUESTED':
        if(c){c.state='CLOSING';c.closingOutcome=e.outcome||null;c.closingReason=e.reason||null;c.lastEventAt=e.ts}
        break;
      case 'CLOSE_RETRY': case 'CLOSE_STALLED':
        if(c){c.state='CLOSING';c.remainingPositions=Number(e.remainingPositions||0);
              c.closeAttempts=Number(e.attempts||0);c.stalled=e.type==='CLOSE_STALLED';c.lastEventAt=e.ts}
        break;
      case 'CAMPAIGN_END':
        c=null;
        break;
    }
  }
  return c;
}
export function decorateCampaign(projected, hb={}, lastSeen=null){
  if(!projected && !(hb && (hb.campaign_active||hb.campaignActive))) return null;
  const c=projected?{...projected}:{};
  if(!projected){
    c.campaignId=hb.campaign_id||hb.campaignId||null;
    c.state=String(hb.campaign_state||hb.campaignState||'ACTIVE');
    c.layers=numOrNull(hb.layers);
    c.source='HEARTBEAT';
    c.direction=null;
  }
  const startEquity=numOrNull(c.cycleStart??c.startEquity);
  const hbEquity=numOrNull(hb.equity);
  const hbBalance=numOrNull(hb.balance);
  const currentEquity=hbEquity;
  const floatingFromHb=(hbEquity!=null && startEquity!=null)?hbEquity-startEquity
    :(hbEquity!=null && hbBalance!=null)?hbEquity-hbBalance:null;
  const target=numOrNull(c.targetEquity);
  const profitPct=(startEquity>0 && currentEquity!=null)?((currentEquity-startEquity)/startEquity)*100:null;
  const progressPct=(startEquity!=null && target!=null && target>startEquity && currentEquity!=null)
    ? ((currentEquity-startEquity)/(target-startEquity))*100 : null;
  const totalVolume=numOrNull(c.basketVolume ?? hb.basket_volume ?? hb.basketVolume);
  const layers=numOrNull(c.layers ?? hb.layers);
  return {
    campaignId:c.campaignId||null,
    direction:c.direction||null,
    state:c.state||null,
    campaignState:c.state||null,
    closingState:c.state==='CLOSING'?c.state:null,
    startedAt:c.startedAt||null,
    layers,
    firstEntry:numOrNull(c.entryPrice??c.firstEntryPrice),
    startEquity,
    currentEquity,
    floatingPL:floatingFromHb,
    profitPct,
    targetEquity:target,
    progressPct,
    totalVolume,
    basketVolume:totalVolume,
    profitFloor:numOrNull(c.earnedFloorPct),
    setupId:c.setupId||null,
    bosKind:c.bosKind||null,
    lastLiveUpdate:lastSeen||c.lastEventAt||null,
    lastEventAt:c.lastEventAt||null,
    signature:c.signature||null,
    anchorsKnown:c.anchorsKnown,
    source:c.source||'EVENTS'
  };
}
export function projectAck(events){
  let ack={revision:0,status:null,at:null,appliedRevision:0,configHash:null};
  for(const e of sortEvents(events)){
    if(e.type!=='COMMAND_ACK')continue;
    const rev=Number(e.revision||0);
    if(rev>=ack.revision)ack={revision:rev,status:e.status||'ACK',at:e.ts,
      appliedRevision:Number(e.appliedRevision||rev),configHash:e.configHash||null};
  }
  return ack;
}
export function buildHistory(events,limit=50){
  const sorted=sortEvents(events);
  const starts={};
  const out=[];
  for(const e of sorted){
    if(e.type==='CAMPAIGN_START'&&e.campaignId)starts[e.campaignId]=e;
    if(e.type!=='CAMPAIGN_END')continue;
    const s=starts[e.campaignId];
    out.push({
      campaignId:e.campaignId,direction:e.direction>0?'BUY':e.direction<0?'SELL':null,
      startedAt:s?.ts||null,endedAt:e.ts,layers:e.layers,outcome:e.outcome,reason:e.reason,
      mfe:e.mfe??null,mae:e.mae??null,
      realisedNet:e.realisedNet??null,realisedCommission:e.realisedCommission??null,
      realisedSwap:e.realisedSwap??null,finalBalance:e.finalBalance??null,
      earnedFloorPct:e.earnedFloorPct??null,closeAttempts:e.closeAttempts??null
    });
  }
  return out.reverse().slice(0,limit);
}

//======================= sessions =====================================
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
function newerIso(a,b){
  const ta=a?Date.parse(a):NaN,tb=b?Date.parse(b):NaN;
  if(!Number.isFinite(ta))return Number.isFinite(tb)?b:null;
  if(!Number.isFinite(tb))return a;
  return ta>=tb?a:b;
}
function humanEvent(e){
  const d=e.direction>0?'BUY':e.direction<0?'SELL':'';
  switch(e.type){
    case 'WATCH_ARMED':return `Potential ${e.watchDir>0?'BUY':'SELL'} reversal setup detected`;
    case 'SETUP_CANCELLED':return `Setup cancelled — ${e.cancelReason||'no longer valid'}`;
    case 'SETUP_LOCATED':return `Setup confirmed — waiting for origin retest`;
    case 'WATCH_EXTREME_UPDATED':return `Watched extreme updated`;
    case 'ORDER_PENDING':return `Broker accepted the order as pending — waiting for fill`;
    case 'ORDER_FILLED_LATE':return `Late fill attached to the campaign`;
    case 'ORDER_PENDING_CLEARED':return `Pending order cleared — ${e.reason||''}`;
    case 'CAMPAIGN_START':return `${d} campaign started`;
    case 'LAYER_OPEN':return `Market confirmed continuation — added position ${e.layer}`;
    case 'ENTRY_REJECTED_AT_GATE':return `Entry skipped at the final price check — ${e.reason||''}`;
    case 'ADD_BLOCKED':return `Addition skipped — ${e.reason||''}`;
    case 'ORDER_REJECTED':return `Broker rejected the order — retcode ${e.retcode||''}`;
    case 'SIZING_MODEL_REJECTED':return `NORMAL sizing rejected by live server — tier preserved, no semantic step-down`;
    case 'ORDER_UNCONFIRMED':return `Order not confirmed by the broker — ${e.detail||''}`;
    case 'CLOSING_REQUESTED':return `Closing the basket — ${e.reason||e.outcome||''}`;
    case 'CLOSE_RETRY':return `Close retry — ${e.remainingPositions||0} position(s) still open`;
    case 'CLOSE_STALLED':return `Close STILL failing — ${e.remainingPositions||0} position(s) open, campaign held in CLOSING`;
    case 'PROFIT_FLOOR_EARNED':return `Profit floor raised to +${e.earnedFloorPct}%`;
    case 'CAMPAIGN_END':return `${d} campaign ended — ${e.outcome||'closed'}`;
    case 'CAMPAIGN_RECOVERED':return 'Apex recovered an open campaign after restart';
    case 'MASTER_SL_MOVED':return 'Master stop moved and verified at the broker';
    case 'MASTER_SL_MOVE_FAIL':return 'Master stop change was REFUSED by the broker';
    default:return null;
  }
}
function learningShape(events){
  const ends=events.filter(e=>e.type==='CAMPAIGN_END');
  const positive=ends.filter(e=>['TARGET_HIT','PROFIT_FLOOR_HIT'].includes(e.outcome)).length;
  // APEX-AUDIT-026: observation only. There is no trained model and no live adaptation;
  // the adjustments are hard zero and are NOT permitted to become nonzero without an
  // explicitly approved, versioned, out-of-sample-validated model.
  return {schema:5,completedCampaigns:ends.length,positiveOutcomeRate:ends.length?positive/ends.length:0,
    entryScoreAdjustment:0,addScoreAdjustment:0,authority:'OBSERVATION_ONLY',
    adaptationImplemented:false,
    disclaimer:'Apex does not adapt its strategy automatically. These figures describe past campaigns only.',
    bySignature:{},featureInsights:{}};
}
function settingsView(c){return {
  accountProfile:c.accountProfile,targetMode:c.targetMode,targetEquity:c.targetEquity,
  targetMultiplier:c.targetMultiplier,
  normalTargetProfitPct:c.normalTargetProfitPct,baseMarginPct:c.baseMarginPct,
  layerMultiplier:c.layerMultiplier,maxLayers:c.maxLayers,normalL1MarginPct:c.normalL1MarginPct,
  normalL2MarginPct:c.normalL2MarginPct,normalL3PlusMarginPct:c.normalL3PlusMarginPct,
  normalFixedSLGoldMove:c.normalFixedSLGoldMove,normalReferenceLeverage:c.normalReferenceLeverage,
  profitRatchetEnabled:c.profitRatchetEnabled,
  ratchetTriggerPct:c.ratchetTriggerPct,ratchetLockPct:c.ratchetLockPct,ratchetStepPct:c.ratchetStepPct,
  ratchetLockStepPct:c.ratchetLockStepPct,masterBreakEvenEnabled:c.masterBreakEvenEnabled,
  masterBreakEvenTriggerPct:c.masterBreakEvenTriggerPct,recoveryExitEnabled:c.recoveryExitEnabled,
  recoveryExitArmPctOfSL:c.recoveryExitArmPctOfSL,
  maxBasketLots:c.maxBasketLots,minMarginLevelPct:c.minMarginLevelPct,marginReservePct:c.marginReservePct,
  unlimitedSizingNote:'Each valid UNLIMITED add uses 100% of CURRENT executable remaining capacity. The multiplier control is a no-op while baseMarginPct is 100 (runtime cap).',
  advanced:{entryScore:c.entryScore,addScore:c.addScore,impulseAtr:c.impulseAtr,sweepAtr:c.sweepAtr,
    rejectionBars:c.rejectionBars,watchExpiryMinutes:c.watchExpiryMinutes,rejectionZoneAtr:c.rejectionZoneAtr,
    addSpacingAtr:c.addSpacingAtr,requireM3Confirm:c.requireM3Confirm,requireM5Context:c.requireM5Context,
    cooldownMinutes:c.cooldownMinutes,learningEnabled:c.learningEnabled,
    learningNote:'OBSERVATION_ONLY. Apex does not adapt live. Adjustments are forced to zero.'}
}}

//======================= dashboard projection =========================
async function buildMe(key){
  const licenses=await readLicenses(),lic=licenses[key],status=licenseStatusFor(lic),cfg=await getLicenseConfig(key);
  const desiredHash=configHash(cfg);
  const base={key,status,account:lic?.account||null,lastAccount:lic?.lastAccount||null,
    accountProfile:cfg.accountProfile,licenseTier:lic?.licenseTier||lic?.accountProfile||null,
    unlimitedEntitled:licenseAllowsUnlimited(lic),
    expiresAt:lic?.expiresAt||null,customer:lic?.customer||null};
  if(status!=='ACTIVE')
    return {license:base,dataAvailable:false,armed:false,mt5:{status:'DISCONNECTED',lastSeen:null},
      settings:settingsView(cfg),learning:learningShape([]),
      bridge:{configured:bridgeConfigured(),ok:false,reason:'LICENSE_'+status,sync:bridgeSyncState}};

  const bridge=await readBridgeStatusSafe(key);
  const remote=bridge.data;
  const remoteLastSeen=remote?.mt5?.lastSeen||null;
  const lastSeen=newerIso(remoteLastSeen,lic.lastSeen||null);
  const mt5=classifyMt5(lastSeen);
  const hb=(remote?.heartbeat&&typeof remote.heartbeat==='object')?remote.heartbeat:null;
  const remoteAccount=String(remote?.license?.account||'').trim();

  // APEX-AUDIT-017: ingest the canonical page into the durable local log, then project
  // from the FULL reconciled log rather than from the remote's latest-60 window.
  const all=await allEvents();
  const known=new Set(all.map(e=>e.eventId||eventId(e)));
  const canonicalMissing=await readBridgeEventsUntilKnown(key,known).catch(()=>[]);
  const remotePage=canonicalMissing.length?canonicalMissing:(remote?.recentEvents||[]);
  const ingested=await ingestRemoteEvents(key,remotePage,known);
  const merged=ingested?await allEvents():all;
  const acct=lic.lastAccount||lic.account||remoteAccount||'';
  const events=merged.filter(e=>{
    const eventKey=normalizeLicense(e.license||e.license_key||'');
    const eventAccount=String(e.account||e.account_number||'').trim();
    if(eventKey!==key)return false;
    if(acct&&eventAccount&&eventAccount!==String(acct))return false;
    return true;
  });

  const campaign=decorateCampaign(projectCampaign(events),hb||{},lastSeen);
  const ack=projectAck(events);

  const desiredRevision=Number(lic.commandRevision||0);
  const appliedRevision=Number(hb?.applied_revision??lic.appliedRevision??ack.appliedRevision??0);
  const appliedHash=String(hb?.config_hash||lic.appliedConfigHash||ack.configHash||'');
  const known3=(v)=>v===null||v===undefined?null:v;

  console.log(`APEX_BRIDGE_STATUS_CHECK license=${maskLicense(key)} bridgeOk=${bridge.ok} heartbeatFound=${Boolean(remoteLastSeen)} ageSec=${remoteLastSeen?Math.max(0,Math.round((Date.now()-Date.parse(remoteLastSeen))/1000)):'n/a'} resolved=${mt5} ingested=${ingested}`);

  // APEX-AUDIT-018: a heartbeat is NOT proof the strategy engine can trade. Desired,
  // applied, connectivity and trading readiness are four separate, honestly-labelled facts.
  const terminalConnected=known3(hb?.mt5_connected??lic.terminalConnected);
  const terminalTradeAllowed=known3(hb?.trading_allowed??lic.terminalTradeAllowed);
  const eaTradeAllowed=known3(hb?.algo_trading??lic.eaTradeAllowed);
  const preflightBlock=String(hb?.preflight_block||lic.preflightBlock||'');
  const observerOnly=Boolean(hb?.observer_only??lic.observerOnly);
  const readyToTrade=(mt5==='CONNECTED')&&terminalConnected===true&&terminalTradeAllowed===true&&
                     eaTradeAllowed===true&&!observerOnly&&preflightBlock===''&&cfg.armed===true;

  return {
    license:base,dataAvailable:Boolean(lastSeen),waitingForFirstContact:!lastSeen,
    armed:cfg.armed,accountProfile:cfg.accountProfile,
    mt5:{status:mt5,lastSeen:lastSeen||null},
    // desired vs applied vs unknown, never merged into a single "armed" light
    control:{
      desired:{armed:cfg.armed,revision:desiredRevision,configHash:desiredHash},
      applied:{revision:appliedRevision||null,configHash:appliedHash||null,
               asOf:lastSeen||null,
               inSync:appliedRevision>0?appliedRevision===desiredRevision:null},
      ack:{revision:ack.revision||0,status:ack.status,at:ack.at}
    },
    readiness:{
      readyToTrade,
      terminalConnected,terminalTradeAllowed,eaTradeAllowed,
      observerOnly,preflightBlock:preflightBlock||null,
      scanGate:String(hb?.scan_gate||lic.scanGate||'')||null,
      openPositions:known3(hb?.open_positions??lic.openPositions),
      basketVolume:known3(hb?.basket_volume??lic.basketVolume),
      freeMargin:known3(hb?.free_margin??lic.freeMargin),
      marginLevel:known3(hb?.margin_level??lic.marginLevel),
      note:'A heartbeat only proves the EA process is reachable. readyToTrade additionally requires broker trading permission, an applied config and an armed state.'
    },
    command:{revision:desiredRevision,pending:lic.pendingCommand||null,
      lastAckRevision:Number(ack.revision||lic.lastAckRevision||0),
      lastAckStatus:ack.status||lic.lastAckStatus||null,
      lastAckAt:ack.at||lic.lastAckAt||null},
    account:{
      account:String(hb?.account_number||remoteAccount||lic.lastAccount||lic.account||'')||null,
      broker:hb?.broker_server||lic.broker||null,
      server:hb?.broker_server||lic.server||null,
      currency:lic.currency||null,
      balance:known3(hb?.balance??lic.balance),
      equity:known3(hb?.equity??lic.equity),
      freeMargin:known3(hb?.free_margin??lic.freeMargin),
      marginLevel:known3(hb?.margin_level??lic.marginLevel),
      openPositions:known3(hb?.open_positions??lic.openPositions),
      asOf:lastSeen||null,
      tradeMode:known3(lic.tradeMode)
    },
    campaign,history:buildHistory(events),learning:learningShape(events),
    recentHuman:sortEvents(events).slice(-120).reverse().map(e=>({ts:e.ts,type:e.type,text:humanEvent(e)})).filter(x=>x.text).slice(0,30),
    effectiveConfig:{
      eaVersion:hb?.ea_version||lic.eaVersion||null,
      buildId:hb?.build_id||lic.buildId||null,
      expectedEaVersion:MANIFEST.eaVersion,
      configSource:remote?'XAUCLOUD_BRIDGE':'REMOTE/CACHED_LOCAL',
      appliedRevision:appliedRevision||null,appliedConfigHash:appliedHash||null,
      desiredRevision,desiredConfigHash:desiredHash,
      asOf:lastSeen||lic.lastSeen||null,
      l1MarginPct:cfg.normalL1MarginPct,l2MarginPct:cfg.normalL2MarginPct,
      l3PlusMarginPct:cfg.normalL3PlusMarginPct,takeProfitPct:cfg.normalTargetProfitPct,
      fixedSLGoldMove:cfg.normalFixedSLGoldMove,beEnabled:cfg.masterBreakEvenEnabled,
      beTriggerPct:cfg.masterBreakEvenTriggerPct,recoveryExitEnabled:cfg.recoveryExitEnabled,
      recoveryArmPctOfSL:cfg.recoveryExitArmPctOfSL,ratchetEnabled:cfg.profitRatchetEnabled,
      ratchetTriggerPct:cfg.ratchetTriggerPct,ratchetLockPct:cfg.ratchetLockPct,
      ratchetStepPct:cfg.ratchetStepPct,ratchetLockStepPct:cfg.ratchetLockStepPct
    },
    settings:settingsView(cfg),
    bridge:{
      configured:bridgeConfigured(),ok:bridge.ok,reason:bridge.ok?null:bridge.reason,
      heartbeatFound:Boolean(remoteLastSeen),
      heartbeatAgeSec:remoteLastSeen?Math.max(0,Math.round((Date.now()-Date.parse(remoteLastSeen))/1000)):null,
      resolvedState:mt5,license:maskLicense(key),
      sync:{status:bridgeSyncState.status,error:bridgeSyncState.error,finishedAt:bridgeSyncState.finishedAt},
      eventsIngested:ingested
    }
  };
}
function genLicense(){
  const seg=()=>crypto.randomBytes(3).toString('hex').toUpperCase();
  return `APEX-${seg()}-${seg()}-${seg()}`;
}

async function notificationSession(req,res){
  const s=verifySession(cookies(req).apex_session);
  if(!s){json(res,401,{error:'no_session'});return null}
  const licenses=await readLicenses();
  const status=licenseStatusFor(licenses[s.lic]);
  if(status!=='ACTIVE'){clearSession(res);json(res,401,{error:'license_not_active',reason:status});return null}
  return s;
}
function adminOk(req){
  const supplied=String(req.headers.authorization||'');
  const expected=`Bearer ${ADMIN_TOKEN}`;
  const a=Buffer.from(supplied),b=Buffer.from(expected);
  return a.length===b.length&&crypto.timingSafeEqual(a,b);
}
// Config responses: validated config FIRST, server-derived identity attached AFTER, so
// a stored key can never spoof licenseStatus/commandRevision/configHash (APEX-AUDIT-019).
function configEnvelope(cfg,{commandRevision=0,extra={}}={}){
  return {...clean(cfg),
    ok:true,schema:CONFIG_SCHEMA,licenseStatus:'ACTIVE',
    commandRevision:Number(commandRevision||0),configHash:configHash(clean(cfg)),
    serverTime:new Date().toISOString(),...extra};
}

//======================= HTTP ========================================
const server=http.createServer(async(req,res)=>{
  try{
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('X-Frame-Options','DENY');
    res.setHeader('Referrer-Policy','no-referrer');
    const u=new URL(req.url,'http://localhost');
    const ip=clientIp(req);

    if(req.method==='GET'&&u.pathname==='/health')
      return json(res,200,{ok:true,service:'xaucloud-apex',
        version:MANIFEST.version,buildId:MANIFEST.buildId,eaVersion:MANIFEST.eaVersion,
        configSchema:CONFIG_SCHEMA,webRequestOrigin:MANIFEST.webRequestOrigin,
        bridge:{configured:bridgeConfigured(),sync:bridgeSyncState},
        secretsAcceptableForProduction:secretProblems().length===0,
        link:'command-center-style'});

    // --- EA routes. One binding/expiry policy for all of them (APEX-AUDIT-022). ---
    if(req.method==='POST'&&u.pathname==='/api/apex/heartbeat'){
      const b=await body(req),v=await validateEa(b.license??b.license_key,b.account??b.account_number);
      if(!v.ok){
        console.warn(`APEX_HEARTBEAT_DENIED ip=${ip} license=${maskLicense(b.license)} status=${v.status}`);
        return json(res,403,{ok:false,licenseStatus:v.status,armed:false,reason:v.status});
      }
      const lic=await stampHeartbeat(v,b),cfg=await getLicenseConfig(v.key);
      return json(res,200,configEnvelope(cfg,{commandRevision:Number(lic.commandRevision||0)}));
    }

    if(req.method==='POST'&&u.pathname==='/api/apex/command/ack'){
      const b=await body(req),v=await validateEa(b.license??b.license_key,b.account??b.account_number);
      if(!v.ok)return json(res,403,{ok:false,error:v.status});
      const rev=Number(b.revision||0);
      await withLock('lic:'+v.key,async()=>{
        const licenses=await readLicenses(),lic=licenses[v.key];
        if(lic&&rev>=Number(lic.lastAckRevision||0)){
          lic.lastAckRevision=rev;lic.lastAckStatus=String(b.status||'ACK');lic.lastAckAt=new Date().toISOString();
          lic.appliedRevision=Number(b.appliedRevision||rev);
          if(b.configHash)lic.appliedConfigHash=String(b.configHash).slice(0,64);
          licenses[v.key]=lic;await writeLicenses(licenses);
        }
      });
      await appendEvent({type:'COMMAND_ACK',license:v.key,account:String(b.account||''),revision:rev,
        status:String(b.status||'ACK'),appliedRevision:Number(b.appliedRevision||rev),configHash:b.configHash||null,
        eventId:b.eventId});
      return json(res,200,{ok:true});
    }

    if(req.method==='POST'&&u.pathname==='/api/apex/event'){
      const b=await body(req),v=await validateEa(b.license??b.license_key,b.account??b.account_number);
      if(!v.ok)return json(res,403,{ok:false,error:v.status});
      await stampHeartbeat(v,b);
      const row=await appendEvent({...b,license:v.key});
      return json(res,200,{ok:true,eventId:row.eventId});
    }

    // Compatibility route for an already-attached older EA build. It uses the SAME
    // validateEa() binding/expiry policy -- it can no longer bypass it (APEX-AUDIT-022).
    if(req.method==='GET'&&u.pathname==='/api/ea/config'){
      const license=normalizeLicense(req.headers['x-apex-license']||u.searchParams.get('license')||'');
      const account=String(u.searchParams.get('account')||'');
      const v=await validateEa(license,account);
      if(!v.ok)return json(res,403,{ok:false,licenseStatus:v.status,armed:false,reason:v.status});
      const lic=await stampHeartbeat(v,{account}),cfg=await getLicenseConfig(v.key);
      return json(res,200,configEnvelope(cfg,{commandRevision:Number(lic.commandRevision||0),
        extra:{learning:learningShape(await allEvents()),legacyRoute:true}}));
    }
    if(req.method==='POST'&&u.pathname==='/api/ea/event'){
      const b=await body(req);
      const license=normalizeLicense(req.headers['x-apex-license']||b.license||'');
      const v=await validateEa(license,b.account);
      if(!v.ok)return json(res,403,{ok:false,error:v.status});
      await stampHeartbeat(v,b);const row=await appendEvent({...b,license:v.key});
      return json(res,200,{ok:true,eventId:row.eventId});
    }

    // --- website auth ---
    if(req.method==='POST'&&u.pathname==='/api/auth/login'){
      if(!throttle('login',ip,20))return json(res,429,{error:'too_many_attempts'});
      const b=await body(req),key=normalizeLicense(b.license);let licenses=await readLicenses();
      if(key&&!licenses[key]&&bridgeConfigured()){await recoverLicensesFromBridge().catch(()=>null);licenses=await readLicenses();}
      const st=licenseStatusFor(licenses[key]);
      if(st!=='ACTIVE')return json(res,401,{error:'LICENSE_NOT_ACTIVE',reason:st});
      setSession(res,makeSession(key));return json(res,200,{ok:true});
    }
    if(req.method==='POST'&&u.pathname==='/api/auth/logout'){clearSession(res);return json(res,200,{ok:true})}
    if(req.method==='GET'&&u.pathname==='/api/auth/me'){
      const s=verifySession(cookies(req).apex_session);
      if(!s)return json(res,401,{error:'no_session'});
      // The license itself IS the login identity. Keep the session across code deploys,
      // but revoke it immediately if that license is actually disabled/expired/deleted.
      const licenses=await readLicenses();
      const status=licenseStatusFor(licenses[s.lic]);
      if(status!=='ACTIVE'){
        clearSession(res);
        return json(res,401,{error:'license_not_active',reason:status});
      }
      return json(res,200,await buildMe(s.lic));
    }
    if(req.method==='POST'&&u.pathname==='/api/session/config'){
      const s=verifySession(cookies(req).apex_session);if(!s)return json(res,401,{error:'no_session'});
      const licenses=await readLicenses();
      const st=licenseStatusFor(licenses[s.lic]);
      if(st!=='ACTIVE')return json(res,403,{error:'license_not_active',reason:st});
      const b=await body(req);
      const {expectedRevision,...patch}=b||{};
      const saved=await saveLicenseConfig(s.lic,patch,{bumpRevision:true,
        expectedRevision:expectedRevision===undefined?null:Number(expectedRevision)});
      const licensesAfter=await readLicenses();
      const applied=Number(licensesAfter[s.lic]?.appliedRevision||0);
      const delivery=saved.delivery||classifyConfigDelivery(null,bridgeConfigured());
      let ackStatus='EA_NOT_ACKNOWLEDGED';
      if(delivery.status==='BRIDGE_DELIVERED' && applied===saved.revision) ackStatus='EA_APPLIED';
      else if(delivery.status==='BRIDGE_DELIVERED') ackStatus='BRIDGE_DELIVERED';
      else ackStatus=delivery.status;
      return json(res,200,{ok:true,config:saved.config,commandRevision:saved.revision,
        configHash:saved.configHash,delivery:ackStatus,deliveryDetail:delivery,
        desiredRevision:saved.revision,appliedRevision:applied||null,
        inSync:applied>0?applied===saved.revision:false});
    }

    // --- first-party Apex Web Push (per-license; separate from EA config revision) ---
    if(req.method==='GET'&&u.pathname==='/api/notifications/key'){
      const s=await notificationSession(req,res);if(!s)return;
      return json(res,200,{ok:true,publicKey:await NOTIFICATIONS.publicKey()});
    }
    if(req.method==='GET'&&u.pathname==='/api/notifications/status'){
      const s=await notificationSession(req,res);if(!s)return;
      const st=await NOTIFICATIONS.status();
      return json(res,200,{ok:true,configured:st.configured,preferences:await NOTIFICATIONS.getPreferences(s.lic),devices:await NOTIFICATIONS.listDeviceSummary(s.lic)});
    }
    if(req.method==='POST'&&u.pathname==='/api/notifications/subscribe'){
      const s=await notificationSession(req,res);if(!s)return;
      const b=await body(req);
      const result=await NOTIFICATIONS.subscribe(s.lic,b.subscription,{userAgent:req.headers['user-agent']||''});
      return json(res,200,result);
    }
    if(req.method==='POST'&&u.pathname==='/api/notifications/unsubscribe'){
      const s=await notificationSession(req,res);if(!s)return;
      const b=await body(req);if(!b.endpoint)return json(res,400,{error:'endpoint_required'});
      return json(res,200,await NOTIFICATIONS.unsubscribe(s.lic,String(b.endpoint)));
    }
    if(req.method==='POST'&&u.pathname==='/api/notifications/preferences'){
      const s=await notificationSession(req,res);if(!s)return;
      const b=await body(req);
      return json(res,200,{ok:true,preferences:await NOTIFICATIONS.setPreferences(s.lic,b)});
    }
    if(req.method==='POST'&&u.pathname==='/api/notifications/test'){
      const s=await notificationSession(req,res);if(!s)return;
      if(!throttle('push-test',ip,5,60_000))return json(res,429,{error:'too_many_test_notifications'});
      return json(res,200,await NOTIFICATIONS.sendTest(s.lic));
    }

    // --- admin ---
    if(req.method==='GET'&&u.pathname==='/api/admin/licenses'){
      if(!adminOk(req)){
        if(!throttle('admin',ip,30))return json(res,429,{error:'too_many_attempts'});
        return json(res,401,{error:'unauthorized'});
      }
      const ls=await readLicenses();
      return json(res,200,{licenses:Object.entries(ls).map(([key,v])=>({key,...v,status:licenseStatusFor(v)}))});
    }
    if(req.method==='POST'&&u.pathname==='/api/admin/licenses'){
      if(!adminOk(req)){
        if(!throttle('admin',ip,30))return json(res,429,{error:'too_many_attempts'});
        return json(res,401,{error:'unauthorized'});
      }
      const b=await body(req),key=normalizeLicense(b.key)||genLicense();
      const result=await withLock('lic:'+key,async()=>{
        const ls=await readLicenses(),old=ls[key]||{},now=new Date().toISOString();
        // APEX-AUDIT-022: an admin edit must not silently break an existing atomic
        // first-claim. Clearing the account is an explicit reset, not an accident.
        const clearing=b.account!==undefined&&!String(b.account||'');
        const next={...old,
          status:['ACTIVE','DISABLED'].includes(b.status)?b.status:(old.status||'ACTIVE'),
          account:b.account!==undefined?String(b.account||''):(old.account||''),
          customer:b.customer!==undefined?String(b.customer||''):(old.customer||''),
          // APEX-AUDIT-023: this is the COMMERCIAL tier. The EXECUTION profile lives in
          // the per-license config and is written below so the two cannot disagree.
          licenseTier:['NORMAL','UNLIMITED'].includes(b.accountProfile)?b.accountProfile:(old.licenseTier||old.accountProfile||'NORMAL'),
          accountProfile:['NORMAL','UNLIMITED'].includes(b.accountProfile)?b.accountProfile:(old.accountProfile||'NORMAL'),
          expiresAt:b.expiresAt!==undefined?(b.expiresAt||null):(old.expiresAt||null),
          commandRevision:Number(old.commandRevision||0),createdAt:old.createdAt||now,updatedAt:now};
        if(clearing)next.activatedAt=null;
        ls[key]=next;
        await writeLicenses(ls);
        return {next,clearing};
      });
      // Align the execution profile with the licence tier, transactionally and with a
      // revision bump, so the EA actually receives it (APEX-AUDIT-023).
      let cfgResult=null;
      if(b.accountProfile&&['NORMAL','UNLIMITED'].includes(b.accountProfile)){
        const cur=await getLicenseConfig(key);
        if(cur.accountProfile!==b.accountProfile)
          cfgResult=await saveLicenseConfig(key,{accountProfile:b.accountProfile},{bumpRevision:true});
      }
      await syncBridgeLicense(key,result.next,{resetAccount:result.clearing,queueOnFailure:true});
      if(!cfgResult)await syncBridgeConfig(key,await getLicenseConfig(key),Number(result.next.commandRevision||0),{queueOnFailure:true});
      const ls=await readLicenses();
      const executionConfig=await getLicenseConfig(key);
      return json(res,200,{ok:true,
        license:{key,...ls[key],status:licenseStatusFor(ls[key])},
        licenseTier:ls[key].licenseTier,
        executionProfile:executionConfig.accountProfile,
        profileAligned:ls[key].licenseTier===executionConfig.accountProfile,
        commandRevision:Number(ls[key].commandRevision||0)});
    }
    if(req.method==='GET'&&u.pathname==='/api/admin/bridge/status'){
      if(!adminOk(req)){
        if(!throttle('admin',ip,30))return json(res,429,{error:'too_many_attempts'});
        return json(res,401,{error:'unauthorized'});
      }
      const key=normalizeLicense(u.searchParams.get('license')||'');
      if(!key)return json(res,400,{ok:false,error:'license_required'});
      const licenses=await readLicenses(),lic=licenses[key];
      if(!lic)return json(res,404,{ok:false,error:'local_license_not_found',license:maskLicense(key)});
      const check=await bridgeSelfTest(key,lic);
      const executionConfig=await getLicenseConfig(key);
      return json(res,200,{ok:true,license:maskLicense(key),...check,
        licenseTier:lic.licenseTier||lic.accountProfile||'NORMAL',
        executionProfile:executionConfig.accountProfile,
        profileAligned:(lic.licenseTier||lic.accountProfile||'NORMAL')===executionConfig.accountProfile,
        outboxPending:(await outboxRead()).length,sync:bridgeSyncState});
    }
    if(req.method==='POST'&&u.pathname==='/api/admin/bridge/drain'){
      if(!adminOk(req)){
        if(!throttle('admin',ip,30))return json(res,429,{error:'too_many_attempts'});
        return json(res,401,{error:'unauthorized'});
      }
      return json(res,200,{ok:true,...(await drainOutbox())});
    }
    if(req.method==='GET'&&u.pathname==='/api/admin/status'){
      if(!adminOk(req)){
        if(!throttle('admin',ip,30))return json(res,429,{error:'too_many_attempts'});
        return json(res,401,{error:'unauthorized'});
      }
      return json(res,200,{ok:true,manifest:MANIFEST,sync:bridgeSyncState,
        outboxPending:(await outboxRead()).length,
        secretProblems:secretProblems(),
        licenses:(await readLicenses()),configs:(await readLicenseConfigs())});
    }

    if(req.method==='GET'&&['/push-sw.js','/manifest.webmanifest','/apex-icon.svg','/notifications-ui.js'].includes(u.pathname)){
      const file=u.pathname.slice(1);
      const types={'push-sw.js':'application/javascript; charset=utf-8','notifications-ui.js':'application/javascript; charset=utf-8','manifest.webmanifest':'application/manifest+json; charset=utf-8','apex-icon.svg':'image/svg+xml'};
      const data=await fs.readFile(path.join(__dirname,'public',file));
      res.writeHead(200,{'content-type':types[file]||'application/octet-stream','cache-control':file==='push-sw.js'?'no-cache':'public, max-age=300'});
      return res.end(data);
    }

    if(req.method==='GET'&&u.pathname==='/'){
      const html=await fs.readFile(path.join(__dirname,'public','index.html'));
      res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});
      return res.end(html);
    }
    return json(res,404,{error:'not_found'});
  }catch(e){
    console.error(e);
    return json(res,e?.httpStatus||500,{error:e?.message||'internal_error',detail:e?.detail||null});
  }
});

await ensure();
await NOTIFICATIONS.ensure().catch(e=>console.error('APEX_PUSH_STARTUP_DEFERRED',String(e?.message||e)));
if(process.env.NODE_ENV!=='test'){
  const problems=secretProblems(process.env);
  if(problems.length){
    // Live 3.8.4 was already serving with secretsAcceptableForProduction=false.
    // Taking the public site down is worse than a loud warning. Refuse-boot is
    // opt-in after ADMIN_TOKEN/SESSION_SECRET are rotated.
    console.error('APEX SECRET CHECK FAILED | '+problems.join(', ')+
      ' | listening anyway so the dashboard stays up | rotate ADMIN_TOKEN (>=24) and SESSION_SECRET (>=32) | set APEX_STRICT_SECRETS=1 only after that');
    if(process.env.APEX_STRICT_SECRETS==='1' && process.env.NODE_ENV==='production'){
      assertProductionSecrets(process.env);
    }
  }
  // APEX-AUDIT-021: the local service comes up FIRST. Bridge reconciliation runs in the
  // background and its state is reported honestly through /health and the dashboard;
  // it never blocks startup or a dashboard request.
  server.listen(PORT,'0.0.0.0',()=>console.log(`XauCloud Apex v${MANIFEST.version} listening on ${PORT}`));
  syncAllLicensesAtStartup().catch(e=>console.error('APEX_BRIDGE_STARTUP_DEFERRED',String(e?.message||e)));
  NOTIFICATIONS.start({intervalMs:5000});
  setTimeout(()=>{reconcileNotificationBridgeEvents().catch(e=>console.error('APEX_PUSH_BRIDGE_RECONCILE_FAILED',String(e?.message||e)))},1500).unref?.();
  setInterval(()=>{reconcileNotificationBridgeEvents().catch(e=>console.error('APEX_PUSH_BRIDGE_RECONCILE_FAILED',String(e?.message||e)))},8000).unref?.();
  setInterval(()=>{drainOutbox().catch(e=>console.error('APEX_OUTBOX_DRAIN_FAILED',String(e?.message||e)))},15_000).unref?.();
  setInterval(()=>{reconcileManagerLeases().catch(e=>console.error('APEX_MANAGER_LEASE_FAILED',String(e?.message||e)))},8000).unref?.();
}
export {server};
