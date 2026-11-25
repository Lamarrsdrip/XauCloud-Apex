// Apex reference-pattern engine. Deterministic and CAUSAL: it only reads closed
// M1 bars (oldest -> newest), the optional forming M1 bar and the current quote.
// M3 structure is rebuilt from M1, so the forming M3 candle is visible minute by
// minute — the reference traders acted inside forming M3 candles, not after them.
//
// Families come from the nine reference recordings (docs/astra/REFERENCE_VIDEO_ANNOTATION_2026-11-25.md):
//   V_RECOVERY_FAILURE   sharp leg, fast recovery back into the leg's ORIGIN, first failure there (V2 V4 V5 V6 V7 V9)
//   SPIKE_REJECTION      near-vertical impulse into a new local extreme that cannot hold (V3)
//   BREAK_PAUSE_CONTINUATION  structure break with displacement, weak counter-pause, pause breaks (V1, narrated)
//   RECOVERY_CONTINUATION     after a flush, higher lows build toward the flush origin (V8, single example)
// Every rule is applied to BUY and SELL by mirroring prices, so the BUY side is a
// derived symmetry unless a reference example says otherwise. Numbers below are
// structural proportions chosen from the reference charts BEFORE any historical
// evaluation; they are recorded in ENGINE_PARAMS and versioned, never fitted to the
// held-out period.
export const ENGINE_VERSION='apex-pattern-engine-1.0.0';
export const ENGINE_PARAMS=Object.freeze({
  vrf:{minLegAtr:3,maxLegM3:12,maxRecoveryM3:12,minRecovery:0.55,maxBeyondOrigin:0.25,failAtr:0.3,maxExtensionAtr:1.5,maxAgeMin:30,windowM3:40},
  spike:{minImpulseAtr:2.2,lookbackM3:20,failAtr:0.3,maxExtensionAtr:1.2,maxAgeMin:9},
  bos:{shelfBars:6,minBodyAtr:0.6,maxPauseBars:5,maxPauseBodyAtr:0.7,reclaimAtr:0.35,maxExtensionAtr:0.8,recentBreakM3:8},
  rc:{minLegAtr:3,maxLegM1:15,minHigherLows:2,roomFrac:0.35,minRecovery:0.25}
});
export const FAMILIES=['V_RECOVERY_FAILURE','SPIKE_REJECTION','BREAK_PAUSE_CONTINUATION','RECOVERY_CONTINUATION'];

const M3=180000;
function tr(b,p){return p?Math.max(b.h-b.l,Math.abs(b.h-p.c),Math.abs(b.l-p.c)):b.h-b.l;}
function atr(arr,n=14){const x=arr.slice(-n-1);let s=0,k=0;for(let i=1;i<x.length;i++){s+=tr(x[i],x[i-1]);k++;}return k?s/k:0;}
function mirror(b){return {t:b.t,o:-b.o,h:-b.l,l:-b.h,c:-b.c,complete:b.complete};}

/** Group closed M1 (+forming M1) into M3 bars. The last group is complete only if its third minute is closed. */
export function buildM3(m1,forming=null){
  const all=forming?[...m1,{...forming,forming:true}]:m1;const out=[];
  for(const b of all){
    const k=Math.floor(b.t/M3)*M3,last=out.at(-1);
    if(last&&last.t===k){last.h=Math.max(last.h,b.h);last.l=Math.min(last.l,b.l);last.c=b.c;last.lastMin=b.t;last.hasForming=last.hasForming||!!b.forming;}
    else out.push({t:k,o:b.o,h:b.h,l:b.l,c:b.c,lastMin:b.t,hasForming:!!b.forming});
  }
  for(const b of out)b.complete=!b.hasForming&&b.lastMin>=b.t+120000;
  if(out.length)for(let i=0;i<out.length-1;i++)if(!out[i].hasForming)out[i].complete=true;
  return out;
}

// Fair-value gap left by an up-move (sell-side form): bar[i-1].h < bar[i+1].l.
// Narrated by the V2/V3/V8 trader as the magnet price trades back into.
function fvg(seq){let best=null;for(let i=1;i<seq.length-1;i++){const lo=seq[i-1].h,hi=seq[i+1].l;if(hi>lo&&(!best||hi-lo>best.high-best.low))best={low:lo,high:hi};}return best;}
function fvgEvidence(seq,a3){const g=fvg(seq);return g?[`impulse left an imbalance ${((g.high-g.low)/a3).toFixed(2)} ATR wide (fill target)`]:[];}

