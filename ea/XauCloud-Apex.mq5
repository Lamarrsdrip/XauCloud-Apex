#property copyright "XauCloud Apex"
#property version   "3.600"
#property strict
#property description "ApexStack: XAUUSD exhaustion/reversal campaign with aggressive profit-side pyramiding"
// Internal build lineage: v3.5.1 (dev codename RecoveryExit40) adds the Recovery-To-Entry exit;
// v3.5.2 removes the separate infrastructure EA token — the Apex license alone now authenticates;
// v3.5.3 fixes a real regression where Strategy Tester was permanently blocked by the live-only
// license scan-gate, adds transport-vs-license failure diagnostics, and a browser User-Agent on
// outbound requests (auth/telemetry/diagnostics only — no trading-strategy change in v3.5.2/3.5.3).
// v3.5.3-DirectAPI: points the EA at api.apex.xaucloud.io, a hostname served directly by the
// same Node app but outside Hostinger's CDN/edge layer (the layer that was 403-blocking every
// live WebRequest); also replaces the OnInit post-hoc Tester override with an explicit IsTester()
// guard used at the point of definition (Defaults()/OnTimer()) so Tester authority is structural,
// not patched on afterward — the backend can never again block Strategy Tester.
// v3.6.0-LocalResilience: the backend origin also runs its own TLS/bot-fingerprint protection
// independent of the CDN, which still blocks MT5's WebRequest even via the direct-API hostname —
// an infrastructure problem outside the EA's control. Rather than let that make Apex depend on
// the backend to trade, this build adopts XauCloud Command Center's proven pattern: the backend
// is a monitoring/remote-arm channel only, never a dependency of trading logic. The last-known
// -good remote config (armed, license-active flag, every remotely-tunable trading parameter) is
// now cached to MT5 GlobalVariables on every successful ConfigPoll() and reloaded on restart/
// reattach, so an unreachable backend means "keep running on what I was last told", not "reset
// to unarmed and stop." Nothing is trusted until the backend has actually confirmed it at least
// once — a cold EA with zero prior contact still starts unarmed exactly as before.
#include <Trade/Trade.mqh>
CTrade trade;
#define APEX_VERSION "XauCloud-Apex_v3.6.0-LocalResilience"
#define APEX_MAGIC 8620260903
input string InpApiBase="https://api.apex.xaucloud.io";
input string InpApexLicense="";
input int InpConfigPollSeconds=8;
input int InpScanMilliseconds=250;
input bool InpRequireRemoteArm=true;
input long InpMagic=APEX_MAGIC;
input double InpNormalMarginPct=15.0;             // NORMAL L1 confirmation/probe margin % (1-100); local fallback only, backend can override
input double InpNormalL2MarginPct=50.0;           // NORMAL L2 confirmed-add margin %; local fallback only
input double InpNormalL3PlusMarginPct=100.0;      // NORMAL L3+ use up to this % of available margin; local fallback only
input double InpNormalTakeProfitPct=0.0;          // NORMAL hard basket TP %; 0 = disabled (ratchet governs the exit instead)
input double InpNormalFixedSLGoldMove=30.0;       // L1 fixed XAU price SL distance; 0 = no broker SL
input bool   InpProfitRatchetEnabled=true;        // Protect basket profit after it reaches the trigger, in % of campaign-start balance
input double InpRatchetTriggerPct=180.0;          // First trigger: +180% peak campaign profit
input double InpRatchetLockPct=100.0;             // At the trigger, protect +100% of campaign-start balance
input double InpRatchetStepPct=100.0;             // Every additional +100% peak profit...
input double InpRatchetLockStepPct=100.0;         // ...raises the protected floor another +100%
input bool   InpMasterBreakEvenEnabled=true;      // Move L1/master SL to its own entry price once triggered
input double InpMasterBreakEvenTriggerPct=50.0;   // Trigger: +50% whole-basket campaign profit
input bool   InpRecoveryExitEnabled=true;         // Arm once L1 suffers this % of its ORIGINAL fixed SL distance
input double InpRecoveryExitArmPctOfSL=40.0;      // Then close the whole basket if price recovers to the L1 entry
struct Config{bool armed;string account;string symbolContains;string targetMode,accountProfile;double targetEquity,targetMultiplier,normalTargetProfitPct,baseMarginPct,layerMultiplier;int maxLayers;double entryScore,addScore,impulseAtr,sweepAtr,addSpacingAtr,rejectionZoneAtr;int rejectionBars,watchExpiryMinutes,cooldownMinutes;bool requireM3Confirm,requireM5Context,learningEnabled;double learnEntryAdj,learnAddAdj;double normalL1MarginPct,normalL2MarginPct,normalL3PlusMarginPct,normalFixedSLGoldMove,ratchetTriggerPct,ratchetLockPct,ratchetStepPct,ratchetLockStepPct,masterBreakEvenTriggerPct,recoveryExitArmPctOfSL;bool profitRatchetEnabled,masterBreakEvenEnabled,recoveryExitEnabled;};
struct Snap{bool valid;int dir;double score,atr,price,extreme,impulseMult,sweepMult,wickRatio;bool swept,rejected,microBreak,m3,m5,continuation,pullbackFail;string sig,reason;};
Config C;int hAtr=INVALID_HANDLE;datetime lastCfg=0,lastEnd=0;bool camp=false;int campDir=0,layers=0;double cycleStart=0,targetEq=0,lastAdd=0,mfe=0,mae=0,firstEntryPrice=0,firstSLPrice=0,firstInitialSLPrice=0;bool recoveryExitArmed=false;ulong masterTicket=0;int masterGuardStage=0;datetime campStart=0;string campId="",campSig="";
bool watch=false;int watchDir=0;datetime watchStart=0,watchSweepBarTime=0;double watchExtreme=0,watchPrior=0,watchAtr=0;string watchSig="";
bool everSyncedRemote=false;string lastConfigSig="";string lastLicenseStatus="UNKNOWN";bool usingCachedConfig=false;
// Single source of truth for "are we running inside Strategy Tester" — used everywhere Tester
// needs to behave independently of the live backend (arming, the license scan-gate, duplicate-
// instance detection) instead of a scattered, easy-to-miss MQLInfoInteger(MQL_TESTER) at each site.
bool IsTester(){return (bool)MQLInfoInteger(MQL_TESTER);}
string trim(string s){StringTrimLeft(s);StringTrimRight(s);return s;} string raw(string j,string k){string n="\""+k+"\":";int p=StringFind(j,n);if(p<0)return"";p+=StringLen(n);while(p<StringLen(j)&&StringGetCharacter(j,p)==' ')p++;ushort c=StringGetCharacter(j,p);if(c=='\"'){int e=p+1;while(e<StringLen(j)&&StringGetCharacter(j,e)!='\"')e++;return StringSubstr(j,p+1,e-p-1);}int e=p;while(e<StringLen(j)){ushort x=StringGetCharacter(j,e);if(x==','||x=='}'||x==']')break;e++;}return trim(StringSubstr(j,p,e-p));}
double jd(string j,string k,double d){string v=raw(j,k);return v==""?d:StringToDouble(v);} int ji(string j,string k,int d){string v=raw(j,k);return v==""?d:(int)StringToInteger(v);} bool jb(string j,string k,bool d){string v=raw(j,k);if(v=="true")return true;if(v=="false")return false;return d;} string js(string j,string k,string d){string v=raw(j,k);return v==""?d:v;} ulong ju(string j,string k,ulong d){string v=raw(j,k);return v==""?d:(ulong)StringToInteger(v);}
bool Http(string method,string ep,string body,string &resp,int &code){
 code=0;
 if(IsTester())return false;
 // MT5's WebRequest sends no/unusual User-Agent by default, which some hosting edge/WAF layers
 // (e.g. Hostinger's) treat as bot traffic and block with a 403 before the request ever reaches
 // the app. A normal browser UA avoids that false-positive without weakening any real security —
 // the actual auth boundary is still the Apex license alone, checked server-side on every call.
 string hdr="X-Apex-License: "+InpApexLicense+"\r\nContent-Type: application/json\r\nUser-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36\r\n";
 char d[],r[];string rh;
 StringToCharArray(body,d,0,WHOLE_ARRAY,CP_UTF8);
 ResetLastError();
 code=WebRequest(method,InpApiBase+ep,hdr,7000,d,r,rh);
 if(code<0){Print("APEX_HTTP_ERROR ",GetLastError());return false;}
 resp=CharArrayToString(r,0,-1,CP_UTF8);
 return code>=200&&code<300;
}
string ConfigSource(){return everSyncedRemote?"REMOTE":(usingCachedConfig?"CACHED":"LOCAL_INPUT");}
// Never print the full license key — only a masked head/tail, matching the backend's own masking.
string MaskLicense(string k){int n=StringLen(k);if(n<=8)return"***";return StringSubstr(k,0,5)+"…"+StringSubstr(k,n-4,4);}
// Distinguishes a genuine transport/edge-level rejection (before the request ever reaches the
// Apex backend's own license logic, which always answers 200 with an explicit licenseStatus)
// from the backend's own license-state reasons, so a WAF/proxy block is never mislabeled as a
// license problem.
string TransportFailReason(int code){
 if(code==0)return"WEBREQUEST_TRANSPORT_ERROR";
 if(code==401)return"UNAUTHORIZED_401";
 if(code==403)return"FORBIDDEN_403_LIKELY_EDGE_OR_PROXY_BLOCK";
 if(code==404)return"NOT_FOUND_404";
 if(code==429)return"RATE_LIMITED_429";
 if(code>=500)return"SERVER_ERROR_"+IntegerToString(code);
 return"HTTP_"+IntegerToString(code);
}
void Emit(string type,string extra=""){
 string cfgFields=StringFormat(",\"l1MarginPct\":%.2f,\"l2MarginPct\":%.2f,\"l3PlusMarginPct\":%.2f,\"takeProfitPct\":%.2f,\"fixedSLGoldMove\":%.2f,\"beEnabled\":%s,\"beTriggerPct\":%.2f,\"recoveryExitEnabled\":%s,\"recoveryArmPctOfSL\":%.2f,\"ratchetEnabled\":%s,\"ratchetTriggerPct\":%.2f,\"ratchetLockPct\":%.2f,\"ratchetStepPct\":%.2f,\"ratchetLockStepPct\":%.2f,\"configSource\":\"%s\",\"eaVersion\":\"%s\"",
  C.normalL1MarginPct,C.normalL2MarginPct,C.normalL3PlusMarginPct,C.normalTargetProfitPct,C.normalFixedSLGoldMove,C.masterBreakEvenEnabled?"true":"false",C.masterBreakEvenTriggerPct,C.recoveryExitEnabled?"true":"false",C.recoveryExitArmPctOfSL,C.profitRatchetEnabled?"true":"false",C.ratchetTriggerPct,C.ratchetLockPct,C.ratchetStepPct,C.ratchetLockStepPct,ConfigSource(),APEX_VERSION);
 string b=StringFormat("{\"type\":\"%s\",\"account\":\"%I64d\",\"broker\":\"%s\",\"currency\":\"%s\",\"license\":\"%s\",\"symbol\":\"%s\",\"version\":\"%s\",\"campaignId\":\"%s\",\"signature\":\"%s\",\"direction\":%d,\"layers\":%d,\"balance\":%.2f,\"equity\":%.2f,\"freeMargin\":%.2f%s%s}",type,AccountInfoInteger(ACCOUNT_LOGIN),AccountInfoString(ACCOUNT_COMPANY),AccountInfoString(ACCOUNT_CURRENCY),InpApexLicense,_Symbol,APEX_VERSION,campId,campSig,campDir,layers,AccountInfoDouble(ACCOUNT_BALANCE),AccountInfoDouble(ACCOUNT_EQUITY),AccountInfoDouble(ACCOUNT_MARGIN_FREE),cfgFields,extra);
 string r;int code=0;Http("POST","/api/ea/event",b,r,code);
}
void PrintEffectiveConfig(){
 Print("APEX_EFFECTIVE_CONFIG",
  " version=",APEX_VERSION,
  " profile=",C.accountProfile,
  " l1MarginPct=",DoubleToString(C.normalL1MarginPct,2),
  " l2MarginPct=",DoubleToString(C.normalL2MarginPct,2),
  " l3PlusMarginPct=",DoubleToString(C.normalL3PlusMarginPct,2),
  " takeProfitPct=",DoubleToString(C.normalTargetProfitPct,2),
  " fixedSLGoldMove=",DoubleToString(C.normalFixedSLGoldMove,2),
  " masterBEEnabled=",(C.masterBreakEvenEnabled?"true":"false"),
  " masterBETriggerPct=",DoubleToString(C.masterBreakEvenTriggerPct,2),
  " recoveryExit=",(C.recoveryExitEnabled?"true":"false"),
  " recoveryArmPctOfSL=",DoubleToString(C.recoveryExitArmPctOfSL,2),
  " ratchetEnabled=",(C.profitRatchetEnabled?"true":"false"),
  " ratchetTriggerPct=",DoubleToString(C.ratchetTriggerPct,2),
  " ratchetLockPct=",DoubleToString(C.ratchetLockPct,2),
  " ratchetStepPct=",DoubleToString(C.ratchetStepPct,2),
  " ratchetLockStepPct=",DoubleToString(C.ratchetLockStepPct,2),
  " hardTP=",DoubleToString(C.normalTargetProfitPct,2),
  " source=",ConfigSource());
}
// Deduplicated operational-state log: only prints when the (state,reason) pair actually
// changes, so the 250ms scan loop never spams the log — purely observational, changes nothing.
string lastScanState="";
void ScanLog(string state,string reason=""){
 string sig=state+"|"+reason;
 if(sig==lastScanState)return;
 lastScanState=sig;
 if(reason=="")Print("APEX_",state);
 else Print("APEX_",state," reason=",reason);
}
// Terminal-wide GlobalVariable heartbeat so two XauCloud-Apex instances on the same account
// (e.g. attached to both M5 and H1 by mistake) can detect each other. Detection/logging only —
// does not gate trading logic, since arbitrating which instance "owns" execution safely would
// itself be a behavior change; the fix is to detach the extra chart.
string DupCheckKey(){return StringFormat("XauCloudApex_%I64d_%I64d",InpMagic,AccountInfoInteger(ACCOUNT_LOGIN));}
void DupInstanceCheck(){
 // Meaningless in Strategy Tester (each run is a fresh isolated instance; GlobalVariables can
 // persist stale entries across separate tester runs in the same terminal and would otherwise
 // produce spurious warnings) — this check exists only to catch a live-account misconfiguration.
 if(IsTester())return;
 string key=DupCheckKey();
 datetime now=TimeGMT();
 if(GlobalVariableCheck(key)){
   datetime last=(datetime)GlobalVariableGet(key);
   long ownerChart=(long)GlobalVariableGet(key+"_chart");
   if(ownerChart!=ChartID()&&(now-last)<(InpConfigPollSeconds*3)){
     ScanLog("DUPLICATE_INSTANCE_WARNING",StringFormat("otherChartId=%I64d_thisChartId=%I64d_magic=%I64d",ownerChart,ChartID(),InpMagic));
   }
 }
 GlobalVariableSet(key,(double)now);
 GlobalVariableSet(key+"_chart",(double)ChartID());
}
// Last-known-good remote config cache (MT5 terminal GlobalVariables — the same durable,
// restart-surviving key/value store XauCloud Command Center uses for its Prop Firm config).
// The backend is a monitoring/remote-arm channel only; trading itself must never depend on
// reaching it. A GlobalVariable is a double, so bools are stored as 1/0 and lastLicenseStatus
// is cached as a single "was ACTIVE last time we actually heard from the backend" flag — the
// OnTimer license gate only ever branches on ACTIVE-vs-not, so that's all it needs. Nothing is
// cached until at least one REAL successful ConfigPoll() has happened — a cold EA with no prior
// contact still starts from Inp*/local defaults exactly as before; only a previously-confirmed
// state is ever trusted across an outage or restart.
string CacheKey(string field){return StringFormat("XauCloudApex_Cfg_%I64d_%s",AccountInfoInteger(ACCOUNT_LOGIN),field);}
bool CacheGetD(string field,double &val){string k=CacheKey(field);if(!GlobalVariableCheck(k))return false;val=GlobalVariableGet(k);return true;}
void CacheSetD(string field,double val){GlobalVariableSet(CacheKey(field),val);}
void SaveConfigCache(){
 CacheSetD("armed",C.armed?1:0);
 CacheSetD("licenseActive",lastLicenseStatus=="ACTIVE"?1:0);
 CacheSetD("targetEquity",C.targetEquity);CacheSetD("targetMultiplier",C.targetMultiplier);
 CacheSetD("normalTargetProfitPct",C.normalTargetProfitPct);CacheSetD("baseMarginPct",C.baseMarginPct);
 CacheSetD("layerMultiplier",C.layerMultiplier);CacheSetD("maxLayers",C.maxLayers);
 CacheSetD("entryScore",C.entryScore);CacheSetD("addScore",C.addScore);
 CacheSetD("impulseAtr",C.impulseAtr);CacheSetD("sweepAtr",C.sweepAtr);
 CacheSetD("addSpacingAtr",C.addSpacingAtr);CacheSetD("rejectionZoneAtr",C.rejectionZoneAtr);
 CacheSetD("rejectionBars",C.rejectionBars);CacheSetD("watchExpiryMinutes",C.watchExpiryMinutes);
 CacheSetD("cooldownMinutes",C.cooldownMinutes);
 CacheSetD("requireM3Confirm",C.requireM3Confirm?1:0);CacheSetD("requireM5Context",C.requireM5Context?1:0);
 CacheSetD("learningEnabled",C.learningEnabled?1:0);
 CacheSetD("normalL1MarginPct",C.normalL1MarginPct);CacheSetD("normalL2MarginPct",C.normalL2MarginPct);
 CacheSetD("normalL3PlusMarginPct",C.normalL3PlusMarginPct);CacheSetD("normalFixedSLGoldMove",C.normalFixedSLGoldMove);
 CacheSetD("profitRatchetEnabled",C.profitRatchetEnabled?1:0);
 CacheSetD("ratchetTriggerPct",C.ratchetTriggerPct);CacheSetD("ratchetLockPct",C.ratchetLockPct);
 CacheSetD("ratchetStepPct",C.ratchetStepPct);CacheSetD("ratchetLockStepPct",C.ratchetLockStepPct);
 CacheSetD("masterBreakEvenEnabled",C.masterBreakEvenEnabled?1:0);CacheSetD("masterBreakEvenTriggerPct",C.masterBreakEvenTriggerPct);
 CacheSetD("recoveryExitEnabled",C.recoveryExitEnabled?1:0);CacheSetD("recoveryExitArmPctOfSL",C.recoveryExitArmPctOfSL);
 CacheSetD("cacheVersion",1);
}
void LoadConfigCache(){
 double v;
 if(!CacheGetD("cacheVersion",v))return;
 usingCachedConfig=true;
 if(CacheGetD("armed",v))C.armed=(v!=0);
 if(CacheGetD("licenseActive",v)&&v!=0)lastLicenseStatus="ACTIVE";
 if(CacheGetD("targetEquity",v))C.targetEquity=v; if(CacheGetD("targetMultiplier",v))C.targetMultiplier=v;
 if(CacheGetD("normalTargetProfitPct",v))C.normalTargetProfitPct=v; if(CacheGetD("baseMarginPct",v))C.baseMarginPct=v;
 if(CacheGetD("layerMultiplier",v))C.layerMultiplier=v; if(CacheGetD("maxLayers",v))C.maxLayers=(int)v;
 if(CacheGetD("entryScore",v))C.entryScore=v; if(CacheGetD("addScore",v))C.addScore=v;
 if(CacheGetD("impulseAtr",v))C.impulseAtr=v; if(CacheGetD("sweepAtr",v))C.sweepAtr=v;
 if(CacheGetD("addSpacingAtr",v))C.addSpacingAtr=v; if(CacheGetD("rejectionZoneAtr",v))C.rejectionZoneAtr=v;
 if(CacheGetD("rejectionBars",v))C.rejectionBars=(int)v; if(CacheGetD("watchExpiryMinutes",v))C.watchExpiryMinutes=(int)v;
 if(CacheGetD("cooldownMinutes",v))C.cooldownMinutes=(int)v;
 if(CacheGetD("requireM3Confirm",v))C.requireM3Confirm=(v!=0); if(CacheGetD("requireM5Context",v))C.requireM5Context=(v!=0);
 if(CacheGetD("learningEnabled",v))C.learningEnabled=(v!=0);
 if(CacheGetD("normalL1MarginPct",v))C.normalL1MarginPct=v; if(CacheGetD("normalL2MarginPct",v))C.normalL2MarginPct=v;
 if(CacheGetD("normalL3PlusMarginPct",v))C.normalL3PlusMarginPct=v; if(CacheGetD("normalFixedSLGoldMove",v))C.normalFixedSLGoldMove=v;
 if(CacheGetD("profitRatchetEnabled",v))C.profitRatchetEnabled=(v!=0);
 if(CacheGetD("ratchetTriggerPct",v))C.ratchetTriggerPct=v; if(CacheGetD("ratchetLockPct",v))C.ratchetLockPct=v;
 if(CacheGetD("ratchetStepPct",v))C.ratchetStepPct=v; if(CacheGetD("ratchetLockStepPct",v))C.ratchetLockStepPct=v;
 if(CacheGetD("masterBreakEvenEnabled",v))C.masterBreakEvenEnabled=(v!=0); if(CacheGetD("masterBreakEvenTriggerPct",v))C.masterBreakEvenTriggerPct=v;
 if(CacheGetD("recoveryExitEnabled",v))C.recoveryExitEnabled=(v!=0); if(CacheGetD("recoveryExitArmPctOfSL",v))C.recoveryExitArmPctOfSL=v;
 Print("APEX_CONFIG_CACHE_LOADED armed=",(C.armed?"true":"false")," licenseActive=",(lastLicenseStatus=="ACTIVE"?"true":"false")," source=CACHED");
}
void Defaults(){
 // Tester must always start armed from local Inputs, regardless of InpRequireRemoteArm — it never
 // talks to the live backend (Http() short-circuits for IsTester()), so remote-arm requirements
 // can never be satisfied there and would otherwise permanently block Strategy Tester.
 C.armed=IsTester()?true:!InpRequireRemoteArm;C.account="0";C.symbolContains="XAUUSD";C.targetMode="MULTIPLIER";C.accountProfile="NORMAL";
 C.targetEquity=1000;C.targetMultiplier=100;
 C.normalTargetProfitPct=InpNormalTakeProfitPct;
 C.baseMarginPct=100;
 C.layerMultiplier=2;C.maxLayers=0;C.entryScore=76;C.addScore=70;C.impulseAtr=1.8;C.sweepAtr=.05;C.rejectionBars=5;C.watchExpiryMinutes=12;C.addSpacingAtr=.22;C.rejectionZoneAtr=.12;C.cooldownMinutes=0;C.requireM3Confirm=true;C.requireM5Context=false;C.learningEnabled=true;C.learnEntryAdj=0;C.learnAddAdj=0;
 C.normalL1MarginPct=InpNormalMarginPct;
 C.normalL2MarginPct=InpNormalL2MarginPct;
 C.normalL3PlusMarginPct=InpNormalL3PlusMarginPct;
 C.normalFixedSLGoldMove=InpNormalFixedSLGoldMove;
 C.profitRatchetEnabled=InpProfitRatchetEnabled;
 C.ratchetTriggerPct=InpRatchetTriggerPct;
 C.ratchetLockPct=InpRatchetLockPct;
 C.ratchetStepPct=InpRatchetStepPct;
 C.ratchetLockStepPct=InpRatchetLockStepPct;
 C.masterBreakEvenEnabled=InpMasterBreakEvenEnabled;
 C.masterBreakEvenTriggerPct=InpMasterBreakEvenTriggerPct;
 C.recoveryExitEnabled=InpRecoveryExitEnabled;
 C.recoveryExitArmPctOfSL=InpRecoveryExitArmPctOfSL;
 // Overlay the last-known-good remote config, if one was ever actually confirmed by the
 // backend, so a restart/outage falls back to "what I was last told" instead of blindly
 // resetting to unarmed local defaults. Only meaningful when remote arming is in play —
 // InpRequireRemoteArm=false already means "always armed locally, ignore the backend"
 // and Tester never talks to the backend at all, so neither should consult the cache.
 if(!IsTester()&&InpRequireRemoteArm)LoadConfigCache();
}
string ConfigSignature(){return StringFormat("%.2f|%.2f|%.2f|%.2f|%.2f|%s|%.2f|%s|%.2f|%s|%.2f|%.2f|%.2f|%.2f|%s",C.normalL1MarginPct,C.normalL2MarginPct,C.normalL3PlusMarginPct,C.normalTargetProfitPct,C.normalFixedSLGoldMove,C.masterBreakEvenEnabled?"1":"0",C.masterBreakEvenTriggerPct,C.recoveryExitEnabled?"1":"0",C.recoveryExitArmPctOfSL,C.profitRatchetEnabled?"1":"0",C.ratchetTriggerPct,C.ratchetLockPct,C.ratchetStepPct,C.ratchetLockStepPct,ConfigSource());}
bool ConfigPoll(){
 string r,ep=StringFormat("/api/ea/config?account=%I64d",AccountInfoInteger(ACCOUNT_LOGIN));
 int code=0;
 if(!Http("GET",ep,"",r,code)){
   string reason=TransportFailReason(code);
   Print("APEX_AUTH_FAIL status=",code," reason=",reason," license=",MaskLicense(InpApexLicense));
   Print("APEX_CONFIG_POLL_FAIL httpCode=",code," reason=",reason);
   if(StringLen(r)>0)Print("APEX_CONFIG_POLL_FAIL_BODY ",StringSubstr(r,0,220));
   return false;
 }
 C.armed=jb(r,"armed",C.armed);C.account=js(r,"account",C.account);C.symbolContains=js(r,"symbolContains",C.symbolContains);C.targetMode=js(r,"targetMode",C.targetMode);C.accountProfile=js(r,"accountProfile",C.accountProfile);C.targetEquity=jd(r,"targetEquity",C.targetEquity);C.targetMultiplier=jd(r,"targetMultiplier",C.targetMultiplier);
 C.normalTargetProfitPct=jd(r,"normalTargetProfitPct",C.normalTargetProfitPct);
 C.baseMarginPct=jd(r,"baseMarginPct",C.baseMarginPct);
 C.layerMultiplier=jd(r,"layerMultiplier",C.layerMultiplier);C.maxLayers=ji(r,"maxLayers",C.maxLayers);C.entryScore=jd(r,"entryScore",C.entryScore);C.addScore=jd(r,"addScore",C.addScore);C.impulseAtr=jd(r,"impulseAtr",C.impulseAtr);C.sweepAtr=jd(r,"sweepAtr",C.sweepAtr);C.rejectionBars=ji(r,"rejectionBars",C.rejectionBars);C.watchExpiryMinutes=ji(r,"watchExpiryMinutes",C.watchExpiryMinutes);C.addSpacingAtr=jd(r,"addSpacingAtr",C.addSpacingAtr);C.rejectionZoneAtr=jd(r,"rejectionZoneAtr",C.rejectionZoneAtr);C.cooldownMinutes=ji(r,"cooldownMinutes",C.cooldownMinutes);C.requireM3Confirm=jb(r,"requireM3Confirm",C.requireM3Confirm);C.requireM5Context=jb(r,"requireM5Context",C.requireM5Context);C.learningEnabled=jb(r,"learningEnabled",C.learningEnabled);C.learnEntryAdj=jd(r,"entryScoreAdjustment",0);C.learnAddAdj=jd(r,"addScoreAdjustment",0);
 C.normalL1MarginPct=jd(r,"normalL1MarginPct",C.normalL1MarginPct);
 C.normalL2MarginPct=jd(r,"normalL2MarginPct",C.normalL2MarginPct);
 C.normalL3PlusMarginPct=jd(r,"normalL3PlusMarginPct",C.normalL3PlusMarginPct);
 C.normalFixedSLGoldMove=jd(r,"normalFixedSLGoldMove",C.normalFixedSLGoldMove);
 C.profitRatchetEnabled=jb(r,"profitRatchetEnabled",C.profitRatchetEnabled);
 C.ratchetTriggerPct=jd(r,"ratchetTriggerPct",C.ratchetTriggerPct);
 C.ratchetLockPct=jd(r,"ratchetLockPct",C.ratchetLockPct);
 C.ratchetStepPct=jd(r,"ratchetStepPct",C.ratchetStepPct);
 C.ratchetLockStepPct=jd(r,"ratchetLockStepPct",C.ratchetLockStepPct);
 C.masterBreakEvenEnabled=jb(r,"masterBreakEvenEnabled",C.masterBreakEvenEnabled);
 C.masterBreakEvenTriggerPct=jd(r,"masterBreakEvenTriggerPct",C.masterBreakEvenTriggerPct);
 C.recoveryExitEnabled=jb(r,"recoveryExitEnabled",C.recoveryExitEnabled);
 C.recoveryExitArmPctOfSL=jd(r,"recoveryExitArmPctOfSL",C.recoveryExitArmPctOfSL);
 everSyncedRemote=true;
 lastLicenseStatus=js(r,"licenseStatus","UNKNOWN");
 SaveConfigCache();
 if(lastLicenseStatus=="ACTIVE"){
   Print("APEX_CONFIG_POLL_OK licenseStatus=ACTIVE armed=",(C.armed?"true":"false")," source=REMOTE account=",AccountInfoInteger(ACCOUNT_LOGIN)," version=",APEX_VERSION);
 }else{
   Print("APEX_AUTH_FAIL status=",code," reason=",lastLicenseStatus," license=",MaskLicense(InpApexLicense));
   Print("APEX_CONFIG_POLL_FAIL httpCode=",code," reason=",lastLicenseStatus);
 }
 string sig=ConfigSignature();
 if(sig!=lastConfigSig){lastConfigSig=sig;PrintEffectiveConfig();Emit("CONFIG_SYNC");}
 return true;
}
double ATR(){double x[];ArraySetAsSeries(x,true);if(CopyBuffer(hAtr,0,0,2,x)<2)return 0;return x[1];} bool Rates(ENUM_TIMEFRAMES tf,int n,MqlRates &r[]){ArraySetAsSeries(r,true);return CopyRates(_Symbol,tf,0,n,r)>=n-2;} double clamp(double x,double a,double b){return MathMax(a,MathMin(b,x));}
Snap Observe(){Snap s;s.valid=false;s.dir=0;s.score=0;s.atr=ATR();s.price=0;s.extreme=0;s.impulseMult=0;s.sweepMult=0;s.wickRatio=0;s.swept=false;s.rejected=false;s.microBreak=false;s.m3=false;s.m5=false;s.continuation=false;s.pullbackFail=false;s.sig="NONE";s.reason="";if(s.atr<=0)return s;MqlRates m1[],m3[],m5[];if(!Rates(PERIOD_M1,90,m1)||!Rates(PERIOD_M3,24,m3)||!Rates(PERIOD_M5,18,m5))return s;
 double move=m1[1].close-m1[8].close;int imp=move>=0?1:-1;s.impulseMult=MathAbs(move)/s.atr;int directional=0;for(int i=1;i<=7;i++)if((imp>0&&m1[i].close>m1[i].open)||(imp<0&&m1[i].close<m1[i].open))directional++;
 double ph=-DBL_MAX,pl=DBL_MAX;for(int i=9;i<80;i++){ph=MathMax(ph,m1[i].high);pl=MathMin(pl,m1[i].low);} if(!watch&&s.impulseMult>=C.impulseAtr&&directional>=5){double ex=imp>0?m1[1].high:m1[1].low;bool swept=imp>0?ex>=ph+C.sweepAtr*s.atr:ex<=pl-C.sweepAtr*s.atr;if(swept){watch=true;watchDir=-imp;watchStart=TimeCurrent();watchSweepBarTime=m1[1].time;watchExtreme=ex;watchPrior=imp>0?ph:pl;watchAtr=s.atr;watchSig=watchDir<0?"SELL_UPSIDE_LIQUIDITY_EXHAUST":"BUY_DOWNSIDE_LIQUIDITY_EXHAUST";Emit("WATCH_ARMED",StringFormat(",\"watchDir\":%d,\"impulseAtr\":%.3f",watchDir,s.impulseMult));}}
 if(!watch)return s;if(TimeCurrent()-watchStart>C.watchExpiryMinutes*60){watch=false;return s;} s.dir=watchDir;s.sig=watchSig;s.extreme=watchExtreme;s.swept=true;s.impulseMult=MathAbs(m1[1].close-m1[8].close)/s.atr;s.price=s.dir>0?SymbolInfoDouble(_Symbol,SYMBOL_ASK):SymbolInfoDouble(_Symbol,SYMBOL_BID);
 int rb=MathMax(1,MathMin(C.rejectionBars,8));bool rej=false,bos=false;double bestW=0;for(int i=1;i<=rb;i++){if(m1[i].time<=watchSweepBarTime)continue;double body=MathMax(_Point,MathAbs(m1[i].close-m1[i].open));double up=m1[i].high-MathMax(m1[i].open,m1[i].close),lo=MathMin(m1[i].open,m1[i].close)-m1[i].low;if(s.dir<0){bestW=MathMax(bestW,up/body);if(m1[i].high>=watchExtreme-C.rejectionZoneAtr*s.atr&&m1[i].close<watchPrior)rej=true;}else{bestW=MathMax(bestW,lo/body);if(m1[i].low<=watchExtreme+C.rejectionZoneAtr*s.atr&&m1[i].close>watchPrior)rej=true;}}
 if(m1[1].time>watchSweepBarTime){if(s.dir<0)bos=(m1[1].close<m1[2].low)||(m1[1].low<m1[3].low&&m1[1].close<m1[2].open);else bos=(m1[1].close>m1[2].high)||(m1[1].high>m1[3].high&&m1[1].close>m1[2].open);}s.rejected=rej;s.microBreak=bos;s.wickRatio=bestW;s.m3=s.dir<0?(m3[1].close<m3[1].open&&m3[1].close<(m3[1].high+m3[1].low)/2):(m3[1].close>m3[1].open&&m3[1].close>(m3[1].high+m3[1].low)/2);s.m5=s.dir<0?m5[1].close<m5[1].open:m5[1].close>m5[1].open;
 double score=25+clamp(s.impulseMult/C.impulseAtr*15,0,18)+(s.rejected?24:0)+(s.microBreak?22:0)+(s.m3?8:0)+(s.m5?3:0)+clamp(bestW*2,0,5);s.score=clamp(score,0,100);double threshold=C.entryScore+(C.learningEnabled?C.learnEntryAdj:0);s.valid=s.rejected&&s.microBreak&&(!C.requireM3Confirm||s.m3)&&(!C.requireM5Context||s.m5)&&s.score>=threshold;s.reason=s.valid?"CONFIRMED_EXHAUSTION_REVERSAL":"WATCHING_FOR_REJECTION_AND_BOS";return s;}
