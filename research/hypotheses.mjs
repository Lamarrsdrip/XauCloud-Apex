// A-priori hypotheses derived from the reference narration/charts, frozen
// 2026-11-25 BEFORE ATR-normalised results were read. Never edited after
// looking at HELD_OUT. rangePosT = position in the 2h range on the trade's
// failure side (1 = selling at the range high / buying at the range low).
const rp=r=>r.direction==='SELL'?r.context.rangePos:1-r.context.rangePos;
export const HYPOTHESES={
  H0_ALL:()=>true,
  H1_CONTINUATION_ALIGNED:r=>r.family==='BREAK_PAUSE_CONTINUATION'&&r.context.driftWithTradeAtr>=2,          // V1/V4/V6 "trend continuation"
  H2_VRF_AT_EXTREME:r=>r.family==='V_RECOVERY_FAILURE'&&r.recoveryFrac>=0.8&&rp(r)>=0.8,                      // V2/V5/V7/V9 back into origin, top of range
  H3_SPIKE_NEW_EXTREME:r=>r.family==='SPIKE_REJECTION'&&rp(r)>=0.9&&r.legAtr>=3,                                // V3 vertical spike, FVG fill
  H4_ACTIVE_SESSION:r=>r.context.hourUtc>=7&&r.context.hourUtc<17,
  H5_REFERENCE_COMPOSITE:r=>(HYPOTHESES.H1_CONTINUATION_ALIGNED(r)||HYPOTHESES.H2_VRF_AT_EXTREME(r)||HYPOTHESES.H3_SPIKE_NEW_EXTREME(r))&&r.context.hourUtc>=6&&r.context.hourUtc<17
};
export function scoreRows(rows,days){
  const out={n:rows.length,perDay:days?rows.length/days:null};
  for(const k of ['1_1','2_1','3_1.5']){const d=rows.filter(r=>['WIN','LOSS'].includes(r.o.hitAtr?.[k]));const w=d.filter(r=>r.o.hitAtr[k]==='WIN').length;const [a,b]=k.split('_').map(Number);
    out['win'+k]=d.length?w/d.length:null;out['expR'+k]=d.length?(w*a-(d.length-w)*b)/b/d.length:null;}
  // Standard error of the 1:1 win rate, so differences can be judged against noise.
  out.se1_1=out.win1_1!=null?Math.sqrt(out.win1_1*(1-out.win1_1)/Math.max(1,rows.length)):null;
  return out;
}
