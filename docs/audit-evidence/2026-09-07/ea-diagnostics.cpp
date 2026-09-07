
#include <cmath>
#include <cfloat>
#include <iostream>
#include <string>
#include <vector>
#include <algorithm>
using ulong=unsigned long; using string=std::string; using datetime=long long; using ENUM_ORDER_TYPE=int;
const int INVALID_HANDLE=-1, PERIOD_M1=1,PERIOD_M3=3,PERIOD_M5=5,SYMBOL_ASK=1,SYMBOL_BID=2,SYMBOL_VOLUME_MIN=3,SYMBOL_VOLUME_MAX=4,SYMBOL_VOLUME_STEP=5,ACCOUNT_MARGIN_FREE=1,ORDER_TYPE_BUY=1,ORDER_TYPE_SELL=2;
string _Symbol="XAUUSD"; double _Point=.001;
template<class A,class B> double MathMax(A a,B b){return std::max(double(a),double(b));}
template<class A,class B> double MathMin(A a,B b){return std::min(double(a),double(b));}
double MathAbs(double x){return fabs(x);} double MathFloor(double x){return floor(x);} double NormalizeDouble(double x,int n){double p=pow(10,n);return round(x*p)/p;}
double clamp(double x,double a,double b){return MathMax(a,MathMin(b,x));}
template<class... A> string StringFormat(string s,A...){return s;}
struct MqlRates {datetime time=0;double open=0,high=0,low=0,close=0;};
std::vector<MqlRates> bars(90),three(24),five(18);
double quote=98,freeMargin=10,minVolume=.1,maxVolume=10,stepVolume=.1;
datetime now=10000;
datetime TimeCurrent(){return now;}
double ATR(){return 1;}
bool Rates(int tf,int,std::vector<MqlRates>& out){out=tf==1?bars:tf==3?three:five;return true;}
double SymbolInfoDouble(string,int field){if(field==SYMBOL_VOLUME_MIN)return minVolume;if(field==SYMBOL_VOLUME_MAX)return maxVolume;if(field==SYMBOL_VOLUME_STEP)return stepVolume;return quote;}
double AccountInfoDouble(int){return freeMargin;}
bool OrderCalcMargin(int,string,double volume,double,double& margin){margin=100*volume;return true;}
void Emit(string,string){}
struct Config{bool armed;string account;string symbolContains;string targetMode,accountProfile;double targetEquity,targetMultiplier,normalTargetProfitPct,baseMarginPct,layerMultiplier;int maxLayers;double entryScore,addScore,impulseAtr,sweepAtr,addSpacingAtr,rejectionZoneAtr;int rejectionBars,watchExpiryMinutes,cooldownMinutes;bool requireM3Confirm,requireM5Context,learningEnabled,normalProfitFloorEnabled;double learnEntryAdj,learnAddAdj;bool profitRatchetEnabled;double ratchetTriggerPct,ratchetLockPct,ratchetStepPct,ratchetLockStepPct;};
struct Snap{bool valid;int dir;double score,atr,price,extreme,impulseMult,sweepMult,wickRatio;bool swept,rejected,microBreak,m3,m5,continuation,pullbackFail;string sig,reason;};
Config C;int hAtr=INVALID_HANDLE;datetime lastCfg=0,lastEnd=0;bool camp=false;int campDir=0,layers=0;double cycleStart=0,targetEq=0,lastAdd=0,mfe=0,mae=0,peakProfitPct=0,floorProfitPct=0,firstEntryPrice=0,firstSLPrice=0,firstInitialSLPrice=0;bool recoveryExitArmed=false;ulong masterTicket=0;int masterGuardStage=0;datetime campStart=0;string campId="",campSig="";
bool watch=false;int watchDir=0;datetime watchStart=0,watchSweepBarTime=0;double watchExtreme=0,watchPrior=0,watchAtr=0;string watchSig="";


