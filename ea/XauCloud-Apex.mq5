#property copyright "XauCloud Apex"
#property version   "3.700"
#property strict
#property description "ApexStack: XAUUSD exhaustion/reversal campaign with aggressive profit-side pyramiding"
#include <Trade/Trade.mqh>
CTrade trade;
#define APEX_VERSION "XauCloud-Apex_v3.7.0-CommandCenterLink"
#define APEX_MAGIC 8620260903
input string InpCloudURL="https://apex.xaucloud.io"; // same-origin site/API, like XauCloud Command Center
input string InpApexLicense="";                        // ONLY credential customer enters
input int InpConfigPollSeconds=8;                      // remote command/config sync
input int InpCloudTimeoutMs=5000;
input bool InpCloudDiagnostics=true;
input int InpScanMilliseconds=250;
input bool InpRequireRemoteArm=true;
input long InpMagic=APEX_MAGIC;
input double InpNormalMarginPct=15.0;         // NORMAL L1 confirmation/probe margin %
input double InpNormalL2MarginPct=50.0;       // NORMAL L2 confirmed-add margin %
input double InpNormalL3PlusMarginPct=100.0;  // NORMAL L3+ use up to this % of available margin
input double InpNormalTakeProfitPct=0.0;      // NORMAL hard basket TP %; 0 = disabled
input double InpNormalFixedSLGoldMove=30.0;       // L1 fixed XAU price SL distance; 0 = no broker SL
input bool   InpProfitRatchetEnabled=true;        // Protect basket profit after it reaches trigger
input double InpRatchetTriggerPct=180.0;          // First trigger: +200% campaign profit
input double InpRatchetLockPct=100.0;             // At +200%, protect +100%
input double InpRatchetStepPct=100.0;             // Every additional +100% peak...
input double InpRatchetLockStepPct=100.0;
input bool   InpMasterBreakEvenEnabled=true;    // Move L1/master SL to entry after campaign reaches trigger
input double InpMasterBreakEvenTriggerPct=50.0; // Default: +50% basket profit => master SL to entry         // ...raise protected floor another +100%
input bool   InpRecoveryExitEnabled=true;       // Deep adverse move then recovery to entry => exit basket
input double InpRecoveryExitArmPctOfSL=40.0;    // Arm after L1 reaches this % of ORIGINAL SL distance
struct Config{bool armed;string account;string symbolContains;string targetMode,accountProfile;double targetEquity,targetMultiplier,normalTargetProfitPct,baseMarginPct,layerMultiplier;int maxLayers;double entryScore,addScore,impulseAtr,sweepAtr,addSpacingAtr,rejectionZoneAtr;int rejectionBars,watchExpiryMinutes,cooldownMinutes;bool requireM3Confirm,requireM5Context,learningEnabled,normalProfitFloorEnabled;double learnEntryAdj,learnAddAdj;};
struct Snap{bool valid;int dir;double score,atr,price,extreme,impulseMult,sweepMult,wickRatio;bool swept,rejected,microBreak,m3,m5,continuation,pullbackFail;string sig,reason;};
Config C;int hAtr=INVALID_HANDLE;datetime lastCfg=0,lastEnd=0;bool camp=false;int campDir=0,layers=0;double cycleStart=0,targetEq=0,lastAdd=0,mfe=0,mae=0,peakProfitPct=0,floorProfitPct=0,firstEntryPrice=0,firstSLPrice=0,firstInitialSLPrice=0;bool recoveryExitArmed=false;ulong masterTicket=0;int masterGuardStage=0;datetime campStart=0;string campId="",campSig="";
bool watch=false;int watchDir=0;datetime watchStart=0,watchSweepBarTime=0;double watchExtreme=0,watchPrior=0,watchAtr=0;string watchSig="";
// === v3.7 Command Center style connectivity ===
// The cloud is license/monitor/control only. Trading logic remains local.
// A transport failure NEVER resets an already validated cached configuration.
bool g_cloudEverValidated=false;
bool g_cloudUsingCache=false;
bool g_cloudExplicitDenied=false;
int  g_cloudConsecutiveFails=0;
long g_cloudLastCommandRevision=0;
datetime g_cloudLastOk=0;
string g_cloudLastStatus="NEVER_CONNECTED";

bool IsTester(){return (bool)MQLInfoInteger(MQL_TESTER);}

uint LicenseHash(){
   uint h=2166136261;
   for(int i=0;i<StringLen(InpApexLicense);i++){h^=(uint)StringGetCharacter(InpApexLicense,i);h*=16777619;}
   return h;
}
string CacheKey(string suffix){
   return StringFormat("APX37_%I64d_%u_%s",AccountInfoInteger(ACCOUNT_LOGIN),LicenseHash(),suffix);
}
void CacheSet(string k,double v){GlobalVariableSet(CacheKey(k),v);}
bool CacheGet(string k,double &v){string n=CacheKey(k);if(!GlobalVariableCheck(n))return false;v=GlobalVariableGet(n);return true;}

