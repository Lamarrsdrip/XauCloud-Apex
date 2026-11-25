// Faithful JS port of the canonical EA's native detector (Observe() in
// ea/XauCloud-Apex.mq5, v3.8.8 rules preserved in v3.10.0) for research
// comparison on the same archive minutes. Defaults = data/config.json.
// Indexing mirrors MQL5 series arrays: s(1) is the latest CLOSED M1 bar.
export const NATIVE_DEFAULTS={impulseAtr:1.8,sweepAtr:0.05,rejectionBars:5,watchExpiryMinutes:12,rejectionZoneAtr:0.12,requireM3Confirm:true,wickBodyMin:0.10};

function atr14(m1){ // MT5 iATR: simple average of the last 14 true ranges, read at shift 1.
  let s=0;for(let i=m1.length-14;i<m1.length;i++){const b=m1[i],p=m1[i-1];s+=Math.max(b.h-b.l,Math.abs(b.h-p.c),Math.abs(b.l-p.c));}
  return s/14;
}
export function createNative(cfg=NATIVE_DEFAULTS){
  let S=null; // {dir,sweepBarTime,extreme,prior,armedAt}
  return function step(m1){ // m1 closed bars, oldest first; returns {dir,extreme,prior} when an entry would fire
    if(m1.length<95)return null;
    const s=i=>m1[m1.length-i],now=s(1).t+60000,a=atr14(m1);if(!(a>0))return null;
    const move=s(1).c-s(8).c,imp=move>=0?1:-1,impulseMult=Math.abs(move)/a;let directional=0;
    for(let i=1;i<=7;i++)if((imp>0&&s(i).c>s(i).o)||(imp<0&&s(i).c<s(i).o))directional++;
    let ph=-Infinity,pl=Infinity;for(let i=9;i<80;i++){ph=Math.max(ph,s(i).h);pl=Math.min(pl,s(i).l);}
    if(S){
      if(now-S.armedAt>cfg.watchExpiryMinutes*60000)S=null;
      else for(let i=1;i<=8;i++){if(s(i).t<=S.sweepBarTime)break;if((S.dir<0&&s(i).h>S.extreme)||(S.dir>0&&s(i).l<S.extreme)){S=null;break;}}
    }
    if(!S&&impulseMult>=cfg.impulseAtr&&directional>=5){
      const ex=imp>0?s(1).h:s(1).l;
      if(imp>0?ex>=ph+cfg.sweepAtr*a:ex<=pl-cfg.sweepAtr*a)S={dir:-imp,sweepBarTime:s(1).t,extreme:ex,prior:imp>0?ph:pl,armedAt:now};
    }
    if(!S)return null;
    let rej=false;
    for(let i=1;i<=Math.max(1,Math.min(cfg.rejectionBars,8));i++){
      const b=s(i);if(b.t<=S.sweepBarTime)continue;
      const body=Math.max(0.001,Math.abs(b.c-b.o));
      if(S.dir<0){if(b.h>=S.extreme-cfg.rejectionZoneAtr*a&&b.c<S.prior&&(b.h-Math.max(b.o,b.c))/body>=cfg.wickBodyMin)rej=true;}
      else if(b.l<=S.extreme+cfg.rejectionZoneAtr*a&&b.c>S.prior&&(Math.min(b.o,b.c)-b.l)/body>=cfg.wickBodyMin)rej=true;
    }
    let bosOk=false;
    if(s(1).t>S.sweepBarTime){
      const close=S.dir<0?s(1).c<s(2).l:s(1).c>s(2).h;
      const wick=S.dir<0?(s(1).l<s(3).l&&s(1).c<s(2).o):(s(1).h>s(3).h&&s(1).c>s(2).o);
      bosOk=close||wick;
    }
    let m3ok=true;
    if(cfg.requireM3Confirm){ // last CLOSED M3 bar colour + close beyond its midpoint
      const k=Math.floor(now/180000)*180000,grp=m1.filter(b=>b.t>=k-180000&&b.t<k);
      if(grp.length){const o=grp[0].o,c=grp.at(-1).c,h=Math.max(...grp.map(x=>x.h)),l=Math.min(...grp.map(x=>x.l));
        m3ok=S.dir<0?(c<o&&c<(h+l)/2):(c>o&&c>(h+l)/2);}else m3ok=false;
    }
    if(rej&&bosOk&&m3ok){const fired={dir:S.dir,extreme:S.extreme,prior:S.prior,atr:a};S=null;return fired;}
    return null;
  };
}