bool InpRecoveryExitEnabled=false,InpMasterBreakEvenEnabled=false;
double InpRecoveryExitArmPctOfSL=40,InpMasterBreakEvenTriggerPct=50;
int positions=1,opened=0,finished=0;bool masterExists=true,closeSucceeds=true; double profit=1;
int CountPos(){return positions;} bool MasterPositionExists(){return masterExists;}
bool CloseAll(){if(closeSucceeds)positions=0;return closeSucceeds;}
void Finish(string,string){finished++;camp=false;masterTicket=0;layers=0;}
double BasketProfit(){return profit;} bool SetMasterSL(double,string){return true;} void SaveState(){}
bool OpenLayer(int,double,string){opened++;layers++;lastAdd=quote;return true;}
Snap Observe(){Snap s;s.valid=false;s.dir=0;s.score=0;s.atr=ATR();s.price=0;s.extreme=0;s.impulseMult=0;s.sweepMult=0;s.wickRatio=0;s.swept=false;s.rejected=false;s.microBreak=false;s.m3=false;s.m5=false;s.continuation=false;s.pullbackFail=false;s.sig="NONE";s.reason="";if(s.atr<=0)return s;std::vector<MqlRates> m1,m3,m5;if(!Rates(PERIOD_M1,90,m1)||!Rates(PERIOD_M3,24,m3)||!Rates(PERIOD_M5,18,m5))return s;
 double move=m1[1].close-m1[8].close;int imp=move>=0?1:-1;s.impulseMult=MathAbs(move)/s.atr;int directional=0;for(int i=1;i<=7;i++)if((imp>0&&m1[i].close>m1[i].open)||(imp<0&&m1[i].close<m1[i].open))directional++;
 double ph=-DBL_MAX,pl=DBL_MAX;for(int i=9;i<80;i++){ph=MathMax(ph,m1[i].high);pl=MathMin(pl,m1[i].low);} if(!watch&&s.impulseMult>=C.impulseAtr&&directional>=5){double ex=imp>0?m1[1].high:m1[1].low;bool swept=imp>0?ex>=ph+C.sweepAtr*s.atr:ex<=pl-C.sweepAtr*s.atr;if(swept){watch=true;watchDir=-imp;watchStart=TimeCurrent();watchSweepBarTime=m1[1].time;watchExtreme=ex;watchPrior=imp>0?ph:pl;watchAtr=s.atr;watchSig=watchDir<0?"SELL_UPSIDE_LIQUIDITY_EXHAUST":"BUY_DOWNSIDE_LIQUIDITY_EXHAUST";Emit("WATCH_ARMED",StringFormat(",\"watchDir\":%d,\"impulseAtr\":%.3f",watchDir,s.impulseMult));}}
 if(!watch)return s;if(TimeCurrent()-watchStart>C.watchExpiryMinutes*60){watch=false;return s;} s.dir=watchDir;s.sig=watchSig;s.extreme=watchExtreme;s.swept=true;s.impulseMult=MathAbs(m1[1].close-m1[8].close)/s.atr;s.price=s.dir>0?SymbolInfoDouble(_Symbol,SYMBOL_ASK):SymbolInfoDouble(_Symbol,SYMBOL_BID);
 int rb=MathMax(1,MathMin(C.rejectionBars,8));bool rej=false,bos=false;double bestW=0;for(int i=1;i<=rb;i++){if(m1[i].time<=watchSweepBarTime)continue;double body=MathMax(_Point,MathAbs(m1[i].close-m1[i].open));double up=m1[i].high-MathMax(m1[i].open,m1[i].close),lo=MathMin(m1[i].open,m1[i].close)-m1[i].low;if(s.dir<0){bestW=MathMax(bestW,up/body);if(m1[i].high>=watchExtreme-C.rejectionZoneAtr*s.atr&&m1[i].close<watchPrior)rej=true;}else{bestW=MathMax(bestW,lo/body);if(m1[i].low<=watchExtreme+C.rejectionZoneAtr*s.atr&&m1[i].close>watchPrior)rej=true;}}
 if(m1[1].time>watchSweepBarTime){if(s.dir<0)bos=(m1[1].close<m1[2].low)||(m1[1].low<m1[3].low&&m1[1].close<m1[2].open);else bos=(m1[1].close>m1[2].high)||(m1[1].high>m1[3].high&&m1[1].close>m1[2].open);}s.rejected=rej;s.microBreak=bos;s.wickRatio=bestW;s.m3=s.dir<0?(m3[1].close<m3[1].open&&m3[1].close<(m3[1].high+m3[1].low)/2):(m3[1].close>m3[1].open&&m3[1].close>(m3[1].high+m3[1].low)/2);s.m5=s.dir<0?m5[1].close<m5[1].open:m5[1].close>m5[1].open;
 double score=25+clamp(s.impulseMult/C.impulseAtr*15,0,18)+(s.rejected?24:0)+(s.microBreak?22:0)+(s.m3?8:0)+(s.m5?3:0)+clamp(bestW*2,0,5);s.score=clamp(score,0,100);double threshold=C.entryScore+(C.learningEnabled?C.learnEntryAdj:0);s.valid=s.rejected&&s.microBreak&&(!C.requireM3Confirm||s.m3)&&(!C.requireM5Context||s.m5)&&s.score>=threshold;s.reason=s.valid?"CONFIRMED_EXHAUSTION_REVERSAL":"WATCHING_FOR_REJECTION_AND_BOS";return s;}