void SaveCloudCache(){
   CacheSet("VALID",1); CacheSet("ARM",C.armed?1:0);
   CacheSet("TGT",C.targetEquity); CacheSet("MULT",C.targetMultiplier);
   CacheSet("TP",C.normalTargetProfitPct); CacheSet("BASE",C.baseMarginPct);
   CacheSet("LM",C.layerMultiplier); CacheSet("MAXL",C.maxLayers);
   CacheSet("ES",C.entryScore); CacheSet("AS",C.addScore);
   CacheSet("IMP",C.impulseAtr); CacheSet("SWP",C.sweepAtr);
   CacheSet("RB",C.rejectionBars); CacheSet("WE",C.watchExpiryMinutes);
   CacheSet("SP",C.addSpacingAtr); CacheSet("RZ",C.rejectionZoneAtr);
   CacheSet("CD",C.cooldownMinutes); CacheSet("M3",C.requireM3Confirm?1:0);
   CacheSet("M5",C.requireM5Context?1:0); CacheSet("LE",C.learningEnabled?1:0);
   CacheSet("LEA",C.learnEntryAdj); CacheSet("LAA",C.learnAddAdj);
   CacheSet("REV",(double)g_cloudLastCommandRevision);
}
bool LoadCloudCache(){
   double v=0;if(!CacheGet("VALID",v)||v<0.5)return false;
   if(CacheGet("ARM",v))C.armed=v>0.5;
   if(CacheGet("TGT",v))C.targetEquity=v;
   if(CacheGet("MULT",v))C.targetMultiplier=v;
   if(CacheGet("TP",v))C.normalTargetProfitPct=v;
   if(CacheGet("BASE",v))C.baseMarginPct=v;
   if(CacheGet("LM",v))C.layerMultiplier=v;
   if(CacheGet("MAXL",v))C.maxLayers=(int)v;
   if(CacheGet("ES",v))C.entryScore=v;
   if(CacheGet("AS",v))C.addScore=v;
   if(CacheGet("IMP",v))C.impulseAtr=v;
   if(CacheGet("SWP",v))C.sweepAtr=v;
   if(CacheGet("RB",v))C.rejectionBars=(int)v;
   if(CacheGet("WE",v))C.watchExpiryMinutes=(int)v;
   if(CacheGet("SP",v))C.addSpacingAtr=v;
   if(CacheGet("RZ",v))C.rejectionZoneAtr=v;
   if(CacheGet("CD",v))C.cooldownMinutes=(int)v;
   if(CacheGet("M3",v))C.requireM3Confirm=v>0.5;
   if(CacheGet("M5",v))C.requireM5Context=v>0.5;
   if(CacheGet("LE",v))C.learningEnabled=v>0.5;
   if(CacheGet("LEA",v))C.learnEntryAdj=v;
   if(CacheGet("LAA",v))C.learnAddAdj=v;
   if(CacheGet("REV",v))g_cloudLastCommandRevision=(long)v;
   g_cloudUsingCache=true;
   g_cloudLastStatus="CACHED_LAST_KNOWN_GOOD";
   Print("APEX CLOUD CACHE RESTORED | armed=",C.armed?"true":"false"," | trading remains local");
   return true;
}

string trim(string s){StringTrimLeft(s);StringTrimRight(s);return s;} string raw(string j,string k){string n="\""+k+"\":";int p=StringFind(j,n);if(p<0)return"";p+=StringLen(n);while(p<StringLen(j)&&StringGetCharacter(j,p)==' ')p++;ushort c=StringGetCharacter(j,p);if(c=='\"'){int e=p+1;while(e<StringLen(j)&&StringGetCharacter(j,e)!='\"')e++;return StringSubstr(j,p+1,e-p-1);}int e=p;while(e<StringLen(j)){ushort x=StringGetCharacter(j,e);if(x==','||x=='}'||x==']')break;e++;}return trim(StringSubstr(j,p,e-p));}
double jd(string j,string k,double d){string v=raw(j,k);return v==""?d:StringToDouble(v);} int ji(string j,string k,int d){string v=raw(j,k);return v==""?d:(int)StringToInteger(v);} bool jb(string j,string k,bool d){string v=raw(j,k);if(v=="true")return true;if(v=="false")return false;return d;} string js(string j,string k,string d){string v=raw(j,k);return v==""?d:v;} ulong ju(string j,string k,ulong d){string v=raw(j,k);return v==""?d:(ulong)StringToInteger(v);}

bool Http(string method,string ep,string body,string &resp,int &httpCode,int &mt5Err){
   resp="";httpCode=0;mt5Err=0;
   if(IsTester())return false;
   char d[],r[];string rh;
   // Match XauCloud Command Center: ordinary JSON request, no fragile custom auth header.
   // License travels in the JSON body / legacy query only.
   string hdr="Content-Type: application/json\r\nAccept: application/json\r\n";
   StringToCharArray(body,d,0,StringLen(body),CP_UTF8);
   ResetLastError();
   httpCode=WebRequest(method,InpCloudURL+ep,hdr,InpCloudTimeoutMs,d,r,rh);
   mt5Err=GetLastError();
   if(httpCode>=0)resp=CharArrayToString(r,0,-1,CP_UTF8);
   return httpCode>=200&&httpCode<300;
}
void CloudFailure(string label,int code,int err,string response){
   g_cloudConsecutiveFails++;
   if(InpCloudDiagnostics)
      Print("APEX CLOUD ",label," FAILED | url=",InpCloudURL,
            " | http=",code," mt5err=",err,
            " | consecutiveFails=",g_cloudConsecutiveFails,
            " | response=",StringSubstr(response,0,300),
            " | MONITOR/CONTROL ONLY; trading uses last validated local config");
}
void CloudSuccess(){
   g_cloudConsecutiveFails=0;g_cloudLastOk=TimeCurrent();
   g_cloudLastStatus="CONNECTED";
}
string BoolJson(bool v){return v?"true":"false";}