// --- Sell-side detectors on (possibly mirrored) bars. Price fields are signed so
// --- that "up" means toward the failure side. `px` is the executable SELL price.
function vrf(m3,m1,px,a3,P){
  const w=m3.slice(-P.windowM3);if(w.length<8)return null;
  let b=0;for(let i=1;i<w.length;i++)if(w[i].l<w[b].l)b=i;
  if(b<2||b>w.length-2)return null;
  // Origin = the highest high of the leg that produced the low (local, not the session high).
  let a=Math.max(0,b-P.maxLegM3);for(let i=a+1;i<b;i++)if(w[i].h>w[a].h)a=i;
  const H0=w[a].h,L0=w[b].l,D=H0-L0;if(D<P.minLegAtr*a3)return null;
  let r=b+1;for(let i=b+1;i<w.length;i++)if(w[i].h>=w[r].h)r=i;
  // Speed of the V: bars from the low until price first recovered the minimum fraction.
  let f=-1;for(let i=b+1;i<w.length;i++)if(w[i].h-L0>=P.minRecovery*D){f=i;break;}
  if(f<0||f-b>P.maxRecoveryM3)return null;
  const Hr=w[r].h,R=Hr-L0;
  if(R<P.minRecovery*D||Hr>H0+P.maxBeyondOrigin*D)return null;
  // The exact M1 bar that printed the recovery high.
  let hi=-1;for(let i=m1.length-1;i>=0&&m1[i].t>=w[b].t;i--)if(m1[i].h>=Hr-1e-9){hi=i;break;}
  const last=m1.at(-1),prev=m1.at(-2);
  const age=hi>=0?(last.t-m1[hi].t)/60000:Infinity;
  const fade=Hr-px,ext=fade/a3;
  const microBreak=prev&&last.c<prev.l;
  const hb=hi>=0?m1[hi]:w[r],wick=(hb.h-Math.max(hb.o,hb.c))/Math.max(hb.h-hb.l,1e-9);
  const belowHighBar=hi>=0&&last.c<(m1[hi].h+m1[hi].l)/2;
  const pinOnHigh=hi===m1.length-1&&wick>=0.5;
  const stage=hi>=0&&(hi<m1.length-1||pinOnHigh)&&fade>=P.failAtr*a3&&(microBreak||wick>=0.4||belowHighBar)&&ext<=P.maxExtensionAtr&&age<=P.maxAgeMin?'READY':
    (Hr-px)<=1.0*a3&&age<=P.maxAgeMin?'DEVELOPING':null;
  if(!stage)return null;
  return {family:'V_RECOVERY_FAILURE',stage,extreme:Hr,origin:H0,legLow:L0,invalidation:Hr+0.2*a3,target:Hr-0.5*R,
    legAtr:D/a3,recoveryFrac:R/D,legKey:w[a].t+':'+w[b].t,fvg:fvg(w.slice(b,r+1)),originDistanceAtr:(H0-Hr)/a3,extensionAtr:ext,ageMin:age,eventTime:hi>=0?m1[hi].t:w[r].t,
    evidence:[`leg ${(D/a3).toFixed(1)} ATR from origin`,`recovered ${(100*R/D).toFixed(0)}% of the leg`,
      `recovery high ${((H0-Hr)/a3).toFixed(2)} ATR from origin`,microBreak?'latest M1 closed below the previous M1 low':belowHighBar?'latest M1 closed below the midpoint of the M1 that printed the high':`high-bar upper wick ${(wick*100).toFixed(0)}% of range`,
      ...fvgEvidence(w.slice(b,r+1),a3),
      `price ${ext.toFixed(2)} ATR off the recovery high`]};
}
function spike(m3,m1,px,a3,P){
  if(m3.length<P.lookbackM3+3)return null;
  const recent=m3.slice(-3),prior=m3.slice(-P.lookbackM3-3,-3);
  const hi=Math.max(...recent.map(x=>x.h)),lo=Math.min(...recent.map(x=>x.l));
  const priorHigh=Math.max(...prior.map(x=>x.h));
  let lowIdx=-1,highIdx=-1;for(let i=0;i<recent.length;i++){if(recent[i].l===lo&&lowIdx<0)lowIdx=i;if(recent[i].h===hi)highIdx=i;}
  if(hi-lo<P.minImpulseAtr*a3||hi<=priorHigh||lowIdx>highIdx)return null;
  let k=-1;for(let i=m1.length-1;i>=0&&m1[i].t>=recent[0].t;i--)if(m1[i].h>=hi-1e-9){k=i;break;}
  const last=m1.at(-1),prev=m1.at(-2);
  const age=k>=0?(last.t-m1[k].t)/60000:Infinity,fade=hi-px,ext=fade/a3;
  const rejecting=last.c<prev.l||(last.c-last.l)<=0.5*(last.h-last.l);
  // A pin bar that printed the high and closed in its lower half is a completed rejection.
  const pin=k===m1.length-1&&(last.h-Math.max(last.o,last.c))>=0.5*(last.h-last.l);
  const stage=k>=0&&(k<m1.length-1||pin)&&fade>=P.failAtr*a3&&rejecting&&ext<=P.maxExtensionAtr&&age<=P.maxAgeMin?'READY':
    age<=P.maxAgeMin&&fade<P.failAtr*a3?'DEVELOPING':null;
  if(!stage)return null;
  return {family:'SPIKE_REJECTION',stage,extreme:hi,origin:lo,invalidation:hi+0.2*a3,target:hi-0.5*(hi-lo),
    legKey:'spike:'+recent[lowIdx].t,fvg:fvg(recent),legAtr:(hi-lo)/a3,sweepAtr:(hi-priorHigh)/a3,extensionAtr:ext,ageMin:age,eventTime:k>=0?m1[k].t:recent.at(-1).t,
    evidence:[`impulse ${((hi-lo)/a3).toFixed(1)} ATR inside 3 M3 bars`,`new high ${((hi-priorHigh)/a3).toFixed(2)} ATR beyond the prior ${P.lookbackM3} M3 bars`,
      rejecting?'latest M1 is rejecting (close in lower half or below prior low)':'no rejection yet',`price ${ext.toFixed(2)} ATR off the spike high`]};
}
function bos(m3,m1,px,a3,P){
  const done=m3.filter(x=>x.complete);if(done.length<P.shelfBars+3)return null;
  for(let k=done.length-1;k>=Math.max(P.shelfBars,done.length-P.recentBreakM3);k--){
    const brk=done[k],shelf=Math.min(...done.slice(k-P.shelfBars,k).map(x=>x.l));
    if(!(brk.c<shelf&&brk.o-brk.c>=P.minBodyAtr*a3))continue;
    const pause=m3.slice(m3.indexOf(brk)+1);
    if(pause.length<1||pause.length>P.maxPauseBars)return null;
    const pauseDone=pause.filter(x=>x.complete);if(!pauseDone.length)return null;
    if(pause.some(x=>Math.abs(x.c-x.o)>P.maxPauseBodyAtr*a3))return null;
    const pHigh=Math.max(...pause.map(x=>x.h)),pLow=Math.min(...pauseDone.map(x=>x.l));
    if(pHigh>shelf+P.reclaimAtr*a3)return null;
    const wicks=pauseDone.some(x=>x.h-Math.max(x.o,x.c)>=Math.abs(x.c-x.o));
    const last=m1.at(-1);const trend=done[Math.max(0,k-12)].h>shelf;
    const broke=last.c<pLow,ext=(pLow-px)/a3;
    const stage=broke&&wicks&&trend&&ext<=P.maxExtensionAtr?'READY':!broke&&trend?'DEVELOPING':null;
    if(!stage)return null;
    return {family:'BREAK_PAUSE_CONTINUATION',stage,extreme:pHigh,origin:shelf,invalidation:pHigh+0.2*a3,target:pLow-(done[Math.max(0,k-12)].h-shelf)*0.5,
      legKey:'bos:'+brk.t,breakBodyAtr:(brk.o-brk.c)/a3,pauseBars:pause.length,extensionAtr:Math.max(0,ext),ageMin:(last.t-brk.t)/60000,eventTime:brk.t,
      evidence:[`M3 close broke the ${P.shelfBars}-bar shelf with a ${((brk.o-brk.c)/a3).toFixed(2)} ATR body`,
        `${pause.length} small counter-candle(s) failed to reclaim the shelf`,wicks?'pause candles show rejection wicks':'pause has no rejection wick',
        broke?'latest M1 closed below the pause low':'pause low not broken yet']};
  }
  return null;
}
function rc(m3,m1,px,a3,P){
  // Mirror of V8 (BUY): here the SELL form is "rally, then lower highs back toward the rally origin".
  const w=m1.slice(-90);if(w.length<30)return null;
  let top=0;for(let i=1;i<w.length;i++)if(w[i].h>w[top].h)top=i;
  if(top>w.length-8)return null;
  let base=top;for(let i=Math.max(0,top-P.maxLegM1);i<top;i++)if(w[i].l<w[base].l)base=i;
  const L0=w[base].l,H0=w[top].h,D=H0-L0;if(D<P.minLegAtr*a3||top-base>P.maxLegM1)return null;
  const after=w.slice(top+1);const highs=[];
  for(let i=1;i<after.length-1;i++)if(after[i].h>after[i-1].h&&after[i].h>=after[i+1].h)highs.push(after[i].h);
  let lower=0;for(let i=1;i<highs.length;i++)if(highs[i]<highs[i-1])lower++;
  const retrace=(H0-px)/D,room=(px-L0)/D;
  const last=after.at(-1),brk=after.length>6&&last.c<Math.min(...after.slice(-6,-1).map(x=>x.l));
  if(lower<P.minHigherLows||retrace<P.minRecovery||room<P.roomFrac)return null;
  const stage=brk?'READY':'DEVELOPING';
  return {family:'RECOVERY_CONTINUATION',stage,extreme:highs.at(-1),origin:L0,invalidation:highs.at(-1)+0.1*a3,target:L0,
    legKey:'rc:'+w[top].t,legAtr:D/a3,recoveryFrac:retrace,roomFrac:room,extensionAtr:0,ageMin:(last.t-w[top].t)/60000,eventTime:w[top].t,
    evidence:[`flush leg ${(D/a3).toFixed(1)} ATR in ${top-base} M1 bars`,`${lower} successive lower M1 swing highs`,`${(100*room).toFixed(0)}% of the leg left to the origin`,brk?'latest M1 broke the recent micro range':'micro range intact']};
}

