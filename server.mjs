import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname=path.dirname(fileURLToPath(import.meta.url));
const PORT=Number(process.env.PORT||8787);
const ADMIN_TOKEN=process.env.ADMIN_TOKEN||'change-me-admin';
const EA_TOKEN=process.env.EA_TOKEN||'change-me-ea';
const DATA=path.resolve(process.env.DATA_DIR||path.join(__dirname,'data'));
const CONFIG=path.join(DATA,'config.json');
const EVENTS=path.join(DATA,'events.ndjson');
const STATE=path.join(DATA,'state.json');

const DEFAULT={
  armed:false,account:'0',symbolContains:'XAUUSD',
  targetMode:'MULTIPLIER',accountProfile:'NORMAL',
  targetEquity:1000,targetMultiplier:100,
  normalTargetProfitPct:1000,normalProfitFloorEnabled:true,
  baseMarginPct:30,layerMultiplier:2,maxLayers:0,
  entryScore:76,addScore:70,impulseAtr:1.8,sweepAtr:.05,
  rejectionBars:5,watchExpiryMinutes:12,addSpacingAtr:.22,
  rejectionZoneAtr:.12,requireM3Confirm:true,requireM5Context:false,
  cooldownMinutes:0,learningEnabled:true,learningMinCampaigns:8,
  learningMaxScoreAdjustment:5
};

async function atomic(file,obj){const t=file+'.tmp';await fs.writeFile(t,JSON.stringify(obj,null,2));await fs.rename(t,file)}
async function ensure(){await fs.mkdir(DATA,{recursive:true});try{await fs.access(CONFIG)}catch{await atomic(CONFIG,DEFAULT)}}
async function read(file,fallback){try{return JSON.parse(await fs.readFile(file,'utf8'))}catch{return fallback}}
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
    normalTargetProfitPct:num(x.normalTargetProfitPct,1000,100,1000),
    normalProfitFloorEnabled:x.normalProfitFloorEnabled!==false,
    baseMarginPct:num(x.baseMarginPct,30,.1,100),
    layerMultiplier:num(x.layerMultiplier,2,1,10),
    maxLayers:Math.round(num(x.maxLayers,0,0,50)),
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

async function body(req){let s='';for await(const c of req){s+=c;if(s.length>2e6)throw Error('too large')}return s?JSON.parse(s):{}}
function auth(req,token){return req.headers.authorization===`Bearer ${token}`}
function json(res,code,obj){res.writeHead(code,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(obj))}
async function event(e){await fs.appendFile(EVENTS,JSON.stringify({ts:new Date().toISOString(),...e})+'\n')}
async function allEvents(){try{return (await fs.readFile(EVENTS,'utf8')).trim().split('\n').filter(Boolean).map(x=>JSON.parse(x))}catch{return[]}}

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
    state:{
      updatedAt:state?.updatedAt||null,
      lastEA:last,
      campaignActive
    },
    learning,
    recent:recent.slice(0,50)
  };
}

const server=http.createServer(async(req,res)=>{
  try{
    const u=new URL(req.url,'http://localhost');

    if(u.pathname==='/health')
      return json(res,200,{ok:true,service:'xaucloud-apex',version:'2.2.0'});

    if(req.method==='GET'&&u.pathname==='/api/ea/config'){
      if(!auth(req,EA_TOKEN))return json(res,401,{error:'unauthorized'});
      const cfg=clean(await read(CONFIG,DEFAULT));
      const account=u.searchParams.get('account')||'0';
      if(cfg.account!=='0'&&cfg.account!==account)return json(res,403,{error:'account_not_allowed'});
      return json(res,200,{...cfg,learning:learn(await allEvents(),cfg)});
    }

    if(req.method==='POST'&&u.pathname==='/api/ea/event'){
      if(!auth(req,EA_TOKEN))return json(res,401,{error:'unauthorized'});
      const b=await body(req);
      await event({type:String(b.type||'EA_EVENT'),...b});
      const st=await read(STATE,{});
      st.updatedAt=new Date().toISOString();
      st.lastEA=b;
      await atomic(STATE,st);
      return json(res,200,{ok:true});
    }

    if(req.method==='GET'&&u.pathname==='/api/admin/status'){
      if(!auth(req,ADMIN_TOKEN))return json(res,401,{error:'unauthorized'});
      const cfg=clean(await read(CONFIG,DEFAULT)),events=await allEvents(),state=await read(STATE,{});
      return json(res,200,publicState(cfg,state,learn(events,cfg),events.slice().reverse()));
    }

    if(req.method==='POST'&&u.pathname==='/api/admin/config'){
      if(!auth(req,ADMIN_TOKEN))return json(res,401,{error:'unauthorized'});
      const incoming=await body(req);
      delete incoming.normalAccountMaxMultiplier;
      delete incoming.enableInvalidationExit;
      delete incoming.invalidationGivebackPct;
      const cfg=clean(incoming);
      await atomic(CONFIG,cfg);
      await event({type:'CONFIG',config:cfg});
      return json(res,200,{ok:true,config:cfg});
    }

    if(req.method==='GET'&&u.pathname==='/'){
      const html=await fs.readFile(path.join(__dirname,'public','index.html'));
      res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});
      return res.end(html);
    }

    return json(res,404,{error:'not_found'});
  }catch(e){
    console.error(e);
    return json(res,500,{error:'internal_error'});
  }
});

if(process.env.NODE_ENV!=='test'){
  await ensure();
  server.listen(PORT,'0.0.0.0',()=>console.log(`XauCloud Apex listening on 0.0.0.0:${PORT}`));
}
export{server};
