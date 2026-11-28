import assert from 'node:assert/strict';
import {test} from 'node:test';
import {basketFromEntry,clipForEquity,canonicalStrongBasket,nativeOutlookHours,nativeOutlookReplayCsv,nativeBasketStatus,candidateVolumes,basketPolicy,nativeStrategy,nativeStrategyWire} from '../intelligence/apex4-native-basket-contract.mjs';
test('equity tiers and fixed original anchor',()=>{
 for(const [equity,lot] of [[19.99,0],[20,.01],[49.99,.01],[50,.02],[99.99,.02],[100,.05],[200,.10],[500,.20],[1000,.50]])assert.equal(clipForEquity(equity),lot);
 const source='NATIVE_XAUCLOUD_PULLBACK';
 const buy=basketFromEntry({id:'a',side:'BUY',entry:3700,source});
 const sell=basketFromEntry({id:'b',side:'SELL',entry:3700,source});
 assert.equal(buy.target,3705);assert.equal(sell.target,3695);assert.equal(buy.stopLoss,null);assert.equal(buy.holdMinutes,null);
});
test('only canonical strong, fresh, approved WAT hours',()=>{
 const publishedAt=Date.parse('2026-11-27T08:00:00Z');
 const signal={id:'x',side:'BUY',entry:3700,grade:'STRONG',status:'ACTIONABLE',publishedAt,expiresAt:publishedAt+25000};
 const now=publishedAt+500;
 assert.equal(canonicalStrongBasket(signal,[9],now).target,3705);
 for(const grade of ['STANDARD','WEAK',undefined])assert.equal(canonicalStrongBasket({...signal,grade},[9],now),null);
 assert.equal(canonicalStrongBasket(signal,[],now),null);
 assert.equal(canonicalStrongBasket(signal,[8],now),null);
 assert.equal(canonicalStrongBasket(signal,[9],signal.expiresAt),null);
 assert.equal(canonicalStrongBasket({...signal,status:'WATCHING'},[9],now),null);
});

test('canonical replay is chronological, grade-filtered and rejects duplicate hourly identity',()=>{
 const at=Date.parse('2026-11-27T07:00:00Z');
 const s={id:'strong-1',engine:'OUTLOOK',canonical:true,side:'BUY',entry:3700,grade:'STRONG',status:'ACTIONABLE',publishedAt:at,expiresAt:at+60000};
 assert.deepEqual(nativeOutlookHours(),[8,9]);
 assert.throws(()=>nativeOutlookHours('25'),/INVALID_NATIVE_OUTLOOK_HOURS/);
 const csv=nativeOutlookReplayCsv([null,{...s,id:'weak',grade:'WEAK'},{...s,id:'private',canonical:false},s],nativeOutlookHours());
 assert.equal(csv,[at/1000,at/1000+60,s.id,'BUY',3700,'STRONG',8].join(',')+'\n');
 assert.equal(nativeOutlookReplayCsv([s],[10]),'');
 assert.throws(()=>nativeOutlookReplayCsv([s,{...s,id:'conflict'}],[8]),/DUPLICATE_CANONICAL_OUTLOOK/);
});
test('dashboard reports the actual shared basket target, not old SL or TP2',()=>{
 const b={basketActive:true,side:-1,anchor:3700,target:3695,positions:4,orders:4};
 assert.equal(nativeBasketStatus(b,1,true).target,3695);
 assert.equal(nativeBasketStatus(b,1,true).stopLoss,null);
 assert.equal(nativeBasketStatus({...b,target:3696},1,true),null);
 assert.equal(nativeBasketStatus({...b,basketActive:false},1,true),null);
 assert.equal(nativeBasketStatus({basketActive:false,side:0,anchor:0,target:0,positions:0,orders:0},1,false).active,false);
});

test('dynamic lots descend through every legal step until a broker check passes',()=>{
 assert.equal(basketPolicy.orderGapMs,100);
 assert.deepEqual(candidateVolumes(.05,.01,100,.01),[.05,.04,.03,.02,.01]);
 assert.deepEqual(candidateVolumes(.05,.02,100,.01),[.05,.04,.03,.02]);
 assert.deepEqual(candidateVolumes(.05,.01,.03,.01),[.03,.02,.01]);
 assert.deepEqual(candidateVolumes(.05,.1,100,.1),[]);
 assert.deepEqual(candidateVolumes(.05,.001,100,.001).slice(-3),[.003,.002,.001]);
 assert.equal(candidateVolumes(.05,.01,100,.01).find(v=>v<=.025),.02);
 assert.equal(candidateVolumes(.05,.01,100,.01).find(v=>v<=.009),undefined);
});
test('native dashboard reports the actual smaller accepted lot and current margin',()=>{
 const status=nativeBasketStatus({basketActive:true,side:1,anchor:3700,target:3705,positions:5,orders:5,
  preferredVolume:.05,lastFillVolume:.01,freeMargin:1.25,equity:98,orderGapMs:100},1,true);
 assert.equal(status.lastFillVolume,.01);assert.equal(status.preferredVolume,.05);
 assert.equal(status.freeMargin,1.25);assert.equal(status.orderGapMs,100);
 assert.equal(nativeBasketStatus({basketActive:true,side:1,anchor:3700,target:3705,positions:5,orders:5,
  preferredVolume:.05,lastFillVolume:.06},1,true),null);
});

test('strategy wire never provides an Outlook plan in pullback-only or paused mode',()=>{
 const at=Date.parse('2026-11-27T07:00:00Z');
 const signal={id:'a',side:'BUY',entry:3700,grade:'STRONG',status:'ACTIONABLE',publishedAt:at,expiresAt:at+25000};
 const plan=canonicalStrongBasket(signal,[8],at);
 assert.equal(nativeStrategy(undefined),'BOTH');
 assert.equal(nativeStrategy('OUTLOOK'),'OUTLOOK');
 assert.equal(nativeStrategy('bad'),'BOTH');
 assert.equal(nativeStrategyWire({armed:true,strategy:'PULLBACK',plan,signal}),'NONE|ARMED_NO_PLAN|PULLBACK');
 assert.equal(nativeStrategyWire({armed:false,strategy:'BOTH',plan,signal}),'NONE|NOT_ARMED|BOTH');
 assert.equal(nativeStrategyWire({armed:true,strategy:'BOTH',plan,signal}),['NATIVE','a','BUY',3700,3705,at/1000,at/1000+25,'BOTH'].join('|'));
 assert.equal(nativeStrategyWire({armed:true,strategy:'OUTLOOK',plan,signal}).split('|').at(-1),'OUTLOOK');
 assert.throws(()=>nativeStrategyWire({armed:true,strategy:'bad'}),/INVALID_NATIVE_STRATEGY/);
});
test('native quote and strategy acknowledgment are validated rather than inferred',()=>{
 const at=Date.now();
 const b={basketActive:false,side:0,anchor:0,target:0,positions:0,orders:0,strategy:'PULLBACK',terminalArmed:true,buyScore:7,sellScore:2,quote:{bid:3700,ask:3700.2,atMs:at}};
 const snap=nativeBasketStatus(b,at,true);
 assert.equal(snap.strategy,'PULLBACK');assert.equal(snap.buyScore,7);assert.equal(snap.terminalArmed,true);
 assert.deepEqual(snap.quote,b.quote);
 assert.equal(nativeBasketStatus({...b,strategy:'invalid'},at,true).strategy,null);
 assert.equal(nativeBasketStatus({...b,quote:{...b.quote,atMs:at-10000}},at,true).quote,null);
 assert.equal(nativeBasketStatus({...b,buyScore:100},at,true).buyScore,null);
});