void AckCommand(long revision,string status){
   if(IsTester()||revision<=0)return;
   string b=StringFormat("{\"license\":\"%s\",\"account\":\"%I64d\",\"revision\":%I64d,\"status\":\"%s\",\"eaVersion\":\"%s\"}",
      InpApexLicense,AccountInfoInteger(ACCOUNT_LOGIN),revision,status,APEX_VERSION);
   string r;int code=0,err=0;
   if(!Http("POST","/api/apex/command/ack",b,r,code,err))CloudFailure("COMMAND_ACK",code,err,r);
}

void ApplyRemoteConfig(string r){
   C.armed=jb(r,"armed",C.armed);
   C.account=js(r,"account",C.account);
   C.symbolContains=js(r,"symbolContains",C.symbolContains);
   C.targetMode=js(r,"targetMode",C.targetMode);
   C.accountProfile=js(r,"accountProfile",C.accountProfile);
   C.targetEquity=jd(r,"targetEquity",C.targetEquity);
   C.targetMultiplier=jd(r,"targetMultiplier",C.targetMultiplier);
   C.normalTargetProfitPct=jd(r,"normalTargetProfitPct",C.normalTargetProfitPct);
   C.baseMarginPct=jd(r,"baseMarginPct",C.baseMarginPct);
   C.layerMultiplier=jd(r,"layerMultiplier",C.layerMultiplier);
   C.maxLayers=ji(r,"maxLayers",C.maxLayers);
   C.entryScore=jd(r,"entryScore",C.entryScore);
   C.addScore=jd(r,"addScore",C.addScore);
   C.impulseAtr=jd(r,"impulseAtr",C.impulseAtr);
   C.sweepAtr=jd(r,"sweepAtr",C.sweepAtr);
   C.rejectionBars=ji(r,"rejectionBars",C.rejectionBars);
   C.watchExpiryMinutes=ji(r,"watchExpiryMinutes",C.watchExpiryMinutes);
   C.addSpacingAtr=jd(r,"addSpacingAtr",C.addSpacingAtr);
   C.rejectionZoneAtr=jd(r,"rejectionZoneAtr",C.rejectionZoneAtr);
   C.cooldownMinutes=ji(r,"cooldownMinutes",C.cooldownMinutes);
   C.requireM3Confirm=jb(r,"requireM3Confirm",C.requireM3Confirm);
   C.requireM5Context=jb(r,"requireM5Context",C.requireM5Context);
   C.learningEnabled=jb(r,"learningEnabled",C.learningEnabled);
   C.learnEntryAdj=jd(r,"entryScoreAdjustment",C.learnEntryAdj);
   C.learnAddAdj=jd(r,"addScoreAdjustment",C.learnAddAdj);
}

bool CloudSync(){
   if(IsTester()){C.armed=true;return true;}
   if(StringLen(InpApexLicense)<8){
      g_cloudLastStatus="LICENSE_MISSING";
      if(!g_cloudEverValidated&&!g_cloudUsingCache)C.armed=false;
      if(InpCloudDiagnostics)Print("APEX LICENSE MISSING | enter Apex license in EA Inputs");
      return false;
   }
   long tradeMode=(long)AccountInfoInteger(ACCOUNT_TRADE_MODE);
   string b=StringFormat(
      "{\"license\":\"%s\",\"account\":\"%I64d\",\"broker\":\"%s\",\"server\":\"%s\",\"currency\":\"%s\","
      "\"symbol\":\"%s\",\"timeframe\":%d,\"eaVersion\":\"%s\",\"tradeMode\":%I64d,"
      "\"balance\":%.2f,\"equity\":%.2f,\"freeMargin\":%.2f,\"campaignActive\":%s,\"layers\":%d}",
      InpApexLicense,AccountInfoInteger(ACCOUNT_LOGIN),
      AccountInfoString(ACCOUNT_COMPANY),AccountInfoString(ACCOUNT_SERVER),AccountInfoString(ACCOUNT_CURRENCY),
      _Symbol,(int)_Period,APEX_VERSION,tradeMode,
      AccountInfoDouble(ACCOUNT_BALANCE),AccountInfoDouble(ACCOUNT_EQUITY),AccountInfoDouble(ACCOUNT_MARGIN_FREE),
      BoolJson(camp||CountPos()>0),layers);
   string r;int code=0,err=0;
   if(!Http("POST","/api/apex/heartbeat",b,r,code,err)){
      CloudFailure("HEARTBEAT",code,err,r);
      // Critical XauCloud behavior: communication failure does not alter C.armed or trading state.
      return false;
   }
   string ls=js(r,"licenseStatus","");
   if(ls!="ACTIVE"){
      g_cloudExplicitDenied=true;g_cloudLastStatus=ls==""?"LICENSE_DENIED":ls;
      C.armed=false; // only an explicit authenticated backend denial can disarm for license reasons
      Print("APEX LICENSE DENIED BY SERVER | status=",g_cloudLastStatus);
      return false;
   }
   g_cloudExplicitDenied=false;g_cloudEverValidated=true;g_cloudUsingCache=false;
   ApplyRemoteConfig(r);
   long revision=(long)jd(r,"commandRevision",(double)g_cloudLastCommandRevision);
   CloudSuccess();
   if(revision>g_cloudLastCommandRevision){
      g_cloudLastCommandRevision=revision;
      SaveCloudCache();
      AckCommand(revision,C.armed?"ARMED":"DISARMED");
   } else SaveCloudCache();
   return true;
}

