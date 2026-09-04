#property copyright "XauCloud Apex"
#property version   "3.410"
#property strict
#property description "ApexStack: XAUUSD exhaustion/reversal campaign with aggressive profit-side pyramiding"
#include <Trade/Trade.mqh>
CTrade trade;
#define APEX_VERSION "XauCloud-Apex_v3.4.1"
#define APEX_MAGIC 8620260903
input string InpApiBase="https://apex.xaucloud.io";
input string InpEaToken="REPLACE_EA_TOKEN";
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
struct Config{bool armed;string account;string symbolContains;string targetMode,accountProfile;double targetEquity,targetMultiplier,normalTargetProfitPct,baseMarginPct,layerMultiplier;int maxLayers;double entryScore,addScore,impulseAtr,sweepAtr,addSpacingAtr,rejectionZoneAtr;int rejectionBars,watchExpiryMinutes,cooldownMinutes;bool requireM3Confirm,requireM5Context,learningEnabled;double learnEntryAdj,learnAddAdj;double normalL1MarginPct,normalL2MarginPct,normalL3PlusMarginPct,normalFixedSLGoldMove,ratchetTriggerPct,ratchetLockPct,ratchetStepPct,ratchetLockStepPct,masterBreakEvenTriggerPct;bool profitRatchetEnabled,masterBreakEvenEnabled;};
struct Snap{bool valid;int dir;double score,atr,price,extreme,impulseMult,sweepMult,wickRatio;bool swept,rejected,microBreak,m3,m5,continuation,pullbackFail;string sig,reason;};
Config C;int hAtr=INVALID_HANDLE;datetime lastCfg=0,lastEnd=0;bool camp=false;int campDir=0,layers=0;double cycleStart=0,targetEq=0,lastAdd=0,mfe=0,mae=0,firstEntryPrice=0,firstSLPrice=0;ulong masterTicket=0;int masterGuardStage=0;datetime campStart=0;string campId="",campSig="";
bool watch=false;int watchDir=0;datetime watchStart=0,watchSweepBarTime=0;double watchExtreme=0,watchPrior=0,watchAtr=0;string watchSig="";
bool everSyncedRemote=false;string lastConfigSig="";
string trim(string s){StringTrimLeft(s);StringTrimRight(s);return s;} string raw(string j,string k){string n="\""+k+"\":";int p=StringFind(j,n);if(p<0)return"";p+=StringLen(n);while(p<StringLen(j)&&StringGetCharacter(j,p)==' ')p++;ushort c=StringGetCharacter(j,p);if(c=='\"'){int e=p+1;while(e<StringLen(j)&&StringGetCharacter(j,e)!='\"')e++;return StringSubstr(j,p+1,e-p-1);}int e=p;while(e<StringLen(j)){ushort x=StringGetCharacter(j,e);if(x==','||x=='}'||x==']')break;e++;}return trim(StringSubstr(j,p,e-p));}
double jd(string j,string k,double d){string v=raw(j,k);return v==""?d:StringToDouble(v);} int ji(string j,string k,int d){string v=raw(j,k);return v==""?d:(int)StringToInteger(v);} bool jb(string j,string k,bool d){string v=raw(j,k);if(v=="true")return true;if(v=="false")return false;return d;} string js(string j,string k,string d){string v=raw(j,k);return v==""?d:v;} ulong ju(string j,string k,ulong d){string v=raw(j,k);return v==""?d:(ulong)StringToInteger(v);}
bool Http(string method,string ep,string body,string &resp){if((bool)MQLInfoInteger(MQL_TESTER))return false;string hdr="Authorization: Bearer "+InpEaToken+"\r\nContent-Type: application/json\r\n";char d[],r[];string rh;StringToCharArray(body,d,0,WHOLE_ARRAY,CP_UTF8);ResetLastError();int code=WebRequest(method,InpApiBase+ep,hdr,7000,d,r,rh);if(code<0){Print("APEX_HTTP_ERROR ",GetLastError());return false;}resp=CharArrayToString(r,0,-1,CP_UTF8);return code>=200&&code<300;}
string ConfigSource(){return everSyncedRemote?"REMOTE":"LOCAL_INPUT";}
void Emit(string type,string extra=""){
 string cfgFields=StringFormat(",\"l1MarginPct\":%.2f,\"l2MarginPct\":%.2f,\"l3PlusMarginPct\":%.2f,\"takeProfitPct\":%.2f,\"fixedSLGoldMove\":%.2f,\"beEnabled\":%s,\"beTriggerPct\":%.2f,\"ratchetEnabled\":%s,\"ratchetTriggerPct\":%.2f,\"ratchetLockPct\":%.2f,\"ratchetStepPct\":%.2f,\"ratchetLockStepPct\":%.2f,\"configSource\":\"%s\",\"eaVersion\":\"%s\"",
  C.normalL1MarginPct,C.normalL2MarginPct,C.normalL3PlusMarginPct,C.normalTargetProfitPct,C.normalFixedSLGoldMove,C.masterBreakEvenEnabled?"true":"false",C.masterBreakEvenTriggerPct,C.profitRatchetEnabled?"true":"false",C.ratchetTriggerPct,C.ratchetLockPct,C.ratchetStepPct,C.ratchetLockStepPct,ConfigSource(),APEX_VERSION);
 string b=StringFormat("{\"type\":\"%s\",\"account\":\"%I64d\",\"broker\":\"%s\",\"currency\":\"%s\",\"license\":\"%s\",\"symbol\":\"%s\",\"version\":\"%s\",\"campaignId\":\"%s\",\"signature\":\"%s\",\"direction\":%d,\"layers\":%d,\"balance\":%.2f,\"equity\":%.2f,\"freeMargin\":%.2f%s%s}",type,AccountInfoInteger(ACCOUNT_LOGIN),AccountInfoString(ACCOUNT_COMPANY),AccountInfoString(ACCOUNT_CURRENCY),InpApexLicense,_Symbol,APEX_VERSION,campId,campSig,campDir,layers,AccountInfoDouble(ACCOUNT_BALANCE),AccountInfoDouble(ACCOUNT_EQUITY),AccountInfoDouble(ACCOUNT_MARGIN_FREE),cfgFields,extra);
 string r;Http("POST","/api/ea/event",b,r);
}
void PrintEffectiveConfig(){
 Print("APEX_EFFECTIVE_CONFIG",
  " profile=",C.accountProfile,
  " l1MarginPct=",DoubleToString(C.normalL1MarginPct,2),
  " l2MarginPct=",DoubleToString(C.normalL2MarginPct,2),
  " l3PlusMarginPct=",DoubleToString(C.normalL3PlusMarginPct,2),
  " takeProfitPct=",DoubleToString(C.normalTargetProfitPct,2),
  " fixedSLGoldMove=",DoubleToString(C.normalFixedSLGoldMove,2),
  " masterBEEnabled=",(C.masterBreakEvenEnabled?"true":"false"),
  " masterBETriggerPct=",DoubleToString(C.masterBreakEvenTriggerPct,2),
  " ratchetEnabled=",(C.profitRatchetEnabled?"true":"false"),
  " ratchetTriggerPct=",DoubleToString(C.ratchetTriggerPct,2),
  " ratchetLockPct=",DoubleToString(C.ratchetLockPct,2),
  " ratchetStepPct=",DoubleToString(C.ratchetStepPct,2),
  " ratchetLockStepPct=",DoubleToString(C.ratchetLockStepPct,2),
  " source=",ConfigSource());
}
void Defaults(){
 C.armed=!InpRequireRemoteArm;C.account="0";C.symbolContains="XAUUSD";C.targetMode="MULTIPLIER";C.accountProfile="NORMAL";
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
}
string ConfigSignature(){return StringFormat("%.2f|%.2f|%.2f|%.2f|%.2f|%s|%.2f|%s|%.2f|%.2f|%.2f|%.2f|%s",C.normalL1MarginPct,C.normalL2MarginPct,C.normalL3PlusMarginPct,C.normalTargetProfitPct,C.normalFixedSLGoldMove,C.masterBreakEvenEnabled?"1":"0",C.masterBreakEvenTriggerPct,C.profitRatchetEnabled?"1":"0",C.ratchetTriggerPct,C.ratchetLockPct,C.ratchetStepPct,C.ratchetLockStepPct,ConfigSource());}
bool ConfigPoll(){
 string r,ep=StringFormat("/api/ea/config?account=%I64d&license=%s",AccountInfoInteger(ACCOUNT_LOGIN),InpApexLicense);
 if(!Http("GET",ep,"",r))return false;
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
 everSyncedRemote=true;
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
 OrderCalcMargin(t,_Symbol,1.0,p,m1lot);
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
void SaveState(){int h=FileOpen(StateFile(),FILE_WRITE|FILE_TXT|FILE_ANSI);if(h==INVALID_HANDLE)return;FileWriteString(h,StringFormat("{\"campId\":\"%s\",\"campSig\":\"%s\",\"campDir\":%d,\"layers\":%d,\"cycleStart\":%.2f,\"targetEq\":%.2f,\"campStart\":%I64d,\"lastAdd\":%.5f,\"mfe\":%.2f,\"mae\":%.2f,\"firstEntryPrice\":%.5f,\"firstSLPrice\":%.5f,\"masterTicket\":%I64u,\"masterGuardStage\":%d}",campId,campSig,campDir,layers,cycleStart,targetEq,(long)campStart,lastAdd,mfe,mae,firstEntryPrice,firstSLPrice,masterTicket,masterGuardStage));FileClose(h);}
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
 if(!ok){Emit("ORDER_FAIL",StringFormat(",\"retcode\":%d",trade.ResultRetcode()));return false;}
 layers++;
 lastAdd=dir>0?SymbolInfoDouble(_Symbol,SYMBOL_ASK):SymbolInfoDouble(_Symbol,SYMBOL_BID);
 if(firstNormal){
   firstEntryPrice=trade.ResultPrice()>0?trade.ResultPrice():reqPrice;
   firstSLPrice=sl;
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
 firstEntryPrice=0;firstSLPrice=0;masterTicket=0;masterGuardStage=0;campStart=TimeCurrent();campId=StringFormat("%I64d-%I64d",AccountInfoInteger(ACCOUNT_LOGIN),(long)campStart);campSig=s.sig;mfe=0;mae=0;
 Emit("CAMPAIGN_START",StringFormat(",\"score\":%.2f,\"targetEquity\":%.2f,\"entryPrice\":%.5f,\"impulseMult\":%.3f,\"wickRatio\":%.3f,\"m3\":%s,\"m5\":%s,\"atr\":%.5f",s.score,targetEq,s.price,s.impulseMult,s.wickRatio,s.m3?"true":"false",s.m5?"true":"false",s.atr));
 if(!OpenLayer(campDir,s.score,"PROBE_CONFIRMED")){camp=false;campId="";ClearState();}
 watch=false;
}
void Finish(string outcome,string why){Emit("CAMPAIGN_END",StringFormat(",\"outcome\":\"%s\",\"reason\":\"%s\",\"mfe\":%.2f,\"mae\":%.2f,\"durationSec\":%d",outcome,why,mfe,mae,(int)(TimeCurrent()-campStart)));camp=false;campDir=0;layers=0;lastAdd=0;firstEntryPrice=0;firstSLPrice=0;masterTicket=0;masterGuardStage=0;lastEnd=TimeCurrent();campId="";campSig="";watch=false;ClearState();}
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
 Defaults();
 if((bool)MQLInfoInteger(MQL_TESTER))C.armed=true;
 if(StringFind(_Symbol,"XAU")<0)return INIT_FAILED;
 hAtr=iATR(_Symbol,PERIOD_M1,14);
 if(hAtr==INVALID_HANDLE)return INIT_FAILED;
 EventSetMillisecondTimer(MathMax(100,InpScanMilliseconds));
 ConfigPoll();
 lastConfigSig=ConfigSignature();
 PrintEffectiveConfig();
 Print("APEX_READY ",APEX_VERSION," tester=",(bool)MQLInfoInteger(MQL_TESTER));
 return INIT_SUCCEEDED;
}
void OnDeinit(const int r){EventKillTimer();if(hAtr!=INVALID_HANDLE)IndicatorRelease(hAtr);}
void OnTick(){}
void OnTimer(){
 datetime now=TimeCurrent();
 if(now-lastCfg>=InpConfigPollSeconds){ConfigPoll();lastCfg=now;}
 if(camp||CountPos()>0){
   if(!camp&&CountPos()>0){
     int nDir,nCount;double nPrice;NewestMagicPosition(nDir,nPrice,nCount);
     string j;
     if(nCount>0&&LoadState(j)&&ji(j,"campDir",0)==nDir&&StringLen(js(j,"campId",""))>0){
       camp=true;campId=js(j,"campId","");campSig=js(j,"campSig","RECOVERED");campDir=nDir;layers=(int)MathMax(nCount,ji(j,"layers",nCount));
       cycleStart=jd(j,"cycleStart",AccountInfoDouble(ACCOUNT_BALANCE));
       targetEq=jd(j,"targetEq",C.targetMode=="EQUITY"?C.targetEquity:(C.accountProfile=="NORMAL"?(C.normalTargetProfitPct>0?cycleStart*(1.0+C.normalTargetProfitPct/100.0):0.0):cycleStart*C.targetMultiplier));
       firstEntryPrice=jd(j,"firstEntryPrice",0);firstSLPrice=jd(j,"firstSLPrice",0);masterTicket=ju(j,"masterTicket",0);masterGuardStage=ji(j,"masterGuardStage",0);
       campStart=(datetime)ji(j,"campStart",(int)now);lastAdd=nPrice;mfe=jd(j,"mfe",0);mae=jd(j,"mae",0);
       Emit("CAMPAIGN_RECOVERED",StringFormat(",\"source\":\"STATE_FILE\",\"layers\":%d",layers));
     }else if(nCount>0){
       camp=true;campDir=nDir;layers=nCount;cycleStart=AccountInfoDouble(ACCOUNT_BALANCE);
       targetEq=C.targetMode=="EQUITY"?C.targetEquity:(C.accountProfile=="NORMAL"?(C.normalTargetProfitPct>0?cycleStart*(1.0+C.normalTargetProfitPct/100.0):0.0):cycleStart*C.targetMultiplier);
       masterTicket=FindOldestApexPosition();masterGuardStage=0;firstEntryPrice=0;firstSLPrice=0;
       campStart=now;campId=StringFormat("RECOVER-%I64d",(long)now);campSig="RECOVERED_NO_STATE";lastAdd=nPrice;mfe=0;mae=0;
       Emit("CAMPAIGN_RECOVERED",",\"source\":\"POSITION_SCAN_ONLY\",\"warning\":\"CYCLE_START_EQUITY_AND_RATCHET_PEAK_ESTIMATED_FROM_RESTART_BALANCE_STATE_FILE_MISSING\"");
     }
     SaveState();
   }
   Manage();
   return;
 }
 if(!C.armed)return;
 if(lastEnd>0&&now-lastEnd<C.cooldownMinutes*60)return;
 Snap s=Observe();
 if(s.valid)Start(s);
}
