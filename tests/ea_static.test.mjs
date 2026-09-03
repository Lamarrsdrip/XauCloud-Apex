import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';const s=fs.readFileSync(new URL('../ea/XauCloud-Apex.mq5',import.meta.url),'utf8');
test('no broker SL',()=>{assert.doesNotMatch(s,/trade\.(Buy|Sell)\([^\n]*,[^\n]*,[^\n]*,[^\n]*,[1-9]/);assert.match(s,/noSL=true/)});
test('15 percent then double margin ladder',()=>{assert.match(s,/baseMarginPct=15/);assert.match(s,/layerMultiplier=2/);assert.match(s,/MathPow\(C\.layerMultiplier,layers\)/)});
test('setup is multi-stage not blind fade',()=>{for(const x of ['WATCH_ARMED','rejected','microBreak','CONFIRMED_EXHAUSTION_REVERSAL'])assert.match(s,new RegExp(x))});
test('adds require profit and confirmation',()=>{assert.match(s,/if\(p<=0\)return/);assert.match(s,/continuation\|\|s\.pullbackFail\|\|s\.microBreak/);assert.match(s,/spaced&&earned/)});
test('equity target basket close',()=>{assert.match(s,/eq>=targetEq/);assert.match(s,/BASKET_EQUITY_TARGET/)});
test('learning adjustments consumed',()=>{assert.match(s,/learnEntryAdj/);assert.match(s,/learnAddAdj/)});