void Emit(string type,string extra=""){
   if(IsTester())return;
   string b=StringFormat(
      "{\"license\":\"%s\",\"type\":\"%s\",\"account\":\"%I64d\",\"broker\":\"%s\",\"currency\":\"%s\","
      "\"symbol\":\"%s\",\"version\":\"%s\",\"campaignId\":\"%s\",\"signature\":\"%s\",\"direction\":%d,"
      "\"layers\":%d,\"balance\":%.2f,\"equity\":%.2f,\"freeMargin\":%.2f%s}",
      InpApexLicense,type,AccountInfoInteger(ACCOUNT_LOGIN),AccountInfoString(ACCOUNT_COMPANY),
      AccountInfoString(ACCOUNT_CURRENCY),_Symbol,APEX_VERSION,campId,campSig,campDir,layers,
      AccountInfoDouble(ACCOUNT_BALANCE),AccountInfoDouble(ACCOUNT_EQUITY),
      AccountInfoDouble(ACCOUNT_MARGIN_FREE),extra);
   string r;int code=0,err=0;
   if(!Http("POST","/api/apex/event",b,r,code,err))CloudFailure("EVENT",code,err,r);
   else CloudSuccess();
}
void Defaults(){
   C.armed=!InpRequireRemoteArm;C.account="0";C.symbolContains="XAUUSD";C.targetMode="MULTIPLIER";
   C.accountProfile="NORMAL";C.targetEquity=1000;C.targetMultiplier=100;C.normalTargetProfitPct=0;
   C.baseMarginPct=100;C.layerMultiplier=2;C.maxLayers=0;C.entryScore=76;C.addScore=70;
   C.impulseAtr=1.8;C.sweepAtr=.05;C.rejectionBars=5;C.watchExpiryMinutes=12;
   C.addSpacingAtr=.22;C.rejectionZoneAtr=.12;C.cooldownMinutes=0;C.requireM3Confirm=true;
   C.requireM5Context=false;C.learningEnabled=true;C.normalProfitFloorEnabled=true;C.learnEntryAdj=0;C.learnAddAdj=0;
}
bool ConfigPoll(){return CloudSync();}
double ATR(){double x[];ArraySetAsSeries(x,true);if(CopyBuffer(hAtr,0,0,2,x)<2)return 0;return x[1];} bool Rates(ENUM_TIMEFRAMES tf,int n,MqlRates &r[]){ArraySetAsSeries(r,true);return CopyRates(_Symbol,tf,0,n,r)>=n-2;} double clamp(double x,double a,double b){return MathMax(a,MathMin(b,x));}
Snap Observe(){Snap s;s.valid=false;s.dir=0;s.score=0;s.atr=ATR();s.price=0;s.extreme=0;s.impulseMult=0;s.sweepMult=0;s.wickRatio=0;s.swept=false;s.rejected=false;s.microBreak=false;s.m3=false;s.m5=false;s.continuation=false;s.pullbackFail=false;s.sig="NONE";s.reason="";if(s.atr<=0)return s;MqlRates m1[],m3[],m5[];if(!Rates(PERIOD_M1,90,m1)||!Rates(PERIOD_M3,24,m3)||!Rates(PERIOD_M5,18,m5))return s;
 double move=m1[1].close-m1[8].close;int imp=move>=0?1:-1;s.impulseMult=MathAbs(move)/s.atr;int directional=0;for(int i=1;i<=7;i++)if((imp>0&&m1[i].close>m1[i].open)||(imp<0&&m1[i].close<m1[i].open))directional++;
 double ph=-DBL_MAX,pl=DBL_MAX;for(int i=9;i<80;i++){ph=MathMax(ph,m1[i].high);pl=MathMin(pl,m1[i].low);} if(!watch&&s.impulseMult>=C.impulseAtr&&directional>=5){double ex=imp>0?m1[1].high:m1[1].low;bool swept=imp>0?ex>=ph+C.sweepAtr*s.atr:ex<=pl-C.sweepAtr*s.atr;if(swept){watch=true;watchDir=-imp;watchStart=TimeCurrent();watchSweepBarTime=m1[1].time;watchExtreme=ex;watchPrior=imp>0?ph:pl;watchAtr=s.atr;watchSig=watchDir<0?"SELL_UPSIDE_LIQUIDITY_EXHAUST":"BUY_DOWNSIDE_LIQUIDITY_EXHAUST";Emit("WATCH_ARMED",StringFormat(",\"watchDir\":%d,\"impulseAtr\":%.3f",watchDir,s.impulseMult));}}
 if(!watch)return s;if(TimeCurrent()-watchStart>C.watchExpiryMinutes*60){watch=false;return s;} s.dir=watchDir;s.sig=watchSig;s.extreme=watchExtreme;s.swept=true;s.impulseMult=MathAbs(m1[1].close-m1[8].close)/s.atr;s.price=s.dir>0?SymbolInfoDouble(_Symbol,SYMBOL_ASK):SymbolInfoDouble(_Symbol,SYMBOL_BID);
 int rb=MathMax(1,MathMin(C.rejectionBars,8));bool rej=false,bos=false;double bestW=0;for(int i=1;i<=rb;i++){if(m1[i].time<=watchSweepBarTime)continue;double body=MathMax(_Point,MathAbs(m1[i].close-m1[i].open));double up=m1[i].high-MathMax(m1[i].open,m1[i].close),lo=MathMin(m1[i].open,m1[i].close)-m1[i].low;if(s.dir<0){bestW=MathMax(bestW,up/body);if(m1[i].high>=watchExtreme-C.rejectionZoneAtr*s.atr&&m1[i].close<watchPrior)rej=true;}else{bestW=MathMax(bestW,lo/body);if(m1[i].low<=watchExtreme+C.rejectionZoneAtr*s.atr&&m1[i].close>watchPrior)rej=true;}}
 if(m1[1].time>watchSweepBarTime){if(s.dir<0)bos=(m1[1].close<m1[2].low)||(m1[1].low<m1[3].low&&m1[1].close<m1[2].open);else bos=(m1[1].close>m1[2].high)||(m1[1].high>m1[3].high&&m1[1].close>m1[2].open);}s.rejected=rej;s.microBreak=bos;s.wickRatio=bestW;s.m3=s.dir<0?(m3[1].close<m3[1].open&&m3[1].close<(m3[1].high+m3[1].low)/2):(m3[1].close>m3[1].open&&m3[1].close>(m3[1].high+m3[1].low)/2);s.m5=s.dir<0?m5[1].close<m5[1].open:m5[1].close>m5[1].open;
 double score=25+clamp(s.impulseMult/C.impulseAtr*15,0,18)+(s.rejected?24:0)+(s.microBreak?22:0)+(s.m3?8:0)+(s.m5?3:0)+clamp(bestW*2,0,5);s.score=clamp(score,0,100);double threshold=C.entryScore+(C.learningEnabled?C.learnEntryAdj:0);s.valid=s.rejected&&s.microBreak&&(!C.requireM3Confirm||s.m3)&&(!C.requireM5Context||s.m5)&&s.score>=threshold;s.reason=s.valid?"CONFIRMED_EXHAUSTION_REVERSAL":"WATCHING_FOR_REJECTION_AND_BOS";return s;}
