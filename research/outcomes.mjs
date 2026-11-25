// Spread-aware forward outcome of a hypothetical market entry at the close of
// the signal minute. Archive bars are MID prices: SELL enters at bid=mid-s/2 and
// exits at ask=mid+s/2 (BUY mirrored). Inside one minute the path order is
// unknown, so a bar touching both target and stop counts as the STOP (conservative).
// ATR-scaled first-touch pairs [target, stop] in units of the signal's M3 ATR.
export const ATR_PAIRS=[[1,1],[2,1],[3,1.5]];
export function forwardOutcome(fwd,{direction,entry,invalidation,spread,targets=[5],horizonMin=120,atr=0}){
  const sell=direction==='SELL',half=spread/2;
  let mfe=0,mae=0,mfe30=0,mae30=0;const hit={};
  const structural={result:'OPEN',r:null};const risk=Math.abs(invalidation-entry);
  for(const T of targets)hit[T]='OPEN';
  const hitAtr={};for(const [a,b] of ATR_PAIRS)hitAtr[a+'_'+b]=atr>0?'OPEN':null;
  for(let i=0;i<fwd.length&&i<horizonMin;i++){
    const b=fwd[i];
    const fav=sell?entry-(b.l+half):(b.h-half)-entry;
    const adv=sell?(b.h+half)-entry:entry-(b.l-half);
    mfe=Math.max(mfe,fav);mae=Math.max(mae,adv);if(i<30){mfe30=mfe;mae30=mae;}
    for(const T of targets)if(hit[T]==='OPEN'){if(adv>=T)hit[T]='LOSS';else if(fav>=T)hit[T]='WIN';}
    for(const [a,s2] of ATR_PAIRS){const k=a+'_'+s2;if(hitAtr[k]==='OPEN'){if(adv>=s2*atr)hitAtr[k]='LOSS';else if(fav>=a*atr)hitAtr[k]='WIN';}}
    if(structural.result==='OPEN'&&risk>0){
      if(adv>=risk){structural.result='STOP';structural.r=-1;}
      else if(fav>=1.5*risk){structural.result='TARGET';structural.r=1.5;}
    }
  }
  if(structural.result==='OPEN'&&risk>0&&fwd.length){const last=fwd[Math.min(fwd.length,horizonMin)-1];
    const exitFav=sell?entry-(last.c+half):(last.c-half)-entry;structural.r=exitFav/risk;structural.result='TIME';}
  return {mfe,mae,mfe30,mae30,hit,hitAtr,atr,structural,riskPts:risk};
}