int VolDigits(){double st=SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_STEP);return st>=1?0:st>=.1?1:st>=.01?2:3;} double NormVol(double v){double mn=SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_MIN),mx=SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_MAX),st=SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_STEP);if(st<=0)st=mn;v=MathFloor(v/st)*st;return NormalizeDouble(MathMax(mn,MathMin(mx,v)),VolDigits());}
double VolumeForMargin(int dir,double pct){
 double balance=AccountInfoDouble(ACCOUNT_BALANCE),equity=AccountInfoDouble(ACCOUNT_EQUITY),free=AccountInfoDouble(ACCOUNT_MARGIN_FREE),leverage=(double)AccountInfoInteger(ACCOUNT_LEVERAGE);
 double budget=free*clamp(pct,.1,100)/100.0,mx=SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_MAX),mn=SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_MIN),p=dir>0?SymbolInfoDouble(_Symbol,SYMBOL_ASK):SymbolInfoDouble(_Symbol,SYMBOL_BID),m=0,m1lot=0;
 ENUM_ORDER_TYPE t=dir>0?ORDER_TYPE_BUY:ORDER_TYPE_SELL;
 if(!OrderCalcMargin(t,_Symbol,1.0,p,m1lot))m1lot=0;
 if(free<=0){Emit("MARGIN_CALC",StringFormat(",\"balance\":%.2f,\"equity\":%.2f,\"freeMargin\":%.2f,\"leverage\":%.0f,\"configuredMarginPct\":%.2f,\"marginRequiredFor1Lot\":%.2f,\"rawCalculatedLot\":0,\"normalizedLot\":0,\"rejected\":true,\"rejectReason\":\"NO_FREE_MARGIN\"",balance,equity,free,leverage,pct,m1lot));return 0;}
 double rawLot=m1lot>0?budget/m1lot:0;
 if(OrderCalcMargin(t,_Symbol,mx,p,m)&&m<=budget){
   double nv=NormVol(mx);
   Emit("MARGIN_CALC",StringFormat(",\"balance\":%.2f,\"equity\":%.2f,\"freeMargin\":%.2f,\"leverage\":%.0f,\"configuredMarginPct\":%.2f,\"marginRequiredFor1Lot\":%.2f,\"rawCalculatedLot\":%.4f,\"normalizedLot\":%.4f,\"rejected\":false",balance,equity,free,leverage,pct,m1lot,rawLot,nv));
   return nv;
 }
 double lo=0,hi=mx;for(int i=0;i<36;i++){double mid=(lo+hi)/2;if(!OrderCalcMargin(t,_Symbol,mid,p,m)||m>budget)hi=mid;else lo=mid;}
 double v=NormVol(lo);
 if(v<mn){
   if(OrderCalcMargin(t,_Symbol,mn,p,m)&&m<=budget){
     Emit("MARGIN_CALC",StringFormat(",\"balance\":%.2f,\"equity\":%.2f,\"freeMargin\":%.2f,\"leverage\":%.0f,\"configuredMarginPct\":%.2f,\"marginRequiredFor1Lot\":%.2f,\"rawCalculatedLot\":%.4f,\"normalizedLot\":%.4f,\"rejected\":false",balance,equity,free,leverage,pct,m1lot,rawLot,NormVol(mn)));
     return NormVol(mn);
   }
   Emit("MARGIN_CALC",StringFormat(",\"balance\":%.2f,\"equity\":%.2f,\"freeMargin\":%.2f,\"leverage\":%.0f,\"configuredMarginPct\":%.2f,\"marginRequiredFor1Lot\":%.2f,\"rawCalculatedLot\":%.4f,\"normalizedLot\":0,\"rejected\":true,\"rejectReason\":\"BELOW_VOLUME_MIN\"",balance,equity,free,leverage,pct,m1lot,rawLot));
   return 0;
 }
 Emit("MARGIN_CALC",StringFormat(",\"balance\":%.2f,\"equity\":%.2f,\"freeMargin\":%.2f,\"leverage\":%.0f,\"configuredMarginPct\":%.2f,\"marginRequiredFor1Lot\":%.2f,\"rawCalculatedLot\":%.4f,\"normalizedLot\":%.4f,\"rejected\":false",balance,equity,free,leverage,pct,m1lot,rawLot,v));
 return v;
}
int CountPos(){int n=0;for(int i=PositionsTotal()-1;i>=0;i--){ulong t=PositionGetTicket(i);if(t&&PositionGetString(POSITION_SYMBOL)==_Symbol&&PositionGetInteger(POSITION_MAGIC)==InpMagic)n++;}return n;} double BasketProfit(){double p=0;for(int i=PositionsTotal()-1;i>=0;i--){ulong t=PositionGetTicket(i);if(t&&PositionGetString(POSITION_SYMBOL)==_Symbol&&PositionGetInteger(POSITION_MAGIC)==InpMagic)p+=PositionGetDouble(POSITION_PROFIT)+PositionGetDouble(POSITION_SWAP);}return p;}
bool NewestMagicPosition(int &dir,double &price,int &count){count=0;dir=0;price=0;datetime best=0;for(int i=PositionsTotal()-1;i>=0;i--){ulong t=PositionGetTicket(i);if(!t||PositionGetString(POSITION_SYMBOL)!=_Symbol||PositionGetInteger(POSITION_MAGIC)!=InpMagic)continue;count++;datetime ot=(datetime)PositionGetInteger(POSITION_TIME);if(ot>=best){best=ot;dir=PositionGetInteger(POSITION_TYPE)==POSITION_TYPE_BUY?1:-1;price=PositionGetDouble(POSITION_PRICE_OPEN);}}return count>0;}
string StateFile(){return StringFormat("ApexState_%I64d.json",InpMagic);}
void SaveState(){int h=FileOpen(StateFile(),FILE_WRITE|FILE_TXT|FILE_ANSI);if(h==INVALID_HANDLE)return;FileWriteString(h,StringFormat("{\"campId\":\"%s\",\"campSig\":\"%s\",\"campDir\":%d,\"layers\":%d,\"cycleStart\":%.2f,\"targetEq\":%.2f,\"campStart\":%I64d,\"lastAdd\":%.5f,\"mfe\":%.2f,\"mae\":%.2f,\"firstEntryPrice\":%.5f,\"firstSLPrice\":%.5f,\"firstInitialSLPrice\":%.5f,\"recoveryExitArmed\":%s,\"masterTicket\":%I64u,\"masterGuardStage\":%d}",campId,campSig,campDir,layers,cycleStart,targetEq,(long)campStart,lastAdd,mfe,mae,firstEntryPrice,firstSLPrice,firstInitialSLPrice,recoveryExitArmed?"true":"false",masterTicket,masterGuardStage));FileClose(h);}
void ClearState(){FileDelete(StateFile());}
bool LoadState(string &j){int h=FileOpen(StateFile(),FILE_READ|FILE_TXT|FILE_ANSI);if(h==INVALID_HANDLE)return false;j="";while(!FileIsEnding(h))j+=FileReadString(h);FileClose(h);return StringLen(j)>0;}

