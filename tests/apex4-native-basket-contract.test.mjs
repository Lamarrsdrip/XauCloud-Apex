import assert from 'node:assert/strict';
import {test} from 'node:test';
import {basketFromEntry,clipForEquity,canonicalStrongBasket} from '../intelligence/apex4-native-basket-contract.mjs';
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
