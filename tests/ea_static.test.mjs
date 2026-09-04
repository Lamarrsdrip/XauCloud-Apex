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
test('EA license is wired into event telemetry for backend/EA enforcement, without touching strategy logic',()=>{assert.match(s,/input string InpApexLicense=""/);assert.match(s,/\\"license\\":\\"%s\\".*InpApexLicense/)});
test('customer-facing identity is clean (XauCloud Apex), internal version metadata retained for traceability as v3.5.x, and no internal dev codenames leak into customer-facing constants',()=>{
 assert.match(s,/#property copyright "XauCloud Apex"/);
 assert.match(s,/#property version   "3\.520"/);
 assert.match(s,/#define APEX_VERSION "XauCloud-Apex_v3\.5\.2"/);
 assert.doesNotMatch(s,/APEX_VERSION "XauCloud-Apex_v3\.5\.1-RecoveryExit40"/);
 assert.doesNotMatch(s,/APEX_VERSION "XauCloud-Apex_v3\.5\.0/);
 assert.doesNotMatch(s,/Default180-BE50|15-50-100-MarginLadder|TraderSync/);
});
test('v3.5.2: no separate EA infrastructure token — the Apex license alone authenticates every backend call, via the X-Apex-License header',()=>{
 assert.doesNotMatch(s,/InpEaToken/);
 assert.doesNotMatch(s,/REPLACE_EA_TOKEN/);
 assert.doesNotMatch(s,/Authorization: Bearer /);
 assert.match(s,/string hdr="X-Apex-License: "\+InpApexLicense\+"\\r\\nContent-Type: application\/json\\r\\n";/);
 assert.doesNotMatch(s,/\/api\/ea\/config\?account=%I64d&license=%s/);
 assert.match(s,/ep=StringFormat\("\/api\/ea\/config\?account=%I64d",AccountInfoInteger\(ACCOUNT_LOGIN\)\);/);
});
test('ConfigPoll surfaces the HTTP transport code and reports APEX_CONFIG_POLL_OK / APEX_CONFIG_POLL_FAIL explicitly, not just APEX_READY',()=>{
 assert.match(s,/bool Http\(string method,string ep,string body,string &resp,int &code\)\{/);
 assert.match(s,/Print\("APEX_CONFIG_POLL_FAIL httpCode=",code," reason=",reason\);/);
 assert.match(s,/Print\("APEX_CONFIG_POLL_OK licenseStatus=ACTIVE armed=",\(C\.armed\?"true":"false"\)," source=REMOTE account=",AccountInfoInteger\(ACCOUNT_LOGIN\)," version=",APEX_VERSION\);/);
 assert.match(s,/Print\("APEX_CONFIG_POLL_FAIL httpCode=",code," reason=",lastLicenseStatus\);/);
});
test('a transport-level failure (edge/proxy/network) is distinguished from a genuine backend license-state failure, never mislabeled, and the license is never printed unmasked',()=>{
 assert.match(s,/string MaskLicense\(string k\)\{int n=StringLen\(k\);if\(n<=8\)return"\*\*\*";return StringSubstr\(k,0,5\)\+"…"\+StringSubstr\(k,n-4,4\);\}/);
 assert.match(s,/string TransportFailReason\(int code\)\{/);
 assert.match(s,/if\(code==403\)return"FORBIDDEN_403_LIKELY_EDGE_OR_PROXY_BLOCK";/);
 assert.match(s,/if\(code==401\)return"UNAUTHORIZED_401";/);
 assert.match(s,/if\(code==429\)return"RATE_LIMITED_429";/);
 assert.match(s,/Print\("APEX_AUTH_FAIL status=",code," reason=",reason," license=",MaskLicense\(InpApexLicense\)\);/);
 assert.match(s,/Print\("APEX_AUTH_FAIL status=",code," reason=",lastLicenseStatus," license=",MaskLicense\(InpApexLicense\)\);/);
 // the raw license value must never appear directly (unmasked) in a Print(...) call — every
 // Print(...) that references InpApexLicense must go through MaskLicense() first
 const printCalls = s.match(/Print\([^;]*?\);/gs) || [];
 for (const call of printCalls) {
   if (call.includes('InpApexLicense')) {
     assert.match(call, /MaskLicense\(InpApexLicense\)/, `Print call references InpApexLicense unmasked: ${call}`);
   }
 }
 // response body is captured on a transport failure for diagnosis, truncated (not unbounded)
 assert.match(s,/if\(StringLen\(r\)>0\)Print\("APEX_CONFIG_POLL_FAIL_BODY ",StringSubstr\(r,0,220\)\);/);
});
test('operational scan-state logging is deduplicated (only prints on state change) and covers the documented wait/watch/entry reasons',()=>{
 assert.match(s,/void ScanLog\(string state,string reason=""\)\{/);
 assert.match(s,/if\(sig==lastScanState\)return;/);
 for(const reason of ['SYMBOL_MISMATCH','LICENSE_NOT_ACTIVE','ACCOUNT_NOT_ARMED','COOLDOWN_ACTIVE','NO_TICKS','WATCHING_FOR_REJECTION','WAITING_FOR_MICRO_BOS','WAIT_M3_CONFIRMATION','ENTRY_SCORE_TOO_LOW','WATCH_EXPIRED','WAIT_NO_STRONG_IMPULSE_OR_LIQUIDITY_SWEEP'])
  assert.match(s,new RegExp(reason),`missing scan reason ${reason}`);
 assert.match(s,/ScanLog\("ENTRY_READY",""\);/);
});
test('scan-state diagnostics are purely observational: the core scan gate is unchanged (armed + cooldown + Observe/Start), no new blocking condition can silently prevent a real setup',()=>{
 // symbolContains gate only blocks when the configured substring truly does not match _Symbol —
 // for the real deployment (XAUUSDm contains XAUUSD) this can never trigger, so it changes nothing in practice
 assert.match(s,/if\(StringFind\(_Symbol,C\.symbolContains\)<0\)\{ScanLog\("WAIT","SYMBOL_MISMATCH"\);return;\}/);
 assert.match(s,/if\(!C\.armed\)\{ScanLog\("WAIT","ACCOUNT_NOT_ARMED"\);return;\}/);
 assert.match(s,/Snap s=Observe\(\);\s*\n\s*if\(s\.valid\)\{\s*\n\s*ScanLog\("ENTRY_READY",""\);\s*\n\s*Start\(s\);/);
});
test('duplicate-instance detection is logging-only and never gates trading logic (arbitrating ownership automatically would itself be a behavior change)',()=>{
 assert.match(s,/void DupInstanceCheck\(\)\{/);
 assert.match(s,/GlobalVariableCheck\(key\)/);
 // the only statement inside the duplicate-detection branch is a ScanLog call — no return/CloseAll/etc
 assert.match(s,/if\(ownerChart!=ChartID\(\)&&\(now-last\)<\(InpConfigPollSeconds\*3\)\)\{\s*\n\s*ScanLog\("DUPLICATE_INSTANCE_WARNING",StringFormat\("otherChartId=%I64d_thisChartId=%I64d_magic=%I64d",ownerChart,ChartID\(\),InpMagic\)\);\s*\n\s*\}/);
 assert.match(s,/DupInstanceCheck\(\);/);
});
test('order execution is logged locally (APEX_ORDER_SENT / APEX_ORDER_REJECTED) in addition to the existing Emit telemetry',()=>{
 assert.match(s,/Print\("APEX_ORDER_REJECTED retcode=",trade\.ResultRetcode\(\)/);
 assert.match(s,/Print\("APEX_ORDER_SENT layer=",layers\+1/);
});

test('v3.5.1 Recovery-To-Entry exit: enabled by default, arms at 40% of the ORIGINAL fixed SL distance',()=>{
 assert.match(s,/InpRecoveryExitEnabled=true/);
 assert.match(s,/InpRecoveryExitArmPctOfSL=40\.0/);
});
test('Recovery-To-Entry: original SL distance is captured once at L1 open (firstInitialSLPrice) and never mutated afterward — independent of any later break-even SL move',()=>{
 assert.match(s,/firstInitialSLPrice=sl;/);
 assert.match(s,/double originalSLDist=MathAbs\(firstEntryPrice-firstInitialSLPrice\);/);
 // firstSLPrice (current, BE-mutable) and firstInitialSLPrice (frozen at open) must be distinct fields
 assert.match(s,/double.*firstSLPrice=0,firstInitialSLPrice=0/);
});
test('Recovery-To-Entry: arms only once adverse move reaches the configured % of original SL, measured from the L1 entry price, and never disarms once armed',()=>{
 assert.match(s,/double adverseDist=campDir>0\?MathMax\(0\.0,firstEntryPrice-masterPx\):MathMax\(0\.0,masterPx-firstEntryPrice\);/);
 assert.match(s,/double adversePctOfSL=\(adverseDist\/originalSLDist\)\*100\.0;/);
 assert.match(s,/if\(!recoveryExitArmed&&adversePctOfSL>=MathMax\(0\.0,C\.recoveryExitArmPctOfSL\)\)\{/);
 assert.match(s,/recoveryExitArmed=true;/);
 // no code path ever sets recoveryExitArmed back to false except a fresh campaign (Start/Finish/OnTimer recovery-scan reset)
 const falseSites = (s.match(/recoveryExitArmed=false;/g)||[]).length;
 assert.equal(falseSites, 5); // global initializer, OpenLayer(new L1), Start(), Finish(), OnTimer POSITION_SCAN_ONLY branch
});
test('Recovery-To-Entry: once armed, closes the WHOLE basket the moment price recovers to the original L1 entry price — does not wait for profit',()=>{
 assert.match(s,/if\(recoveryExitArmed\)\{/);
 assert.match(s,/bool recoveredToEntry=\(campDir>0\?masterPx>=firstEntryPrice:masterPx<=firstEntryPrice\);/);
 assert.match(s,/if\(recoveredToEntry\)\{\s*\n\s*if\(n>0\)CloseAll\(\);/);
 assert.match(s,/Finish\("RECOVERY_TO_ENTRY_EXIT","DEEP_ADVERSE_MOVE_RECOVERED_TO_MASTER_ENTRY"\)/);
});
test('Recovery-To-Entry emits RECOVERY_EXIT_ARMED with entry price, original SL price, current price, adverse distance, adverse % of SL, and the threshold',()=>{
 assert.match(s,/Emit\("RECOVERY_EXIT_ARMED",StringFormat\(",\\"entryPrice\\":%\.5f,\\"originalSLPrice\\":%\.5f,\\"currentPrice\\":%\.5f,\\"adverseDist\\":%\.5f,\\"adversePctOfSL\\":%\.2f,\\"armThresholdPct\\":%\.2f"/);
});
test('Recovery-To-Entry emits RECOVERY_TO_ENTRY_EXIT on the actual exit',()=>{
 assert.match(s,/Emit\("RECOVERY_TO_ENTRY_EXIT",StringFormat\(",\\"entryPrice\\":%\.5f,\\"originalSLPrice\\":%\.5f,\\"currentPrice\\":%\.5f,\\"armThresholdPct\\":%\.2f"/);
});
test('Recovery-To-Entry runs before break-even, fixed-SL guard, and ratchet in Manage() so a damaged-then-recovered setup is never misread as a normal profitable exit',()=>{
 const recoveryIdx=s.indexOf('Recovery-To-Entry Exit:');
 const beIdx=s.indexOf('Master break-even: once the WHOLE Apex basket');
 const guardIdx=s.indexOf('Synthetic master/L1 fixed SL guard');
 const ratchetIdx=s.indexOf('Percentage profit ratchet, based on campaign-start balance');
 assert.ok(recoveryIdx>0&&beIdx>recoveryIdx&&guardIdx>beIdx&&ratchetIdx>guardIdx);
});
test('Recovery-To-Entry state (firstInitialSLPrice, recoveryExitArmed) persists through SaveState/LoadState so a restart mid-armed-state still closes on recovery',()=>{
 assert.match(s,/\\"firstInitialSLPrice\\":%\.5f,\\"recoveryExitArmed\\":%s/);
 assert.match(s,/firstInitialSLPrice=jd\(j,"firstInitialSLPrice",0\);recoveryExitArmed=jb\(j,"recoveryExitArmed",false\);/);
});
test('remote config sync includes the Recovery-To-Entry fields, not just UI-only local inputs',()=>{
 assert.match(s,/C\.recoveryExitEnabled=jb\(r,"recoveryExitEnabled",C\.recoveryExitEnabled\);/);
 assert.match(s,/C\.recoveryExitArmPctOfSL=jd\(r,"recoveryExitArmPctOfSL",C\.recoveryExitArmPctOfSL\);/);
});
test('effective-config telemetry (Emit cfgFields and APEX_EFFECTIVE_CONFIG print) includes the Recovery-To-Entry fields',()=>{
 assert.match(s,/\\"recoveryExitEnabled\\":%s,\\"recoveryArmPctOfSL\\":%\.2f/);
 assert.match(s,/" recoveryExit=",\(C\.recoveryExitEnabled\?"true":"false"\)/);
 assert.match(s,/" recoveryArmPctOfSL=",DoubleToString\(C\.recoveryExitArmPctOfSL,2\)/);
 assert.match(s,/" hardTP=",DoubleToString\(C\.normalTargetProfitPct,2\)/);
});