/**
 * detect({m1, forming, bid, ask}) -> {atrM3, atrM1, candidates:[...]} where each
 * candidate is {family, direction, stage: READY|DEVELOPING, entry, invalidation,
 * target, riskPts, rewardPts, evidence[], eventKey, ...measurements}.
 * m1: closed bars [{t,o,h,l,c}] (t = open time ms), oldest first.
 */
export function detect({m1,forming=null,bid,ask}){
  if(!Array.isArray(m1)||m1.length<40)return {engineVersion:ENGINE_VERSION,atrM3:0,atrM1:0,candidates:[]};
  const m3=buildM3(m1,forming),done=m3.filter(x=>x.complete);
  const a3=atr(done),a1=atr(m1);if(!(a3>0))return {engineVersion:ENGINE_VERSION,atrM3:0,atrM1:a1,candidates:[]};
  const P=ENGINE_PARAMS,out=[];
  // Higher context in the trade's own sign: drift over the last 2 hours (40 M3) and
  // where price sits inside that range (0 = at the low, 1 = at the high).
  const w2=done.slice(-40),mid=(bid+ask)/2;
  const hi2=Math.max(...w2.map(x=>x.h)),lo2=Math.min(...w2.map(x=>x.l)),drift=(mid-w2[0].o)/a3;
  const ctx=d=>({driftWithTradeAtr:d==='SELL'?-drift:drift,rangePos:(mid-lo2)/Math.max(hi2-lo2,1e-9),
    rangeAtr:(hi2-lo2)/a3,hourUtc:new Date(m1.at(-1).t+60000).getUTCHours()});
  for(const direction of ['SELL','BUY']){
    const sell=direction==='SELL';
    const b3=sell?m3:m3.map(mirror),b1=sell?m1:m1.map(mirror);
    const px=sell?bid:-ask;
    for(const [fn,p] of [[vrf,P.vrf],[spike,P.spike],[bos,P.bos],[rc,P.rc]]){
      const c=fn(b3,b1,px,a3,p);if(!c)continue;
      const s=sell?1:-1,un=x=>x*s;
      const entry=sell?bid:ask;
      const res={...c,direction,entry,extreme:un(c.extreme),origin:un(c.origin),invalidation:un(c.invalidation),target:un(c.target),
        ...(c.legLow!==undefined?{legLow:un(c.legLow)}:{}),
        ...(c.fvg?{fvg:{low:Math.min(un(c.fvg.low),un(c.fvg.high)),high:Math.max(un(c.fvg.low),un(c.fvg.high))}}:{}),
        riskPts:Math.abs(un(c.invalidation)-entry),rewardPts:Math.abs(entry-un(c.target)),
        // One campaign-start opportunity per structural leg; a new extreme inside the same leg is the same setup.
        eventKey:`${c.family}|${direction}|${c.legKey}`};
      if(c.family==='RECOVERY_CONTINUATION'){res.referenceDirection=sell?'MIRRORED':'BUY_V8';}
      res.context=ctx(direction);
      out.push(res);
    }
  }
  return {engineVersion:ENGINE_VERSION,atrM3:a3,atrM1:a1,m3Bars:m3.length,candidates:out};
}
