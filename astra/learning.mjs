// Append-only learning ledger. A prediction is written BEFORE its outcome is
// known; the outcome is a separate later record that references it. Nothing is
// edited or deleted, so failed predictions cannot be hidden or overwritten.
// Lessons are retrieved for similar setups; they never change live rules —
// strategy changes need versioned, validated releases.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const HORIZON_MS=60*60000;
export function createLearning(dataDir,{clock=Date.now}={}){
  const dir=path.join(dataDir,'astra-learning');
  const uid=license=>crypto.createHash('sha256').update(String(license)).digest('hex').slice(0,32);
  const file=license=>path.join(dir,uid(license)+'.jsonl');
  const pending=new Map(),loaded=new Set();let chain=Promise.resolve();
  const append=(license,row)=>(chain=chain.then(async()=>{await fs.mkdir(dir,{recursive:true,mode:0o700});await fs.appendFile(file(license),JSON.stringify(row)+'\n',{mode:0o600});}).catch(()=>{}));
  async function rows(license){try{return (await fs.readFile(file(license),'utf8')).split('\n').filter(Boolean).map(l=>{try{return JSON.parse(l);}catch{return null;}}).filter(Boolean);}catch{return [];}}
  async function ensure(license){
    if(loaded.has(license))return;loaded.add(license);
    const all=await rows(license),done=new Set(all.filter(r=>r.kind==='OUTCOME').map(r=>r.ref));
    const list=all.filter(r=>r.kind==='PREDICTION'&&!done.has(r.id)&&clock()-Date.parse(r.at)<HORIZON_MS*2);
    pending.set(license,list.map(r=>({...r,mfe:0,mae:0})));
  }
  return {
    /** Record a directional prediction (live decision, research thesis or lab answer). */
    async predict(license,p){
      await ensure(license);
      const row={kind:'PREDICTION',id:crypto.randomUUID(),at:new Date(clock()).toISOString(),...p};
      await append(license,row);
      if((p.direction==='BUY'||p.direction==='SELL')&&p.entry>0&&p.atr>0)pending.get(license).push({...row,mfe:0,mae:0});
      return row.id;
    },
    /** Feed every observed quote; resolves predictions at +-1 ATR first touch or after 60 minutes. */
    async observe(license,{bid,ask,atMs=clock()}){
      await ensure(license);const list=pending.get(license)||[],keep=[];
      for(const p of list){
        const sell=p.direction==='SELL',fav=sell?p.entry-ask:bid-p.entry,adv=-fav;
        p.mfe=Math.max(p.mfe,fav);p.mae=Math.max(p.mae,adv);
        const age=atMs-Date.parse(p.at);
        const result=p.mae>=p.atr?'ADVERSE_FIRST':p.mfe>=p.atr?'FAVOURABLE_FIRST':age>=HORIZON_MS?'NEITHER_WITHIN_60M':null;
        if(result)await append(license,{kind:'OUTCOME',ref:p.id,at:new Date(atMs).toISOString(),result,mfePts:+p.mfe.toFixed(3),maePts:+p.mae.toFixed(3),atr:p.atr,
          family:p.family,direction:p.direction,source:p.source,model:p.model});
        else keep.push(p);
      }
      pending.set(license,keep);
    },
    /** Lab episodes resolve immediately (the future is known server-side): prediction first, then outcome. */
    async resolved(license,p,o){
      const row={kind:'PREDICTION',id:crypto.randomUUID(),at:new Date(clock()).toISOString(),...p};await append(license,row);
      await append(license,{kind:'OUTCOME',ref:row.id,at:new Date(clock()).toISOString(),family:p.family,direction:p.direction,source:p.source,model:p.model,...o});
      return row.id;
    },
    async ledger(license,limit=200){const all=await rows(license);return all.slice(-limit);},
    /** Lessons for similar setups: same family/direction first, failures included. */
    async lessons(license,{family=null,direction=null,limit=8}={}){
      const all=await rows(license),preds=new Map(all.filter(r=>r.kind==='PREDICTION').map(r=>[r.id,r]));
      const out=all.filter(r=>r.kind==='OUTCOME').map(o=>({o,p:preds.get(o.ref)})).filter(x=>x.p)
        .map(({o,p})=>({at:p.at,source:p.source,model:p.model||null,family:p.family,direction:p.direction,stage:p.stage||null,
          thesis:p.thesis||null,result:o.result,mfePts:o.mfePts,maePts:o.maePts,
          lesson:o.result==='ADVERSE_FIRST'?`${p.family||'setup'} ${p.direction} moved 1 ATR against before 1 ATR in favour${p.thesis?' — thesis: '+p.thesis:''}`:
            o.result==='FAVOURABLE_FIRST'?`${p.family||'setup'} ${p.direction} reached 1 ATR in favour first`:`${p.family||'setup'} ${p.direction} went nowhere for 60 minutes`}));
      out.sort((a,b)=>((b.family===family&&b.direction===direction)-(a.family===family&&a.direction===direction))||Date.parse(b.at)-Date.parse(a.at));
      return out.slice(0,limit);
    },
    async stats(license){
      const all=await rows(license),preds=new Map(all.filter(r=>r.kind==='PREDICTION').map(r=>[r.id,r])),by={};
      for(const o of all.filter(r=>r.kind==='OUTCOME')){const p=preds.get(o.ref);if(!p)continue;
        const k=`${p.source}|${p.model||'native'}`,s=by[k]??={source:p.source,model:p.model||null,resolved:0,favourable:0,adverse:0,flat:0};
        s.resolved++;if(o.result==='FAVOURABLE_FIRST')s.favourable++;else if(o.result==='ADVERSE_FIRST')s.adverse++;else s.flat++;}
      return {predictions:preds.size,resolved:Object.values(by).reduce((a,s)=>a+s.resolved,0),bySource:Object.values(by)};
    }
  };
}
