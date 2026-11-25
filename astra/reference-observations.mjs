// Observational reference retrieval. No execution authority or hindsight labels.
export function selectReferenceObservations(rows,context,limit=4) {
  const s=context?.structure||{},c=context?.campaign||{};
  const sides=c.positions?.length&&['BUY','SELL'].includes(c.direction)?[c.direction]:['BUY','SELL'];
  const wanted=new Set();
  if(s.upperFailedAcceptance||s.upperSweep)wanted.add('UPPER_REJECTION');
  if(s.lowerFailedAcceptance||s.lowerSweep)wanted.add('LOWER_RECOVERY');
  if(s.failedBullishRecovery||s.continuationSell)wanted.add('FAILED_RECOVERY');
  if(s.bosSell||s.microBosSell||s.failedBullishRecovery)wanted.add('SELL_CONTROL_SHIFT');
  if(s.bosBuy||s.microBosBuy||s.failedBearishRecovery)wanted.add('BUY_CONTROL_SHIFT');
  if(c.positions?.length)wanted.add('EARLY_CLUSTER');
  const rank=r=>r.features.reduce((a,f)=>a+(wanted.has(f)?2:0),0);
  const selected=[];
  // Preserve at least one example of each side when flat. An impulse sign is
  // not sufficient to infer a reversal or rule out trend continuation.
  for(const side of sides) {
    const candidates=rows.filter(r=>r.direction===side).sort((a,b)=>rank(b)-rank(a)||a.id.localeCompare(b.id));
    if(candidates.length)selected.push(candidates[0]);
  }
  const remaining=rows.filter(r=>sides.includes(r.direction)&&!selected.includes(r))
    .sort((a,b)=>rank(b)-rank(a)||a.id.localeCompare(b.id));
  return [...selected,...remaining].slice(0,limit).map(r=>({
    sourceFile:'reference-observations-2026-11-25.jsonl',id:r.id,direction:r.direction,
    setupFamily:r.family,timeframe:r.timeframe,evidenceSource:{sha256:r.sha256,timestampSeconds:r.prefix},
    observedFacts:r.observed,inferredInterpretation:r.hypothesis,unknown:r.unknown,
    labelOrigin:'OBSERVATION_NOT_TRADE_LABEL',informationBoundary:r.informationBoundary
  }));
}
