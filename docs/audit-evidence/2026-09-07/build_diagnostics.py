from pathlib import Path
s=Path('work/XauCloud-Apex/ea/XauCloud-Apex.mq5').read_text()
def section(a,b): return s[s.index(a):s.index(b)]
parts=[section('struct Config','// === v3.7'),section('Snap Observe()','int CountPos()'),section('Snap AddSignal()','int OnInit()')]
body='\n'.join(parts).replace('MqlRates m1[],m3[],m5[];','std::vector<MqlRates> m1,m3,m5;').replace('MqlRates m1[];','std::vector<MqlRates> m1;')
# Manage dependencies must follow globals but precede extracted functions.
globals, functions=body.split('Snap Observe()',1)
pre=r'''
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
'''
stubs=r'''
bool InpRecoveryExitEnabled=false,InpMasterBreakEvenEnabled=false;
double InpRecoveryExitArmPctOfSL=40,InpMasterBreakEvenTriggerPct=50;
int positions=1,opened=0,finished=0;bool masterExists=true,closeSucceeds=true; double profit=1;
int CountPos(){return positions;} bool MasterPositionExists(){return masterExists;}
bool CloseAll(){if(closeSucceeds)positions=0;return closeSucceeds;}
void Finish(string,string){finished++;camp=false;masterTicket=0;layers=0;}
double BasketProfit(){return profit;} bool SetMasterSL(double,string){return true;} void SaveState(){}
bool OpenLayer(int,double,string){opened++;layers++;lastAdd=quote;return true;}
'''
main=r'''
void reset(){C=Config{};C.accountProfile="NORMAL";C.entryScore=76;C.addScore=70;C.impulseAtr=1.8;C.sweepAtr=.05;C.rejectionBars=5;C.watchExpiryMinutes=12;C.rejectionZoneAtr=.12;C.requireM3Confirm=true;C.addSpacingAtr=.22;C.armed=true;watch=true;watchDir=-1;watchStart=now;watchSweepBarTime=9000;watchExtreme=101;watchPrior=100;watchSig="SELL";for(int i=0;i<90;i++)bars[i]={now-i*60,99,100,98,99};bars[1]={9940,100,101,97.5,98};bars[2]={9880,99.5,100,98.5,99};three[1]={9800,101,102,98,99};five[1]=three[1];quote=98;camp=true;campDir=-1;masterTicket=1;masterExists=true;positions=1;closeSucceeds=true;finished=opened=0;cycleStart=100;targetEq=0;firstEntryPrice=firstSLPrice=firstInitialSLPrice=0;lastAdd=100;mfe=mae=0;layers=1;profit=1;}
int main(){
reset();auto a=Observe();quote=102;auto b=Observe();quote=90;auto c=Observe();std::cout<<"{\"test\":\"current_price_revalidation\",\"normalValid\":"<<a.valid<<",\"reclaimedExtremeValid\":"<<b.valid<<",\"farChaseValid\":"<<c.valid<<",\"score\":"<<a.score<<"}\n";
reset();three[1].time=8000;auto d=Observe();std::cout<<"{\"test\":\"pre_sweep_m3\",\"valid\":"<<d.valid<<"}\n";
reset();watch=false;for(int i=0;i<90;i++)bars[i]={now-i*60,100,101,99,100};bars[1]={9940,99,99.2,97,98};bars[2]={9880,100,100.2,98.5,99};bars[3]={9820,101,102,99.5,100};quote=99.7;Manage();now++;quote=99.4;Manage();std::cout<<"{\"test\":\"same_closed_bar_adds\",\"opened\":"<<opened<<",\"signalBarTime\":"<<bars[1].time<<"}\n";
reset();freeMargin=10;double v=VolumeForMargin(-1,15);std::cout<<"{\"test\":\"minimum_volume_budget\",\"budget\":1.5,\"volume\":"<<v<<",\"requiredMargin\":"<<v*100<<"}\n";
reset();masterExists=false;closeSucceeds=false;Manage();std::cout<<"{\"test\":\"failed_basket_close\",\"remainingPositions\":"<<positions<<",\"campaignActive\":"<<camp<<",\"finishCalls\":"<<finished<<"}\n";
reset();C.profitRatchetEnabled=true;C.ratchetTriggerPct=180;C.ratchetLockPct=100;C.ratchetStepPct=100;C.ratchetLockStepPct=100;mfe=200;profit=150;Manage();C.ratchetLockPct=20;profit=50;Manage();std::cout<<"{\"test\":\"ratchet_config_loosen\",\"remainingPositions\":"<<positions<<",\"profitBelowPreviouslyEarnedFloor\":50}\n";
}
'''
Path('work/ea-diagnostics.cpp').write_text(pre+globals+stubs+'Snap Observe()'+functions+main)