int VolDigits(){double st=SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_STEP);return st>=1?0:st>=.1?1:st>=.01?2:3;} double NormVol(double v){double mn=SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_MIN),mx=SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_MAX),st=SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_STEP);if(st<=0)st=mn;v=MathFloor(v/st)*st;return NormalizeDouble(MathMax(mn,MathMin(mx,v)),VolDigits());}
double VolumeForMargin(int dir,double pct){double free=AccountInfoDouble(ACCOUNT_MARGIN_FREE),budget=free*clamp(pct,.1,100)/100.0,mx=SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_MAX),mn=SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_MIN),p=dir>0?SymbolInfoDouble(_Symbol,SYMBOL_ASK):SymbolInfoDouble(_Symbol,SYMBOL_BID),m=0;ENUM_ORDER_TYPE t=dir>0?ORDER_TYPE_BUY:ORDER_TYPE_SELL;if(free<=0)return 0;if(OrderCalcMargin(t,_Symbol,mx,p,m)&&m<=budget)return NormVol(mx);double lo=0,hi=mx;for(int i=0;i<36;i++){double mid=(lo+hi)/2;if(!OrderCalcMargin(t,_Symbol,mid,p,m)||m>budget)hi=mid;else lo=mid;}double v=NormVol(lo);if(v<mn){if(OrderCalcMargin(t,_Symbol,mn,p,m)&&m<=budget)return NormVol(mn);return 0;}return v;}
int CountPos(){int n=0;for(int i=PositionsTotal()-1;i>=0;i--){ulong t=PositionGetTicket(i);if(t&&PositionGetString(POSITION_SYMBOL)==_Symbol&&PositionGetInteger(POSITION_MAGIC)==InpMagic)n++;}return n;} double BasketProfit(){double p=0;for(int i=PositionsTotal()-1;i>=0;i--){ulong t=PositionGetTicket(i);if(t&&PositionGetString(POSITION_SYMBOL)==_Symbol&&PositionGetInteger(POSITION_MAGIC)==InpMagic)p+=PositionGetDouble(POSITION_PROFIT)+PositionGetDouble(POSITION_SWAP);}return p;}
bool NewestMagicPosition(int &dir,double &price,int &count){count=0;dir=0;price=0;datetime best=0;for(int i=PositionsTotal()-1;i>=0;i--){ulong t=PositionGetTicket(i);if(!t||PositionGetString(POSITION_SYMBOL)!=_Symbol||PositionGetInteger(POSITION_MAGIC)!=InpMagic)continue;count++;datetime ot=(datetime)PositionGetInteger(POSITION_TIME);if(ot>=best){best=ot;dir=PositionGetInteger(POSITION_TYPE)==POSITION_TYPE_BUY?1:-1;price=PositionGetDouble(POSITION_PRICE_OPEN);}}return count>0;}
string StateFile(){return StringFormat("ApexState_%I64d.json",InpMagic);}
void SaveState(){int h=FileOpen(StateFile(),FILE_WRITE|FILE_TXT|FILE_ANSI);if(h==INVALID_HANDLE)return;FileWriteString(h,StringFormat("{\"campId\":\"%s\",\"campSig\":\"%s\",\"campDir\":%d,\"layers\":%d,\"cycleStart\":%.2f,\"targetEq\":%.2f,\"campStart\":%I64d,\"lastAdd\":%.5f,\"mfe\":%.2f,\"mae\":%.2f,\"peakProfitPct\":%.2f,\"floorProfitPct\":%.2f,\"firstEntryPrice\":%.5f,\"firstSLPrice\":%.5f,\"masterTicket\":%I64u,\"masterGuardStage\":%d}",campId,campSig,campDir,layers,cycleStart,targetEq,(long)campStart,lastAdd,mfe,mae,peakProfitPct,floorProfitPct,firstEntryPrice,firstSLPrice,masterTicket,masterGuardStage));FileClose(h);}
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
   // v3.3 confirmation-first exposure ladder:
   // L1 = 15% probe, L2 = 50% confirmed add, L3+ = 100% available-margin allocation.
   if(layers<=0)pct=MathMax(0.1,MathMin(100.0,InpNormalMarginPct));
   else if(layers==1)pct=MathMax(0.1,MathMin(100.0,InpNormalL2MarginPct));
   else pct=MathMax(0.1,MathMin(100.0,InpNormalL3PlusMarginPct));
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
 if(firstNormal&&InpNormalFixedSLGoldMove>0)sl=NormalizeDouble(dir>0?reqPrice-InpNormalFixedSLGoldMove:reqPrice+InpNormalFixedSLGoldMove,digits);
 bool ok=dir>0?trade.Buy(vol,_Symbol,0,sl,0,com):trade.Sell(vol,_Symbol,0,sl,0,com);
 if(!ok){Emit("ORDER_FAIL",StringFormat(",\"retcode\":%d",trade.ResultRetcode()));return false;}
 layers++;
 lastAdd=dir>0?SymbolInfoDouble(_Symbol,SYMBOL_ASK):SymbolInfoDouble(_Symbol,SYMBOL_BID);
 if(firstNormal){
   firstEntryPrice=trade.ResultPrice()>0?trade.ResultPrice():reqPrice;
   firstSLPrice=sl;
   masterTicket=FindOldestApexPosition();
   masterGuardStage=0;
   firstInitialSLPrice=sl;
   recoveryExitArmed=false;
   Emit("FIRST_ENTRY_GUARD",StringFormat(",\"entryPrice\":%.5f,\"slPrice\":%.5f,\"goldMove\":%.2f,\"masterTicket\":%I64u",firstEntryPrice,firstSLPrice,InpNormalFixedSLGoldMove,masterTicket));
 }
 SaveState();
 Emit("LAYER_OPEN",StringFormat(",\"layer\":%d,\"volume\":%.4f,\"marginPct\":%.2f,\"score\":%.2f,\"reason\":\"%s\",\"price\":%.5f,\"sl\":%.5f",layers,vol,pct,score,why,lastAdd,sl));
 return true;
}
bool CloseAll(){trade.SetExpertMagicNumber(InpMagic);for(int pass=0;pass<6;pass++){bool any=false;for(int i=PositionsTotal()-1;i>=0;i--){ulong t=PositionGetTicket(i);if(t&&PositionGetString(POSITION_SYMBOL)==_Symbol&&PositionGetInteger(POSITION_MAGIC)==InpMagic){any=true;trade.PositionClose(t);}}if(!any)break;Sleep(100);}return CountPos()==0;}
void Start(Snap &s){camp=true;campDir=s.dir;layers=0;cycleStart=AccountInfoDouble(ACCOUNT_BALANCE);targetEq=C.targetMode=="EQUITY"?C.targetEquity:(C.accountProfile=="NORMAL"?(InpNormalTakeProfitPct>0?cycleStart*(1.0+InpNormalTakeProfitPct/100.0):0.0):cycleStart*C.targetMultiplier);peakProfitPct=0;floorProfitPct=0;firstEntryPrice=0;firstSLPrice=0;masterTicket=0;masterGuardStage=0;campStart=TimeCurrent();campId=StringFormat("%I64d-%I64d",AccountInfoInteger(ACCOUNT_LOGIN),(long)campStart);campSig=s.sig;mfe=0;mae=0;Emit("CAMPAIGN_START",StringFormat(",\"score\":%.2f,\"targetEquity\":%.2f,\"entryPrice\":%.5f,\"impulseMult\":%.3f,\"wickRatio\":%.3f,\"m3\":%s,\"m5\":%s,\"atr\":%.5f",s.score,targetEq,s.price,s.impulseMult,s.wickRatio,s.m3?"true":"false",s.m5?"true":"false",s.atr));if(!OpenLayer(campDir,s.score,"PROBE_CONFIRMED")){camp=false;campId="";ClearState();}watch=false;}
void Finish(string outcome,string why){Emit("CAMPAIGN_END",StringFormat(",\"outcome\":\"%s\",\"reason\":\"%s\",\"mfe\":%.2f,\"mae\":%.2f,\"durationSec\":%d",outcome,why,mfe,mae,(int)(TimeCurrent()-campStart)));camp=false;campDir=0;layers=0;lastAdd=0;peakProfitPct=0;floorProfitPct=0;firstEntryPrice=0;firstSLPrice=0;masterTicket=0;masterGuardStage=0;lastEnd=TimeCurrent();campId="";campSig="";watch=false;ClearState();}
Snap AddSignal(){Snap s=Observe();if(s.dir!=campDir){s.valid=false;MqlRates m1[];if(!Rates(PERIOD_M1,30,m1))return s;s.atr=ATR();s.dir=campDir;s.price=campDir>0?SymbolInfoDouble(_Symbol,SYMBOL_BID):SymbolInfoDouble(_Symbol,SYMBOL_ASK);bool cont=campDir<0?(m1[1].close<m1[2].low&&m1[2].close<m1[3].low):(m1[1].close>m1[2].high&&m1[2].close>m1[3].high);bool pf=campDir<0?(m1[2].close>m1[2].open&&m1[1].close<m1[2].low):(m1[2].close<m1[2].open&&m1[1].close>m1[2].high);s.continuation=cont;s.pullbackFail=pf;s.score=60+(cont?20:0)+(pf?15:0);s.sig=campSig;s.reason=cont?"CONTINUATION_BREAK":pf?"FAILED_PULLBACK":"NO_NEW_CONFIRMATION";}return s;}
void Manage(){
 int n=CountPos();

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
 double profitPct=cycleStart>0?(p/cycleStart)*100.0:0;
 peakProfitPct=MathMax(peakProfitPct,profitPct);

 // v3.5 RECOVERY-TO-ENTRY EXIT
 // The original master/L1 SL distance defines the damage scale.
 // Example: entry 4700, original BUY SL 4670 => 30 XAU SL distance.
 // If price reaches 4685 or worse, the setup has suffered 50% of its SL distance.
 // From that moment the recovery exit is ARMED. If price later recovers to 4700,
 // close the entire Apex basket and allow a fresh campaign. It does not wait for profit.
 if(C.accountProfile=="NORMAL"&&InpRecoveryExitEnabled&&masterTicket>0&&
    firstEntryPrice>0&&firstInitialSLPrice>0){
   double originalSLDist=MathAbs(firstEntryPrice-firstInitialSLPrice);
   if(originalSLDist>0){
     double masterPx=campDir>0?SymbolInfoDouble(_Symbol,SYMBOL_BID):SymbolInfoDouble(_Symbol,SYMBOL_ASK);
     double adverseDist=campDir>0?MathMax(0.0,firstEntryPrice-masterPx):MathMax(0.0,masterPx-firstEntryPrice);
     double adversePctOfSL=(adverseDist/originalSLDist)*100.0;

     if(!recoveryExitArmed&&adversePctOfSL>=MathMax(0.0,InpRecoveryExitArmPctOfSL)){
       recoveryExitArmed=true;
       Emit("RECOVERY_EXIT_ARMED",StringFormat(",\"adversePctOfSL\":%.2f,\"armPctOfSL\":%.2f,\"entryPrice\":%.5f,\"initialSLPrice\":%.5f",adversePctOfSL,InpRecoveryExitArmPctOfSL,firstEntryPrice,firstInitialSLPrice));
     }

     bool recoveredToEntry=recoveryExitArmed&&(campDir>0?masterPx>=firstEntryPrice:masterPx<=firstEntryPrice);
     if(recoveredToEntry){
       if(n>0)CloseAll();
       Emit("RECOVERY_TO_ENTRY_EXIT",StringFormat(",\"entryPrice\":%.5f,\"recoveryPrice\":%.5f,\"armPctOfSL\":%.2f",firstEntryPrice,masterPx,InpRecoveryExitArmPctOfSL));
       Finish("RECOVERY_TO_ENTRY_EXIT","DEEP_ADVERSE_MOVE_RECOVERED_TO_MASTER_ENTRY");
       return;
     }
   }
 }

// v3.4: once whole Apex basket reaches the configured campaign-profit threshold,
 // tighten ONLY the master/L1 broker SL to its actual entry price (break-even).
 // This is a one-way ratchet: never widen it again.
 if(C.accountProfile=="NORMAL"&&InpMasterBreakEvenEnabled&&masterTicket>0&&
    firstEntryPrice>0&&cycleStart>0){
   double campaignProfitPct=(p/cycleStart)*100.0;
   bool beAlreadyActive=(campDir>0?firstSLPrice>=firstEntryPrice:firstSLPrice<=firstEntryPrice)&&firstSLPrice>0;
   if(campaignProfitPct>=InpMasterBreakEvenTriggerPct&&!beAlreadyActive){
     double beSL=firstEntryPrice;
     if(SetMasterSL(beSL,"CAMPAIGN_PROFIT_REACHED_BE_TRIGGER")){
       Emit("MASTER_BE_ARMED",StringFormat(",\"campaignProfitPct\":%.2f,\"triggerPct\":%.2f,\"entryPrice\":%.5f,\"masterTicket\":%I64u",campaignProfitPct,InpMasterBreakEvenTriggerPct,firstEntryPrice,masterTicket));
     }
   }
 }

 // Master/L1 fixed broker SL remains the hard invalidation guard.
 if(C.accountProfile=="NORMAL"&&masterTicket>0&&firstEntryPrice>0&&firstSLPrice>0){
   double guardPx=campDir>0?SymbolInfoDouble(_Symbol,SYMBOL_BID):SymbolInfoDouble(_Symbol,SYMBOL_ASK);
   bool masterGuardHit=(campDir>0?guardPx<=firstSLPrice:guardPx>=firstSLPrice);
   if(masterGuardHit){
     if(n>0)CloseAll();
     Finish("MASTER_SL_BASKET_EXIT","MASTER_INPUT_FIXED_SL_HIT");
     return;
   }
 }

 // Default Apex percentage profit ratchet, based on campaign-start balance:
 // +200% peak => protect +100%
 // +300% peak => protect +200%
 // +400% peak => protect +300%, etc.
 // This is NOT a hard TP. The basket keeps running until it retraces to the earned floor.
 if(C.accountProfile=="NORMAL"&&InpProfitRatchetEnabled&&cycleStart>0&&
    InpRatchetTriggerPct>0&&InpRatchetLockPct>=0&&
    InpRatchetStepPct>0&&InpRatchetLockStepPct>=0){
   double peakPct=(mfe/cycleStart)*100.0;
   if(peakPct>=InpRatchetTriggerPct){
     int ratchetSteps=(int)MathFloor((peakPct-InpRatchetTriggerPct)/InpRatchetStepPct);
     double protectedPct=InpRatchetLockPct+(double)ratchetSteps*InpRatchetLockStepPct;
     protectedPct=MathMax(0.0,protectedPct);
     double protectedProfit=cycleStart*(protectedPct/100.0);
     if(p<=protectedProfit){
       if(CloseAll()){
         Emit("PROFIT_RATCHET_EXIT",StringFormat(",\"peakProfit\":%.2f,\"peakPct\":%.2f,\"protectedProfit\":%.2f,\"protectedPct\":%.2f,\"currentProfit\":%.2f,\"steps\":%d",mfe,peakPct,protectedProfit,protectedPct,p,ratchetSteps));
         Finish("PROFIT_FLOOR_HIT","INPUT_PERCENT_PROFIT_RATCHET");
       }
       return;
     }
   }
 }

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
   Defaults();
   if(IsTester())C.armed=true;
   else LoadCloudCache();
   if(StringFind(_Symbol,"XAU")<0)return INIT_FAILED;
   hAtr=iATR(_Symbol,PERIOD_M1,14);if(hAtr==INVALID_HANDLE)return INIT_FAILED;
   EventSetMillisecondTimer(MathMax(100,InpScanMilliseconds));
   if(!IsTester())CloudSync();
   Print("APEX_READY ",APEX_VERSION,
      " | mode=",IsTester()?"TESTER":(AccountInfoInteger(ACCOUNT_TRADE_MODE)==ACCOUNT_TRADE_MODE_DEMO?"DEMO":"LIVE"),
      " | cloud=",InpCloudURL,
      " | cached=",g_cloudUsingCache?"true":"false",
      " | armed=",C.armed?"true":"false",
      " | strategy/exit logic unchanged from v3.5.1");
   return INIT_SUCCEEDED;
}void OnDeinit(const int r){EventKillTimer();if(hAtr!=INVALID_HANDLE)IndicatorRelease(hAtr);}void OnTick(){}void OnTimer(){datetime now=TimeCurrent();if(now-lastCfg>=InpConfigPollSeconds){CloudSync();lastCfg=now;}if(camp||CountPos()>0){if(!camp&&CountPos()>0){int nDir,nCount;double nPrice;NewestMagicPosition(nDir,nPrice,nCount);string j;if(nCount>0&&LoadState(j)&&ji(j,"campDir",0)==nDir&&StringLen(js(j,"campId",""))>0){camp=true;campId=js(j,"campId","");campSig=js(j,"campSig","RECOVERED");campDir=nDir;layers=(int)MathMax(nCount,ji(j,"layers",nCount));cycleStart=jd(j,"cycleStart",AccountInfoDouble(ACCOUNT_BALANCE));targetEq=jd(j,"targetEq",C.targetMode=="EQUITY"?C.targetEquity:(C.accountProfile=="NORMAL"?(InpNormalTakeProfitPct>0?cycleStart*(1.0+InpNormalTakeProfitPct/100.0):0.0):cycleStart*C.targetMultiplier));peakProfitPct=jd(j,"peakProfitPct",0);floorProfitPct=jd(j,"floorProfitPct",0);firstEntryPrice=jd(j,"firstEntryPrice",0);firstSLPrice=jd(j,"firstSLPrice",0);masterTicket=ju(j,"masterTicket",0);masterGuardStage=ji(j,"masterGuardStage",0);campStart=(datetime)ji(j,"campStart",(int)now);lastAdd=nPrice;mfe=jd(j,"mfe",0);mae=jd(j,"mae",0);Emit("CAMPAIGN_RECOVERED",StringFormat(",\"source\":\"STATE_FILE\",\"layers\":%d",layers));}else if(nCount>0){camp=true;campDir=nDir;layers=nCount;cycleStart=AccountInfoDouble(ACCOUNT_BALANCE);targetEq=C.targetMode=="EQUITY"?C.targetEquity:(C.accountProfile=="NORMAL"?(InpNormalTakeProfitPct>0?cycleStart*(1.0+InpNormalTakeProfitPct/100.0):0.0):cycleStart*C.targetMultiplier);peakProfitPct=0;floorProfitPct=0;masterTicket=FindOldestApexPosition();masterGuardStage=0;firstEntryPrice=0;firstSLPrice=0;campStart=now;campId=StringFormat("RECOVER-%I64d",(long)now);campSig="RECOVERED_NO_STATE";lastAdd=nPrice;mfe=0;mae=0;Emit("CAMPAIGN_RECOVERED",",\"source\":\"POSITION_SCAN_ONLY\",\"warning\":\"CYCLE_START_EQUITY_ESTIMATED_FROM_RESTART_BALANCE\"");}SaveState();}Manage();return;}if(!C.armed)return;if(lastEnd>0&&now-lastEnd<C.cooldownMinutes*60)return;Snap s=Observe();if(s.valid)Start(s);}
