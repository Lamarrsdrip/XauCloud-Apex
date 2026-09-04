import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';const s=fs.readFileSync(new URL('../ea/XauCloud-Apex.mq5',import.meta.url),'utf8');

test('no broker SL on pyramid adds — sl defaults to 0 and is only ever set inside the firstNormal (L1/master) branch',()=>{
 assert.match(s,/double sl=0;\s*\n\s*if\(firstNormal&&C\.normalFixedSLGoldMove>0\)sl=/);
});
test('fixed master SL is an XAU price-move distance, not pips or money: BUY subtracts, SELL adds',()=>{
 assert.match(s,/dir>0\?reqPrice-C\.normalFixedSLGoldMove:reqPrice\+C\.normalFixedSLGoldMove/);
});
test('v3.4 default fixed SL is 30 (XAU move)',()=>{
 assert.match(s,/InpNormalFixedSLGoldMove=30\.0/);
});
test('v3.4 three-tier margin ladder: L1 (layers<=0), L2 (layers==1), L3+ (else), each clamped to (0,100]',()=>{
 assert.match(s,/if\(layers<=0\)pct=clamp\(C\.normalL1MarginPct,0\.1,100\.0\);/);
 assert.match(s,/else if\(layers==1\)pct=clamp\(C\.normalL2MarginPct,0\.1,100\.0\);/);
 assert.match(s,/else pct=clamp\(C\.normalL3PlusMarginPct,0\.1,100\.0\);/);
});
test('v3.4 default margin ladder is 15/50/100',()=>{
 assert.match(s,/InpNormalMarginPct=15\.0/);
 assert.match(s,/InpNormalL2MarginPct=50\.0/);
 assert.match(s,/InpNormalL3PlusMarginPct=100\.0/);
});
test('UNLIMITED profile margin sizing is untouched by the v3.4 NORMAL ladder (still uses baseMarginPct * layerMultiplier^layers)',()=>{
 assert.match(s,/\}else\{\s*\n\s*double basePct=C\.baseMarginPct;\s*\n\s*pct=MathMin\(100\.0,basePct\*MathPow\(C\.layerMultiplier,layers\)\);/);
});
test('hard basket TP defaults to 0 (disabled) and the disabled state actually zeroes the target, not just the input default',()=>{
 assert.match(s,/InpNormalTakeProfitPct=0\.0/);
 assert.match(s,/C\.normalTargetProfitPct>0\?cycleStart\*\(1\.0\+C\.normalTargetProfitPct\/100\.0\):0\.0/);
});
test('master break-even: enabled by default, +50% trigger, moves ONLY the master ticket SL to its own entry price',()=>{
 assert.match(s,/InpMasterBreakEvenEnabled=true/);
 assert.match(s,/InpMasterBreakEvenTriggerPct=50\.0/);
 assert.match(s,/double campaignProfitPct=\(p\/cycleStart\)\*100\.0;/);
 assert.match(s,/double beSL=firstEntryPrice;/);
 assert.match(s,/SetMasterSL\(beSL,"CAMPAIGN_PROFIT_REACHED_BE_TRIGGER"\)/);
});
test('master break-even is one-way: once armed (SL at-or-past entry) it never re-triggers, so it can never widen the SL back out',()=>{
 assert.match(s,/bool beAlreadyActive=\(campDir>0\?firstSLPrice>=firstEntryPrice:firstSLPrice<=firstEntryPrice\)&&firstSLPrice>0;/);
 assert.match(s,/campaignProfitPct>=C\.masterBreakEvenTriggerPct&&!beAlreadyActive/);
 // the only call site for SetMasterSL is the BE block itself — no other code path can move the SL
 const setMasterSLCalls = (s.match(/SetMasterSL\(/g)||[]).length;
 assert.equal(setMasterSLCalls, 2); // 1 function definition reference inside itself (none) + 1 real call site + the fn signature line itself doesn't match "SetMasterSL(" as a call
});
test('master break-even is based on WHOLE BASKET profit (BasketProfit-derived p), not just the L1 leg in isolation',()=>{
 assert.match(s,/double p=BasketProfit\(\),campEq=cycleStart\+p;/);
 assert.match(s,/double campaignProfitPct=\(p\/cycleStart\)\*100\.0;/);
});
test('percentage profit ratchet: floor is computed from peak (mfe) as % of campaign-start balance, not dollars',()=>{
 assert.match(s,/double peakPct=\(mfe\/cycleStart\)\*100\.0;/);
 assert.match(s,/ratchetSteps=\(int\)MathFloor\(\(peakPct-C\.ratchetTriggerPct\)\/C\.ratchetStepPct\)/);
 assert.match(s,/protectedPct=C\.ratchetLockPct\+\(double\)ratchetSteps\*C\.ratchetLockStepPct/);
 assert.match(s,/protectedProfit=cycleStart\*\(protectedPct\/100\.0\)/);
 assert.match(s,/if\(p<=protectedProfit\)/);
});
test('v3.4 ratchet trigger default is 180 (not the old 200)',()=>{
 assert.match(s,/InpRatchetTriggerPct=180\.0/);
 assert.match(s,/InpRatchetLockPct=100\.0/);
 assert.match(s,/InpRatchetStepPct=100\.0/);
 assert.match(s,/InpRatchetLockStepPct=100\.0/);
 assert.match(s,/InpProfitRatchetEnabled=true/);
});
test('the wrong v3.0.0 money-based ratchet fields must never appear in the canonical EA',()=>{
 for(const bad of ['InpRatchetTriggerMoney','InpRatchetLockMoney','InpRatchetStepMoney','InpRatchetLockStepMoney'])
  assert.doesNotMatch(s,new RegExp(bad));
});
test('the old dead floor mechanism (floorProfitPct / normalProfitFloorEnabled) has been removed, not left as unused dead code',()=>{
 assert.doesNotMatch(s,/floorProfitPct/);
 assert.doesNotMatch(s,/normalProfitFloorEnabled/);
});
test('no-orphan master-leg guard: whole basket closes immediately if the L1/master position is gone for any reason',()=>{
 assert.match(s,/bool MasterPositionExists\(\)\{/);
 assert.match(s,/C\.accountProfile=="NORMAL"&&camp&&masterTicket>0&&!MasterPositionExists\(\)/);
 assert.match(s,/Finish\("MASTER_LEG_CLOSED","MASTER_FIRST_TRADE_GONE_CLOSE_WHOLE_BASKET"\)/);
});
test('synthetic fixed-SL price guard closes the whole basket (not just L1) the instant price crosses the configured SL level, and automatically tracks a break-even move since it reads firstSLPrice',()=>{
 assert.match(s,/bool masterGuardHit=\(campDir>0\?guardPx<=firstSLPrice:guardPx>=firstSLPrice\);/);
 assert.match(s,/Finish\("MASTER_SL_BASKET_EXIT","MASTER_INPUT_FIXED_SL_HIT"\)/);
});
test('remote config sync: backend values (margin ladder, TP, fixed SL, BE, ratchet) actually populate the Config struct used at runtime',()=>{
 assert.match(s,/C\.normalL1MarginPct=jd\(r,"normalL1MarginPct",C\.normalL1MarginPct\);/);
 assert.match(s,/C\.normalL2MarginPct=jd\(r,"normalL2MarginPct",C\.normalL2MarginPct\);/);
 assert.match(s,/C\.normalL3PlusMarginPct=jd\(r,"normalL3PlusMarginPct",C\.normalL3PlusMarginPct\);/);
 assert.match(s,/C\.normalTargetProfitPct=jd\(r,"normalTargetProfitPct",C\.normalTargetProfitPct\);/);
 assert.match(s,/C\.normalFixedSLGoldMove=jd\(r,"normalFixedSLGoldMove",C\.normalFixedSLGoldMove\);/);
 assert.match(s,/C\.masterBreakEvenEnabled=jb\(r,"masterBreakEvenEnabled",C\.masterBreakEvenEnabled\);/);
 assert.match(s,/C\.masterBreakEvenTriggerPct=jd\(r,"masterBreakEvenTriggerPct",C\.masterBreakEvenTriggerPct\);/);
 assert.match(s,/C\.profitRatchetEnabled=jb\(r,"profitRatchetEnabled",C\.profitRatchetEnabled\);/);
 assert.match(s,/C\.ratchetTriggerPct=jd\(r,"ratchetTriggerPct",C\.ratchetTriggerPct\);/);
});
test('local EA Inputs seed the Config struct as the offline/pre-sync fallback (Defaults() reads Inp*, not a hardcoded literal)',()=>{
 assert.match(s,/C\.normalTargetProfitPct=InpNormalTakeProfitPct;/);
 assert.match(s,/C\.normalL1MarginPct=InpNormalMarginPct;/);
 assert.match(s,/C\.normalL2MarginPct=InpNormalL2MarginPct;/);
 assert.match(s,/C\.normalL3PlusMarginPct=InpNormalL3PlusMarginPct;/);
 assert.match(s,/C\.normalFixedSLGoldMove=InpNormalFixedSLGoldMove;/);
 assert.match(s,/C\.profitRatchetEnabled=InpProfitRatchetEnabled;/);
 assert.match(s,/C\.masterBreakEvenEnabled=InpMasterBreakEvenEnabled;/);
 assert.match(s,/C\.masterBreakEvenTriggerPct=InpMasterBreakEvenTriggerPct;/);
});
test('effective config source is tracked explicitly (REMOTE vs LOCAL_INPUT) and logged, never left ambiguous',()=>{
 assert.match(s,/string ConfigSource\(\)\{return everSyncedRemote\?"REMOTE":"LOCAL_INPUT";\}/);
 assert.match(s,/Print\("APEX_EFFECTIVE_CONFIG"/);
 assert.match(s,/everSyncedRemote=true;/);
 assert.match(s,/" l1MarginPct=",DoubleToString\(C\.normalL1MarginPct,2\)/);
 assert.match(s,/" masterBEEnabled=",\(C\.masterBreakEvenEnabled\?"true":"false"\)/);
});
test('margin sizing is logged for QA (balance, equity, freeMargin, leverage, configured/raw/normalized lot)',()=>{
 assert.match(s,/Emit\("MARGIN_CALC"/);
 assert.match(s,/marginRequiredFor1Lot/);
 assert.match(s,/rawCalculatedLot/);
 assert.match(s,/normalizedLot/);
});
test('actual filled lot is logged on layer open, distinct from the pre-trade requested lot',()=>{
 assert.match(s,/\\"actualFilledLot\\":%\.4f.*trade\.ResultVolume\(\)/);
});
test('setup is multi-stage not blind fade',()=>{for(const x of ['WATCH_ARMED','rejected','microBreak','CONFIRMED_EXHAUSTION_REVERSAL'])assert.match(s,new RegExp(x))});
test('adds require profit and confirmation',()=>{assert.match(s,/if\(p<=0\)return/);assert.match(s,/continuation\|\|s\.pullbackFail\|\|s\.microBreak/);assert.match(s,/spaced&&earned/)});
test('learning adjustments consumed',()=>{assert.match(s,/learnEntryAdj/);assert.match(s,/learnAddAdj/)});
test('campaign start emits the real feature vector the learning brain needs, not just the score',()=>{assert.match(s,/\\"impulseMult\\":%\.3f/);assert.match(s,/\\"wickRatio\\":%\.3f/);assert.match(s,/\\"m3\\":%s/);assert.match(s,/\\"m5\\":%s/)});
test('rejection zone width is configurable, not a silent magic number',()=>{assert.match(s,/rejectionZoneAtr\*s\.atr/);assert.doesNotMatch(s,/-\.12\*s\.atr/)});
test('restart recovery is magic-number scoped, not a blind PositionSelect guess',()=>{assert.match(s,/NewestMagicPosition/);assert.match(s,/PositionGetInteger\(POSITION_MAGIC\)!=InpMagic/);assert.doesNotMatch(s,/PositionSelect\(_Symbol\)&&PositionGetInteger\(POSITION_TYPE\)/)});
test('restart recovery persists and reloads local state (including master ticket / fixed-or-BE SL / mfe) so pyramiding and the ratchet floor do not silently reset',()=>{
 assert.match(s,/SaveState/);assert.match(s,/LoadState/);assert.match(s,/ClearState/);
 assert.match(s,/\\"masterTicket\\":%I64u/);
 assert.match(s,/\\"firstSLPrice\\":%\.5f/);
 assert.match(s,/\\"mfe\\":%\.2f/);
 assert.match(s,/mfe=jd\(j,"mfe",0\);/);
 assert.match(s,/firstSLPrice=jd\(j,"firstSLPrice",0\);/);
});
test('Strategy Tester can actually run the EA: WebRequest is skipped and it self-arms, instead of spamming ERR_FUNCTION_NOT_ALLOWED forever unarmed',()=>{assert.match(s,/if\(\(bool\)MQLInfoInteger\(MQL_TESTER\)\)return false;/);assert.match(s,/if\(\(bool\)MQLInfoInteger\(MQL_TESTER\)\)C\.armed=true;/)});
test('rejection/structure-break confirmation cannot resolve on the same candle that triggered the sweep — requires a later closed bar',()=>{assert.match(s,/watchSweepBarTime=m1\[1\]\.time/);assert.match(s,/if\(m1\[i\]\.time<=watchSweepBarTime\)continue;/);assert.match(s,/if\(m1\[1\]\.time>watchSweepBarTime\)\{if\(s\.dir<0\)bos=/)});
test('no setup-invalidation exit and no old money-ratchet — only target hit, profit ratchet, master SL, or broker/margin close end a campaign',()=>{assert.doesNotMatch(s,/Invalidated\(/);assert.doesNotMatch(s,/enableInvalidationExit/);assert.doesNotMatch(s,/invalidationGivebackPct/);assert.doesNotMatch(s,/INVALIDATED_PROFIT|INVALIDATED_LOSS/);assert.doesNotMatch(s,/normalAccountMaxMultiplier/)});
test('EA license is wired into config polling and event telemetry for backend/EA enforcement, without touching strategy logic',()=>{assert.match(s,/input string InpApexLicense=""/);assert.match(s,/license=%s.*InpApexLicense/);assert.match(s,/\\"license\\":\\"%s\\".*InpApexLicense/)});
test('customer-facing identity is clean (XauCloud Apex), internal version metadata retained for traceability as v3.4.x',()=>{
 assert.match(s,/#property copyright "XauCloud Apex"/);
 assert.match(s,/#define APEX_VERSION "XauCloud-Apex_v3\.4\.1"/);
});