ulong FindOldestApexPosition(){
 ulong bestTicket=0;datetime bestTime=0;
 for(int i=PositionsTotal()-1;i>=0;i--){
   ulong t=PositionGetTicket(i);
   if(!t||PositionGetString(POSITION_SYMBOL)!=_Symbol||PositionGetInteger(POSITION_MAGIC)!=InpMagic)continue;
   datetime ot=(datetime)PositionGetInteger(POSITION_TIME);
   if(bestTicket==0||ot<bestTime){bestTicket=t;bestTime=ot;}
 }
 return bestTicket;
}
bool MasterPositionExists(){
 if(masterTicket==0)return false;
 for(int i=PositionsTotal()-1;i>=0;i--){
   ulong t=PositionGetTicket(i);
   if(t==masterTicket&&PositionGetString(POSITION_SYMBOL)==_Symbol&&PositionGetInteger(POSITION_MAGIC)==InpMagic)return true;
 }
 return false;
}
bool SetMasterSL(double newSL,string reason){
 if(masterTicket==0||!MasterPositionExists())return false;
 int digits=(int)SymbolInfoInteger(_Symbol,SYMBOL_DIGITS);
 newSL=NormalizeDouble(newSL,digits);
 trade.SetExpertMagicNumber(InpMagic);
 ResetLastError();
 bool ok=trade.PositionModify(masterTicket,newSL,0);
 if(ok){
   firstSLPrice=newSL;
   SaveState();
   Emit("MASTER_SL_MOVED",StringFormat(",\"stage\":%d,\"slPrice\":%.5f,\"reason\":\"%s\"",masterGuardStage,newSL,reason));
   return true;
 }
 Emit("MASTER_SL_MOVE_FAIL",StringFormat(",\"stage\":%d,\"requestedSL\":%.5f,\"retcode\":%d,\"error\":%d,\"reason\":\"%s\"",masterGuardStage,newSL,trade.ResultRetcode(),GetLastError(),reason));
 return false;
}
bool OpenLayer(int dir,double score,string why){
 double pct=0.0;
 if(C.accountProfile=="NORMAL"){
   // v3.4 confirmation-first exposure ladder:
   // L1 = probe margin %, L2 = confirmed-add margin %, L3+ = up to configured % of available margin.
   if(layers<=0)pct=clamp(C.normalL1MarginPct,0.1,100.0);
   else if(layers==1)pct=clamp(C.normalL2MarginPct,0.1,100.0);
   else pct=clamp(C.normalL3PlusMarginPct,0.1,100.0);
 }else{
   double basePct=C.baseMarginPct;
   pct=MathMin(100.0,basePct*MathPow(C.layerMultiplier,layers));
 }
 double vol=VolumeForMargin(dir,pct);
 if(vol<=0){Emit("ADD_BLOCKED",",\"reason\":\"NO_MARGIN_CAPACITY\"");return false;}
 trade.SetExpertMagicNumber(InpMagic);trade.SetDeviationInPoints(80);
 string com=StringFormat("APEX L%d %.0f",layers+1,score);
 bool firstNormal=(C.accountProfile=="NORMAL"&&layers==0);
 double reqPrice=dir>0?SymbolInfoDouble(_Symbol,SYMBOL_ASK):SymbolInfoDouble(_Symbol,SYMBOL_BID);
 int digits=(int)SymbolInfoInteger(_Symbol,SYMBOL_DIGITS);
 double sl=0;
 if(firstNormal&&C.normalFixedSLGoldMove>0)sl=NormalizeDouble(dir>0?reqPrice-C.normalFixedSLGoldMove:reqPrice+C.normalFixedSLGoldMove,digits);
 bool ok=dir>0?trade.Buy(vol,_Symbol,0,sl,0,com):trade.Sell(vol,_Symbol,0,sl,0,com);
 if(!ok){
   Print("APEX_ORDER_REJECTED retcode=",trade.ResultRetcode()," layer=",layers+1," volume=",DoubleToString(vol,4));
   Emit("ORDER_FAIL",StringFormat(",\"retcode\":%d",trade.ResultRetcode()));
   return false;
 }
 Print("APEX_ORDER_SENT layer=",layers+1," volume=",DoubleToString(trade.ResultVolume(),4)," price=",DoubleToString(trade.ResultPrice(),5));
 layers++;
 lastAdd=dir>0?SymbolInfoDouble(_Symbol,SYMBOL_ASK):SymbolInfoDouble(_Symbol,SYMBOL_BID);
 if(firstNormal){
   firstEntryPrice=trade.ResultPrice()>0?trade.ResultPrice():reqPrice;
   firstSLPrice=sl;
   firstInitialSLPrice=sl;
   recoveryExitArmed=false;
   masterTicket=FindOldestApexPosition();
   masterGuardStage=0;
   Emit("FIRST_ENTRY_GUARD",StringFormat(",\"entryPrice\":%.5f,\"slPrice\":%.5f,\"goldMove\":%.2f,\"masterTicket\":%I64u",firstEntryPrice,firstSLPrice,C.normalFixedSLGoldMove,masterTicket));
 }
 SaveState();
 Emit("LAYER_OPEN",StringFormat(",\"layer\":%d,\"volume\":%.4f,\"actualFilledLot\":%.4f,\"marginPct\":%.2f,\"score\":%.2f,\"reason\":\"%s\",\"price\":%.5f,\"sl\":%.5f",layers,vol,trade.ResultVolume(),pct,score,why,lastAdd,sl));
 return true;
}
bool CloseAll(){trade.SetExpertMagicNumber(InpMagic);for(int pass=0;pass<6;pass++){bool any=false;for(int i=PositionsTotal()-1;i>=0;i--){ulong t=PositionGetTicket(i);if(t&&PositionGetString(POSITION_SYMBOL)==_Symbol&&PositionGetInteger(POSITION_MAGIC)==InpMagic){any=true;trade.PositionClose(t);}}if(!any)break;Sleep(100);}return CountPos()==0;}
void Start(Snap &s){
 camp=true;campDir=s.dir;layers=0;cycleStart=AccountInfoDouble(ACCOUNT_BALANCE);
 targetEq=C.targetMode=="EQUITY"?C.targetEquity:(C.accountProfile=="NORMAL"?(C.normalTargetProfitPct>0?cycleStart*(1.0+C.normalTargetProfitPct/100.0):0.0):cycleStart*C.targetMultiplier);
 firstEntryPrice=0;firstSLPrice=0;firstInitialSLPrice=0;recoveryExitArmed=false;masterTicket=0;masterGuardStage=0;campStart=TimeCurrent();campId=StringFormat("%I64d-%I64d",AccountInfoInteger(ACCOUNT_LOGIN),(long)campStart);campSig=s.sig;mfe=0;mae=0;
 Emit("CAMPAIGN_START",StringFormat(",\"score\":%.2f,\"targetEquity\":%.2f,\"entryPrice\":%.5f,\"impulseMult\":%.3f,\"wickRatio\":%.3f,\"m3\":%s,\"m5\":%s,\"atr\":%.5f",s.score,targetEq,s.price,s.impulseMult,s.wickRatio,s.m3?"true":"false",s.m5?"true":"false",s.atr));
 if(!OpenLayer(campDir,s.score,"PROBE_CONFIRMED")){camp=false;campId="";ClearState();}
 watch=false;
}
void Finish(string outcome,string why){Emit("CAMPAIGN_END",StringFormat(",\"outcome\":\"%s\",\"reason\":\"%s\",\"mfe\":%.2f,\"mae\":%.2f,\"durationSec\":%d",outcome,why,mfe,mae,(int)(TimeCurrent()-campStart)));camp=false;campDir=0;layers=0;lastAdd=0;firstEntryPrice=0;firstSLPrice=0;firstInitialSLPrice=0;recoveryExitArmed=false;masterTicket=0;masterGuardStage=0;lastEnd=TimeCurrent();campId="";campSig="";watch=false;ClearState();}
Snap AddSignal(){Snap s=Observe();if(s.dir!=campDir){s.valid=false;MqlRates m1[];if(!Rates(PERIOD_M1,30,m1))return s;s.atr=ATR();s.dir=campDir;s.price=campDir>0?SymbolInfoDouble(_Symbol,SYMBOL_BID):SymbolInfoDouble(_Symbol,SYMBOL_ASK);bool cont=campDir<0?(m1[1].close<m1[2].low&&m1[2].close<m1[3].low):(m1[1].close>m1[2].high&&m1[2].close>m1[3].high);bool pf=campDir<0?(m1[2].close>m1[2].open&&m1[1].close<m1[2].low):(m1[2].close<m1[2].open&&m1[1].close>m1[2].high);s.continuation=cont;s.pullbackFail=pf;s.score=60+(cont?20:0)+(pf?15:0);s.sig=campSig;s.reason=cont?"CONTINUATION_BREAK":pf?"FAILED_PULLBACK":"NO_NEW_CONFIRMATION";}return s;}
void Manage(){
 int n=CountPos();

 // No-orphan guard: if the L1/master leg is gone for any reason (broker SL fill, manual close,
 // margin stop-out), immediately close whatever else remains so no orphan Apex positions survive.
 if(C.accountProfile=="NORMAL"&&camp&&masterTicket>0&&!MasterPositionExists()){
   if(n>0)CloseAll();
   Finish("MASTER_LEG_CLOSED","MASTER_FIRST_TRADE_GONE_CLOSE_WHOLE_BASKET");
   return;
 }

 if(n==0){
   if(camp)Finish("POSITIONS_GONE","BROKER_CLOSE_OR_MARGIN_STOP_OUT");
   return;
 }

 double p=BasketProfit(),campEq=cycleStart+p;
 mfe=MathMax(mfe,p);mae=MathMin(mae,p);

 // Recovery-To-Entry Exit: if the master/L1 leg suffers an adverse move of at least the
 // configured % of its ORIGINAL fixed SL distance (captured at campaign start, before any
 // later break-even SL move), the setup is marked damaged. If price later recovers to the
 // original L1 entry price, close the WHOLE basket rather than keep trusting a setup that
 // already went deeply wrong — do not wait for profit. Once armed, this never disarms on
 // its own; only a fresh campaign (Start()) resets it. Runs before break-even/fixed-SL/ratchet
 // so a damaged-then-recovered setup is never misread as a normal profitable exit.
 if(C.accountProfile=="NORMAL"&&C.recoveryExitEnabled&&masterTicket>0&&
    firstEntryPrice>0&&firstInitialSLPrice>0){
   double originalSLDist=MathAbs(firstEntryPrice-firstInitialSLPrice);
   if(originalSLDist>0){
     double masterPx=campDir>0?SymbolInfoDouble(_Symbol,SYMBOL_BID):SymbolInfoDouble(_Symbol,SYMBOL_ASK);
     double adverseDist=campDir>0?MathMax(0.0,firstEntryPrice-masterPx):MathMax(0.0,masterPx-firstEntryPrice);
     double adversePctOfSL=(adverseDist/originalSLDist)*100.0;
     if(!recoveryExitArmed&&adversePctOfSL>=MathMax(0.0,C.recoveryExitArmPctOfSL)){
       recoveryExitArmed=true;
       SaveState();
       Emit("RECOVERY_EXIT_ARMED",StringFormat(",\"entryPrice\":%.5f,\"originalSLPrice\":%.5f,\"currentPrice\":%.5f,\"adverseDist\":%.5f,\"adversePctOfSL\":%.2f,\"armThresholdPct\":%.2f",firstEntryPrice,firstInitialSLPrice,masterPx,adverseDist,adversePctOfSL,C.recoveryExitArmPctOfSL));
     }
     if(recoveryExitArmed){
       bool recoveredToEntry=(campDir>0?masterPx>=firstEntryPrice:masterPx<=firstEntryPrice);
       if(recoveredToEntry){
         if(n>0)CloseAll();
         Emit("RECOVERY_TO_ENTRY_EXIT",StringFormat(",\"entryPrice\":%.5f,\"originalSLPrice\":%.5f,\"currentPrice\":%.5f,\"armThresholdPct\":%.2f",firstEntryPrice,firstInitialSLPrice,masterPx,C.recoveryExitArmPctOfSL));
         Finish("RECOVERY_TO_ENTRY_EXIT","DEEP_ADVERSE_MOVE_RECOVERED_TO_MASTER_ENTRY");
         return;
       }
     }
   }
 }

 // Master break-even: once the WHOLE Apex basket reaches the configured campaign-profit
 // threshold, tighten ONLY the master/L1 broker SL to its own entry price. One-way — once
 // armed (firstSLPrice at-or-past entry), this never fires again for the same campaign, so
 // the SL can never be widened back out.
 if(C.accountProfile=="NORMAL"&&C.masterBreakEvenEnabled&&masterTicket>0&&
    firstEntryPrice>0&&cycleStart>0){
   double campaignProfitPct=(p/cycleStart)*100.0;
   bool beAlreadyActive=(campDir>0?firstSLPrice>=firstEntryPrice:firstSLPrice<=firstEntryPrice)&&firstSLPrice>0;
   if(campaignProfitPct>=C.masterBreakEvenTriggerPct&&!beAlreadyActive){
     double beSL=firstEntryPrice;
     if(SetMasterSL(beSL,"CAMPAIGN_PROFIT_REACHED_BE_TRIGGER")){
       Emit("MASTER_BE_ARMED",StringFormat(",\"campaignProfitPct\":%.2f,\"triggerPct\":%.2f,\"entryPrice\":%.5f,\"masterTicket\":%I64u",campaignProfitPct,C.masterBreakEvenTriggerPct,firstEntryPrice,masterTicket));
     }
   }
 }

 // Synthetic master/L1 fixed SL guard: closes the WHOLE basket the instant live price crosses
 // the current SL level (fixed distance, or the break-even price once armed), reinforcing the
 // broker's own native SL order on the master position.
 if(C.accountProfile=="NORMAL"&&masterTicket>0&&firstEntryPrice>0&&firstSLPrice>0){
   double guardPx=campDir>0?SymbolInfoDouble(_Symbol,SYMBOL_BID):SymbolInfoDouble(_Symbol,SYMBOL_ASK);
   bool masterGuardHit=(campDir>0?guardPx<=firstSLPrice:guardPx>=firstSLPrice);
   if(masterGuardHit){
     if(n>0)CloseAll();
     Finish("MASTER_SL_BASKET_EXIT","MASTER_INPUT_FIXED_SL_HIT");
     return;
   }
 }

 // Percentage profit ratchet, based on campaign-start balance (NOT a hard TP):
 // +180% peak => protect +100%, +280% peak => protect +200%, +380% peak => protect +300%, etc.
 // The floor only ever ratchets forward (driven by mfe, the historical peak, which never decreases).
 if(C.accountProfile=="NORMAL"&&C.profitRatchetEnabled&&cycleStart>0&&
    C.ratchetTriggerPct>0&&C.ratchetLockPct>=0&&
    C.ratchetStepPct>0&&C.ratchetLockStepPct>=0){
   double peakPct=(mfe/cycleStart)*100.0;
   if(peakPct>=C.ratchetTriggerPct){
     int ratchetSteps=(int)MathFloor((peakPct-C.ratchetTriggerPct)/C.ratchetStepPct);
     double protectedPct=C.ratchetLockPct+(double)ratchetSteps*C.ratchetLockStepPct;
     protectedPct=MathMax(0.0,protectedPct);
     double protectedProfit=cycleStart*(protectedPct/100.0);
     if(p<=protectedProfit){
       if(CloseAll()){
         Emit("PROFIT_RATCHET_EXIT",StringFormat(",\"peakProfit\":%.2f,\"peakPct\":%.2f,\"protectedProfit\":%.2f,\"protectedPct\":%.2f,\"currentProfit\":%.2f,\"steps\":%d",mfe,peakPct,protectedProfit,protectedPct,p,ratchetSteps));
         Finish("PROFIT_FLOOR_HIT","PERCENT_PROFIT_RATCHET");
       }
       return;
     }
   }
 }

 // Optional hard basket TP (0 = disabled by default; the ratchet is the intended default exit).
 if(targetEq>0&&campEq>=targetEq){
   if(CloseAll())Finish("TARGET_HIT","NORMAL_INPUT_BASKET_TARGET");
   return;
 }

 SaveState();
 if(!C.armed)return;
 if(C.maxLayers>0&&layers>=C.maxLayers)return;
 if(p<=0)return;

 Snap s=AddSignal();
 double threshold=C.addScore+(C.learningEnabled?C.learnAddAdj:0);
 double cur=campDir>0?SymbolInfoDouble(_Symbol,SYMBOL_BID):SymbolInfoDouble(_Symbol,SYMBOL_ASK);
 bool spaced=lastAdd>0&&(campDir>0?cur>=lastAdd+s.atr*C.addSpacingAtr:cur<=lastAdd-s.atr*C.addSpacingAtr);
 bool earned=(s.continuation||s.pullbackFail||s.microBreak)&&s.score>=threshold;
 if(spaced&&earned)OpenLayer(campDir,s.score,s.reason);
}
int OnInit(){
 // Defaults() already sets C.armed correctly for both Tester (always true) and live (per
 // InpRequireRemoteArm) via IsTester() — no post-hoc override needed here. The OnTimer() license
 // scan-gate is itself IsTester()-guarded, so lastLicenseStatus is never consulted in Tester and
 // needs no override either; it stays at its real default ("UNKNOWN") until a live ConfigPoll().
 Defaults();
 if(StringFind(_Symbol,"XAU")<0)return INIT_FAILED;
 hAtr=iATR(_Symbol,PERIOD_M1,14);
 if(hAtr==INVALID_HANDLE)return INIT_FAILED;
 EventSetMillisecondTimer(MathMax(100,InpScanMilliseconds));
 ConfigPoll();
 lastConfigSig=ConfigSignature();
 PrintEffectiveConfig();
 Print("APEX_READY ",APEX_VERSION," tester=",(IsTester()?"true":"false"));
 return INIT_SUCCEEDED;
}
void OnDeinit(const int r){EventKillTimer();if(hAtr!=INVALID_HANDLE)IndicatorRelease(hAtr);}
void OnTick(){}
void OnTimer(){
 datetime now=TimeCurrent();
 DupInstanceCheck();
 if(now-lastCfg>=InpConfigPollSeconds){ConfigPoll();lastCfg=now;}
 if(camp||CountPos()>0){
   if(!camp&&CountPos()>0){
     int nDir,nCount;double nPrice;NewestMagicPosition(nDir,nPrice,nCount);
     string j;
     if(nCount>0&&LoadState(j)&&ji(j,"campDir",0)==nDir&&StringLen(js(j,"campId",""))>0){
       camp=true;campId=js(j,"campId","");campSig=js(j,"campSig","RECOVERED");campDir=nDir;layers=(int)MathMax(nCount,ji(j,"layers",nCount));
       cycleStart=jd(j,"cycleStart",AccountInfoDouble(ACCOUNT_BALANCE));
       targetEq=jd(j,"targetEq",C.targetMode=="EQUITY"?C.targetEquity:(C.accountProfile=="NORMAL"?(C.normalTargetProfitPct>0?cycleStart*(1.0+C.normalTargetProfitPct/100.0):0.0):cycleStart*C.targetMultiplier));
       firstEntryPrice=jd(j,"firstEntryPrice",0);firstSLPrice=jd(j,"firstSLPrice",0);firstInitialSLPrice=jd(j,"firstInitialSLPrice",0);recoveryExitArmed=jb(j,"recoveryExitArmed",false);masterTicket=ju(j,"masterTicket",0);masterGuardStage=ji(j,"masterGuardStage",0);
       campStart=(datetime)ji(j,"campStart",(int)now);lastAdd=nPrice;mfe=jd(j,"mfe",0);mae=jd(j,"mae",0);
       Emit("CAMPAIGN_RECOVERED",StringFormat(",\"source\":\"STATE_FILE\",\"layers\":%d",layers));
     }else if(nCount>0){
       camp=true;campDir=nDir;layers=nCount;cycleStart=AccountInfoDouble(ACCOUNT_BALANCE);
       targetEq=C.targetMode=="EQUITY"?C.targetEquity:(C.accountProfile=="NORMAL"?(C.normalTargetProfitPct>0?cycleStart*(1.0+C.normalTargetProfitPct/100.0):0.0):cycleStart*C.targetMultiplier);
       masterTicket=FindOldestApexPosition();masterGuardStage=0;firstEntryPrice=0;firstSLPrice=0;firstInitialSLPrice=0;recoveryExitArmed=false;
       campStart=now;campId=StringFormat("RECOVER-%I64d",(long)now);campSig="RECOVERED_NO_STATE";lastAdd=nPrice;mfe=0;mae=0;
       Emit("CAMPAIGN_RECOVERED",",\"source\":\"POSITION_SCAN_ONLY\",\"warning\":\"CYCLE_START_EQUITY_AND_RATCHET_PEAK_ESTIMATED_FROM_RESTART_BALANCE_STATE_FILE_MISSING\"");
     }
     SaveState();
   }
   Manage();
   return;
 }
 if(StringFind(_Symbol,C.symbolContains)<0){ScanLog("WAIT","SYMBOL_MISMATCH");return;}
 if(!IsTester()&&lastLicenseStatus!="ACTIVE"){ScanLog("WAIT","LICENSE_NOT_ACTIVE");return;}
 if(!C.armed){ScanLog("WAIT","ACCOUNT_NOT_ARMED");return;}
 if(lastEnd>0&&now-lastEnd<C.cooldownMinutes*60){ScanLog("WAIT","COOLDOWN_ACTIVE");return;}
 bool wasWatching=watch;
 MqlTick tick;
 bool haveTick=SymbolInfoTick(_Symbol,tick);
 Snap s=Observe();
 if(s.valid){
   ScanLog("ENTRY_READY","");
   Start(s);
 }else if(!haveTick){
   ScanLog("WAIT","NO_TICKS");
 }else if(watch){
   double threshold=C.entryScore+(C.learningEnabled?C.learnEntryAdj:0);
   string reason="WATCHING_FOR_REJECTION";
   if(s.rejected&&!s.microBreak)reason="WAITING_FOR_MICRO_BOS";
   else if(s.rejected&&s.microBreak&&C.requireM3Confirm&&!s.m3)reason="WAIT_M3_CONFIRMATION";
   else if(s.rejected&&s.microBreak&&s.score<threshold)reason="ENTRY_SCORE_TOO_LOW";
   ScanLog("WATCH",reason);
 }else if(wasWatching&&!watch){
   ScanLog("SCAN","WATCH_EXPIRED");
 }else{
   ScanLog("SCAN","WAIT_NO_STRONG_IMPULSE_OR_LIQUIDITY_SWEEP");
 }
}
