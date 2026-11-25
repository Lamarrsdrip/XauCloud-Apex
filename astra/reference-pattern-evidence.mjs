// Causal measurements for research, not a trade trigger or calibrated prediction.
export function referencePatternEvidence({bars,quote,structure,forming,ticks}) {
  const tail=bars.slice(-12),a=structure.atr;
  const series=tail.map(b=>({at:b.time,high:b.high,low:b.low,close:b.close}));
  const side=(direction)=>{
    const buy=direction==='BUY',sign=buy?1:-1;
    const extreme=buy?Math.min(...tail.map(b=>b.low)):Math.max(...tail.map(b=>b.high));
    const i=tail.findIndex(b=>(buy?b.low:b.high)===extreme),after=tail.slice(i+1),before=tail.slice(0,i);
    const prior=before.length?(buy?Math.min(...before.map(b=>b.low)):Math.max(...before.map(b=>b.high))):null;
    const current=buy?quote.ask:quote.bid,latest=tail.at(-1);
    const breakLevel=after.length>=2?(buy?after.at(-2).high:after.at(-2).low):null;
    const consecutive=after.slice(1).map((b,j)=>buy?b.low>after[j].low:b.high<after[j].high).filter(Boolean).length;
    const opposing=(buy?structure.swingHighs:structure.swingLows).map(p=>p.price).filter(p=>sign*(p-current)>0).sort((x,y)=>sign*(x-y))[0]??null;
    return {direction,localExtreme:{at:tail[i].time,price:extreme},priorExtreme:prior,
      barsAfterExtreme:after.length,localRecoverySteps:consecutive,
      displacementFromExtremeAtr:sign*(current-extreme)/a,
      latestCloseVsBreakLevel:breakLevel==null?null:sign*(latest.close-breakLevel)/a,
      nextOpposingConfirmedPivot:opposing,roomToPivotAtr:opposing==null?null:sign*(opposing-current)/a,
      closedBarEvidence:{failedAcceptance:buy?structure.lowerFailedAcceptance:structure.upperFailedAcceptance,
        failedRecovery:buy?structure.failedBearishRecovery:structure.failedBullishRecovery,
        localBreak:buy?structure.bosBuy:structure.bosSell},
      intrabarEvidence:{formingBar:forming?{at:forming.time,open:forming.open,high:forming.high,low:forming.low,close:forming.close}:null,
        tickCount:ticks.length,microBreak:buy?structure.microBosBuy:structure.microBosSell,
        lastTickAt:ticks.at(-1)?.time??null}};
  };
  return {kind:'OBSERVED_PREFIX_MEASUREMENTS_NOT_ENTRY_AUTHORITY',closedBarSequence:series,alternatives:[side('BUY'),side('SELL')]};
}