int VolDigits(){double st=SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_STEP);return st>=1?0:st>=.1?1:st>=.01?2:3;} double NormVol(double v){double mn=SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_MIN),mx=SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_MAX),st=SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_STEP);if(st<=0)st=mn;v=MathFloor(v/st)*st;return NormalizeDouble(MathMax(mn,MathMin(mx,v)),VolDigits());}
double VolumeForMargin(int dir,double pct){double free=AccountInfoDouble(ACCOUNT_MARGIN_FREE),budget=free*clamp(pct,.1,100)/100.0,mx=SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_MAX),mn=SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_MIN),p=dir>0?SymbolInfoDouble(_Symbol,SYMBOL_ASK):SymbolInfoDouble(_Symbol,SYMBOL_BID),m=0;ENUM_ORDER_TYPE t=dir>0?ORDER_TYPE_BUY:ORDER_TYPE_SELL;if(free<=0)return 0;if(OrderCalcMargin(t,_Symbol,mx,p,m)&&m<=budget)return NormVol(mx);double lo=0,hi=mx;for(int i=0;i<36;i++){double mid=(lo+hi)/2;if(!OrderCalcMargin(t,_Symbol,mid,p,m)||m>budget)hi=mid;else lo=mid;}double v=NormVol(lo);if(v<mn){if(OrderCalcMargin(t,_Symbol,mn,p,m)&&m<=budget)return NormVol(mn);return 0;}return v;}

Snap AddSignal(){Snap s=Observe();if(s.dir!=campDir){s.valid=false;std::vector<MqlRates> m1;if(!Rates(PERIOD_M1,30,m1))return s;s.atr=ATR();s.dir=campDir;s.price=campDir>0?SymbolInfoDouble(_Symbol,SYMBOL_BID):SymbolInfoDouble(_Symbol,SYMBOL_ASK);bool cont=campDir<0?(m1[1].close<m1[2].low&&m1[2].close<m1[3].low):(m1[1].close>m1[2].high&&m1[2].close>m1[3].high);bool pf=campDir<0?(m1[2].close>m1[2].open&&m1[1].close<m1[2].low):(m1[2].close<m1[2].open&&m1[1].close>m1[2].high);s.continuation=cont;s.pullbackFail=pf;s.score=60+(cont?20:0)+(pf?15:0);s.sig=campSig;s.reason=cont?"CONTINUATION_BREAK":pf?"FAILED_PULLBACK":"NO_NEW_CONFIRMATION";}return s;}
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

void reset(){C=Config{};C.accountProfile="NORMAL";C.entryScore=76;C.addScore=70;C.impulseAtr=1.8;C.sweepAtr=.05;C.rejectionBars=5;C.watchExpiryMinutes=12;C.rejectionZoneAtr=.12;C.requireM3Confirm=true;C.addSpacingAtr=.22;C.armed=true;watch=true;watchDir=-1;watchStart=now;watchSweepBarTime=9000;watchExtreme=101;watchPrior=100;watchSig="SELL";for(int i=0;i<90;i++)bars[i]={now-i*60,99,100,98,99};bars[1]={9940,100,101,97.5,98};bars[2]={9880,99.5,100,98.5,99};three[1]={9800,101,102,98,99};five[1]=three[1];quote=98;camp=true;campDir=-1;masterTicket=1;masterExists=true;positions=1;closeSucceeds=true;finished=opened=0;cycleStart=100;targetEq=0;firstEntryPrice=firstSLPrice=firstInitialSLPrice=0;lastAdd=100;mfe=mae=0;layers=1;profit=1;}
int main(){
reset();auto a=Observe();quote=102;auto b=Observe();quote=90;auto c=Observe();std::cout<<"{\"test\":\"current_price_revalidation\",\"normalValid\":"<<a.valid<<",\"reclaimedExtremeValid\":"<<b.valid<<",\"farChaseValid\":"<<c.valid<<",\"score\":"<<a.score<<"}\n";
reset();three[1].time=8000;auto d=Observe();std::cout<<"{\"test\":\"pre_sweep_m3\",\"valid\":"<<d.valid<<"}\n";
reset();watch=false;for(int i=0;i<90;i++)bars[i]={now-i*60,100,101,99,100};bars[1]={9940,99,99.2,97,98};bars[2]={9880,100,100.2,98.5,99};bars[3]={9820,101,102,99.5,100};quote=99.7;Manage();now++;quote=99.4;Manage();std::cout<<"{\"test\":\"same_closed_bar_adds\",\"opened\":"<<opened<<",\"signalBarTime\":"<<bars[1].time<<"}\n";
reset();freeMargin=10;double v=VolumeForMargin(-1,15);std::cout<<"{\"test\":\"minimum_volume_budget\",\"budget\":1.5,\"volume\":"<<v<<",\"requiredMargin\":"<<v*100<<"}\n";
reset();masterExists=false;closeSucceeds=false;Manage();std::cout<<"{\"test\":\"failed_basket_close\",\"remainingPositions\":"<<positions<<",\"campaignActive\":"<<camp<<",\"finishCalls\":"<<finished<<"}\n";
reset();C.profitRatchetEnabled=true;C.ratchetTriggerPct=180;C.ratchetLockPct=100;C.ratchetStepPct=100;C.ratchetLockStepPct=100;mfe=200;profit=150;Manage();C.ratchetLockPct=20;profit=50;Manage();std::cout<<"{\"test\":\"ratchet_config_loosen\",\"remainingPositions\":"<<positions<<",\"profitBelowPreviouslyEarnedFloor\":50}\n";
}
