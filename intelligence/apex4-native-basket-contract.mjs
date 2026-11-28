// Research contract for the next native basket adapter. Never manufactures
// STRONG grades or approved hours. It consumes the canonical Outlook record.
export const basketPolicy=Object.freeze({schema:'APEX_NATIVE_BASKET_V1',targetGoldMove:5,stopLoss:null,holdMinutes:null,orderGapMs:250});
export function clipForEquity(equity){
 if(!Number.isFinite(equity)||equity<20)return 0;
 return equity>=1000?.50:equity>=500?.20:equity>=200?.10:equity>=100?.05:equity>=50?.02:.01;
}
export function basketFromEntry({id,side,entry,source}){
 if(typeof id!=='string'||!id||!['BUY','SELL'].includes(side)||!Number.isFinite(entry)||entry<=5||
    !['CANONICAL_STRONG_OUTLOOK','NATIVE_XAUCLOUD_PULLBACK'].includes(source))return null;
 return {schema:basketPolicy.schema,id,side,source,anchor:entry,target:Math.round((entry+(side==='BUY'?5:-5))*1e8)/1e8,stopLoss:null,holdMinutes:null};
}
// Approved hours are supplied by a versioned historical policy; they cannot
// be inferred from a signal, a preferred window, or the current quote.
export function canonicalStrongBasket(signal,approvedWatHours,now=Date.now()){
 if(!signal||signal.grade!=='STRONG'||signal.status!=='ACTIONABLE'||!Array.isArray(approvedWatHours)||
    !Number.isFinite(now)||!Number.isFinite(signal.publishedAt)||!Number.isFinite(signal.expiresAt)||
    signal.publishedAt>now||signal.expiresAt<=now)return null;
 const hour=new Date(signal.publishedAt+3600000).getUTCHours();
 if(!approvedWatHours.includes(hour))return null;
 return basketFromEntry({id:signal.id,side:signal.side,entry:signal.entry,source:'CANONICAL_STRONG_OUTLOOK'});
}
