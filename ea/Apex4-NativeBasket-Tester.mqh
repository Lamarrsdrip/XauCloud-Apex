// Native XauCloud v6.29.1 derivative; included only in the generated TESTER EA.
// All original XauCloud trade/network APIs remain fenced by the observer adapter.
// This is an explicitly high-risk historical experiment, not a live-money release.
#include <Trade/Trade.mqh>
input long InpApexBasketMagic = 90410001;
input int InpApexOrderGapMilliseconds = 250;
input bool InpApexNativePullbackEnabled = true;
input bool InpApexReplayStrongOutlook = false;
// Tester broker clock minus UTC, explicitly provided for the historical period.
input int InpApexReplayBrokerUtcOffsetMinutes = 0;
input int InpApexReplayEntryFreshSeconds = 25;
#property tester_file "Apex4StrongOutlook.csv"
int apexReplayFile=INVALID_HANDLE;
long apexReplayAt=0,apexReplayExpires=0,apexReplayLastAt=0;
int apexReplaySide=0;
double apexReplayEntry=0;
string apexReplayId="";
bool apexReplayReady=false;

CTrade apexNativeTrade;
int apexBasketSide=0;
double apexBasketAnchor=0,apexBasketTarget=0,apexBasketVolume=0;
long apexBasketLastAttempt=-1;
datetime apexBasketLastSignal=0;
bool apexBasketClosing=false,apexBasketFilled=false,apexBasketUncertain=false;
int apexBasketOrders=0;

bool ApexBasketTesterOnly(){return (bool)MQLInfoInteger(MQL_TESTER);}
double ApexBasketClip(const double equity)
{
   if(equity>=1000)return .50;
   if(equity>=500)return .20;
   if(equity>=200)return .10;
   if(equity>=100)return .05;
   if(equity>=50)return .02;
   if(equity>=20)return .01;
   return 0;
}
bool ApexBasketOwned()
{
   return PositionGetInteger(POSITION_MAGIC)==InpApexBasketMagic && PositionGetString(POSITION_SYMBOL)==_Symbol;
}
int ApexBasketPositions()
{
   int n=0;
   for(int i=PositionsTotal()-1;i>=0;i--)
      if(PositionGetTicket(i)>0&&ApexBasketOwned())n++;
   return n;
}
bool ApexBasketHasPending()
{
   for(int i=OrdersTotal()-1;i>=0;i--)
      if(OrderGetTicket(i)>0&&OrderGetInteger(ORDER_MAGIC)==InpApexBasketMagic&&OrderGetString(ORDER_SYMBOL)==_Symbol)return true;
   return false;
}
bool ApexBasketOtherExposure()
{
   for(int i=PositionsTotal()-1;i>=0;i--)
      if(PositionGetTicket(i)>0&&PositionGetString(POSITION_SYMBOL)==_Symbol&&!ApexBasketOwned())return true;
   return false;
}
void ApexBasketReset()
{
   apexBasketSide=0;apexBasketAnchor=0;apexBasketTarget=0;apexBasketVolume=0;
   apexBasketLastAttempt=-1;apexBasketClosing=false;apexBasketFilled=false;apexBasketUncertain=false;apexBasketOrders=0;
}
bool ApexBasketReadReplay()
{
   apexReplayReady=false;
   if(apexReplayFile==INVALID_HANDLE||FileIsEnding(apexReplayFile))return false;
   string at=FileReadString(apexReplayFile);
   string until=FileReadString(apexReplayFile);
   string id=FileReadString(apexReplayFile);
   string side=FileReadString(apexReplayFile);
   string price=FileReadString(apexReplayFile);
   string grade=FileReadString(apexReplayFile);
   string hour=FileReadString(apexReplayFile);
   if(!FileIsLineEnding(apexReplayFile)&&!FileIsEnding(apexReplayFile))return false;
   long t=StringToInteger(at),expires=StringToInteger(until);
   int watHour=(int)StringToInteger(hour);
   MqlDateTime utc;
   TimeToStruct((datetime)(t+3600),utc);
   double entry=StringToDouble(price);
   if(t<=apexReplayLastAt||expires<=t||id==""||grade!="STRONG"||
      (side!="BUY"&&side!="SELL")||entry<=5||utc.hour!=watHour)return false;
   apexReplayLastAt=t;apexReplayAt=t;apexReplayExpires=expires;
   apexReplayId=id;apexReplaySide=side=="BUY"?1:-1;apexReplayEntry=entry;
   apexReplayReady=true;return true;
}
bool ApexBasketInit()
{
   if(!ApexBasketTesterOnly()||InpApexBasketMagic<=0||InpApexOrderGapMilliseconds<1||
      AccountInfoInteger(ACCOUNT_MARGIN_MODE)!=ACCOUNT_MARGIN_MODE_RETAIL_HEDGING||
      AccountInfoString(ACCOUNT_CURRENCY)!="USD")return false;
   if(ApexBasketPositions()>0||ApexBasketHasPending())return false;
   if(InpApexReplayStrongOutlook)
   {
      if(InpApexReplayBrokerUtcOffsetMinutes<-840||InpApexReplayBrokerUtcOffsetMinutes>840||
         InpApexReplayEntryFreshSeconds<1||InpApexReplayEntryFreshSeconds>60)return false;
      apexReplayFile=FileOpen("Apex4StrongOutlook.csv",FILE_READ|FILE_CSV|FILE_ANSI,',');
      if(apexReplayFile==INVALID_HANDLE)return false;
      if(!ApexBasketReadReplay()){FileClose(apexReplayFile);apexReplayFile=INVALID_HANDLE;return false;}
   }
   apexNativeTrade.SetExpertMagicNumber((ulong)InpApexBasketMagic);
   apexNativeTrade.SetAsyncMode(false);
   apexNativeTrade.SetTypeFillingBySymbol(_Symbol);
   apexNativeTrade.SetDeviationInPoints(10);
   Print("APEX_NATIVE_TESTER | XauCloud v6.29.1 | no SL | fixed $5 basket target | broker margin only");
   return true;
}
void ApexBasketClose()
{
   apexBasketClosing=true;
   for(int i=PositionsTotal()-1;i>=0;i--)
   {
      ulong ticket=PositionGetTicket(i);
      if(ticket==0||!ApexBasketOwned())continue;
      if(!apexNativeTrade.PositionClose(ticket)||apexNativeTrade.ResultRetcode()!=TRADE_RETCODE_DONE)
         Print("APEX_NATIVE_CLOSE_PENDING ",ticket," ret=",apexNativeTrade.ResultRetcode());
   }
   if(ApexBasketPositions()==0&&!ApexBasketHasPending())
   {
      Print("APEX_NATIVE_BASKET_END target=",apexBasketTarget," orders=",apexBasketOrders);
      ApexBasketReset();
   }
}
void ApexBasketManage()
{
   if(!ApexBasketTesterOnly()||apexBasketSide==0)return;
   MqlTick q;
   if(!SymbolInfoTick(_Symbol,q)||q.bid<=0||q.ask<q.bid)return;
   if(apexBasketFilled&&ApexBasketPositions()==0&&!ApexBasketHasPending())
   {
      Print("APEX_NATIVE_BASKET_END positions gone (broker exit or stop-out) orders=",apexBasketOrders);
      ApexBasketReset();return;
   }
   if(apexBasketClosing||apexBasketSide*((apexBasketSide>0?q.bid:q.ask)-apexBasketTarget)>=0)
   {ApexBasketClose();return;}
   if(apexBasketUncertain||ApexBasketHasPending()||ApexBasketOtherExposure())return;
   if(apexBasketLastAttempt>=0&&q.time_msc-apexBasketLastAttempt<InpApexOrderGapMilliseconds)return;
   apexBasketLastAttempt=q.time_msc;
   double price=apexBasketSide>0?q.ask:q.bid;
   if(apexBasketSide*(apexBasketTarget-price)<=0)return;
   ENUM_ORDER_TYPE type=apexBasketSide>0?ORDER_TYPE_BUY:ORDER_TYPE_SELL;
   double margin=0;
   if(!OrderCalcMargin(type,_Symbol,apexBasketVolume,price,margin)||margin>AccountInfoDouble(ACCOUNT_MARGIN_FREE))return;
   // No SL, broker TP, arbitrary holding deadline, or software layer/risk cap.
   // The basket owns its fixed exit. Broker restrictions and stop-out still apply.
   bool sent=apexNativeTrade.PositionOpen(_Symbol,type,apexBasketVolume,price,0.0,0.0,"APEX_NATIVE_BASKET");
   uint ret=apexNativeTrade.ResultRetcode();
   if(sent&&(ret==TRADE_RETCODE_DONE||ret==TRADE_RETCODE_DONE_PARTIAL)&&apexNativeTrade.ResultDeal()>0)
   {
      apexBasketFilled=true;apexBasketOrders++;
      Print("APEX_NATIVE_FILL #",apexBasketOrders," vol=",apexNativeTrade.ResultVolume()," price=",apexNativeTrade.ResultPrice()," target=",apexBasketTarget);
      return;
   }
   if(ret==TRADE_RETCODE_NO_MONEY||ret==TRADE_RETCODE_REQUOTE||ret==TRADE_RETCODE_PRICE_CHANGED||
      ret==TRADE_RETCODE_PRICE_OFF||ret==TRADE_RETCODE_MARKET_CLOSED||ret==TRADE_RETCODE_TOO_MANY_REQUESTS)return;
   Print("APEX_NATIVE_ORDER_REJECT_OR_UNCERTAIN ret=",ret);
   // Avoid duplicate exposure after an ambiguous broker result.
   apexBasketUncertain=true;
}
bool ApexBasketStart(const int dir,const double anchor,const string source)
{
   if(!ApexBasketTesterOnly()||apexBasketSide!=0||ApexBasketPositions()>0||
      ApexBasketHasPending()||ApexBasketOtherExposure()||(dir!=1&&dir!=-1)||anchor<=5)return false;
   MqlTick q;if(!SymbolInfoTick(_Symbol,q)||q.bid<=0||q.ask<q.bid)return false;
   double step=SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_STEP);
   double vol=ApexBasketClip(AccountInfoDouble(ACCOUNT_EQUITY));
   if(step<=0||vol<=0)return false;
   vol=NormalizeDouble(MathFloor((vol+1e-9)/step)*step,8);
   if(vol<SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_MIN)||vol>SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_MAX))return false;
   if(dir*((dir>0?q.ask:q.bid)-(anchor+dir*5.0))>=0)return false;
   apexBasketSide=dir;apexBasketAnchor=anchor;apexBasketTarget=anchor+dir*5.0;apexBasketVolume=vol;
   Print("APEX_NATIVE_PLAN ",source," dir=",dir," anchor=",apexBasketAnchor," target=",apexBasketTarget," clip=",vol);
   ApexBasketManage();
   if(!apexBasketFilled&&!apexBasketUncertain&&!ApexBasketHasPending()&&ApexBasketPositions()==0)
   {
      Print("APEX_NATIVE_INITIAL_ENTRY_NOT_FILLED");
      ApexBasketReset();return false;
   }
   return true;
}
void ApexBasketReplayTick()
{
   if(!ApexBasketTesterOnly()||!InpApexReplayStrongOutlook)return;
   MqlTick q;if(!SymbolInfoTick(_Symbol,q)||q.time<=0)return;
   long utc=(long)q.time-InpApexReplayBrokerUtcOffsetMinutes*60;
   while(apexReplayReady&&apexReplayAt<=utc)
   {
      if(utc<apexReplayExpires&&utc-apexReplayAt<=InpApexReplayEntryFreshSeconds)
         ApexBasketStart(apexReplaySide,apexReplayEntry,"CANONICAL_STRONG_OUTLOOK:"+apexReplayId);
      if(!ApexBasketReadReplay())break;
   }
}
// A closed-bar classroom observation, not a fitted profit probability.
// Uses Codex's published impulse/depth/recovery lesson definitions and the
// native XauCloud directional classifier. No research stop/TP2 rule is imported.
bool ApexClassroomObserve(const int dir,const bool continuation,const double quote,string &stage,double &depth,double &recovery)
{
   MqlRates five[],one[];
   ArraySetAsSeries(five,false);ArraySetAsSeries(one,false);
   int n5=CopyRates(_Symbol,PERIOD_M5,1,16,five),n1=CopyRates(_Symbol,PERIOD_M1,1,90,one);
   if(n5<15||n1<60||quote<=0)return false;
   double atr=0;
   for(int i=n5-14;i<n5;i++)
      atr+=MathMax(five[i].high-five[i].low,MathMax(MathAbs(five[i].high-five[i-1].close),MathAbs(five[i].low-five[i-1].close)));
   atr/=14.0;
   if(atr<=0||n5<15)return false;
   // Continuation studies the native direction's preceding impulse.
   // Countertrend studies the opposite impulse and the recovery away from it.
   int impulseDir=continuation?dir:-dir,peak=3,start=0;
   for(int i=4;i<n5;i++)
      if(impulseDir*(impulseDir>0?five[i].high-five[peak].high:five[i].low-five[peak].low)>=0)peak=i;
   for(int i=1;i<peak;i++)
      if(impulseDir*(impulseDir>0?five[i].low-five[start].low:five[i].high-five[start].high)<=0)start=i;
   double peakPrice=impulseDir>0?five[peak].high:five[peak].low;
   double startPrice=impulseDir>0?five[start].low:five[start].high;
   double impulse=impulseDir*(peakPrice-startPrice);
   if(impulse<1.25*atr||TimeCurrent()-five[start].time>90*60)return false;
   int peak1=-1;
   for(int i=0;i<n1;i++)
      if(one[i].time>=five[peak].time&&one[i].time<five[peak].time+300&&
         MathAbs((impulseDir>0?one[i].high:one[i].low)-peakPrice)<=_Point*.5)peak1=i;
   if(peak1<0||peak1>=n1-1)return false;
   double extreme=impulseDir>0?one[peak1+1].low:one[peak1+1].high;
   for(int i=peak1+2;i<n1;i++)extreme=impulseDir>0?MathMin(extreme,one[i].low):MathMax(extreme,one[i].high);
   depth=impulseDir*(peakPrice-extreme)/impulse;
   if(depth<.12||depth>=1.0)return false;
   recovery=impulseDir*(quote-extreme)/(impulse*depth);
   bool reclaim=dir>0?g_m10Snapshot.bullishReclaim:g_m10Snapshot.bearishReclaim;
   bool displacement=dir>0?g_m10Snapshot.bullishDisplacement:g_m10Snapshot.bearishDisplacement;
   bool pressure=dir>0?g_m10Snapshot.buyPressure>g_m10Snapshot.sellPressure:g_m10Snapshot.sellPressure>g_m10Snapshot.buyPressure;
   stage=reclaim?"STRUCTURE_RECLAIM":(displacement&&pressure?"MOMENTUM_RECOVERY":"NATIVE_CANDIDATE");
   // The classroom found that late continuation often had insufficient room.
   // Never use future candles or its former variable TP/SL to authorize entry.
   if(continuation&&recovery>=.85){stage="LATE";return false;}
   return true;
}
void ApexBasketConsiderNative()
{
   if(!ApexBasketTesterOnly()||!InpApexNativePullbackEnabled||apexBasketSide!=0||
      ApexBasketPositions()>0||ApexBasketHasPending()||ApexBasketOtherExposure())return;
   if(!g_m10Snapshot.complete||g_m10Snapshot.freshnessState!="FRESH"||
      g_m10Snapshot.closedBarTime!=iTime(_Symbol,PERIOD_M10,1)||
      g_m10Decision.closedBarTime!=g_m10Snapshot.closedBarTime||
      g_m10Decision.closedBarTime<=apexBasketLastSignal)return;
   int dir=g_m10Decision.preferredDirection;
   if((dir!=1&&dir!=-1)||g_m10Decision.retracementRequired)return;
   if((dir==1&&g_m10Decision.decisionType!=M10_DECISION_BUY_CANDIDATE)||
      (dir==-1&&g_m10Decision.decisionType!=M10_DECISION_SELL_CANDIDATE))return;
   double atr[1];
   if(hATR==INVALID_HANDLE||CopyBuffer(hATR,0,1,1,atr)!=1||atr[0]<=0||ArraySize(bufEMAFast)<2||ArraySize(bufEMASlow)<2)return;
   XAU_SetupClassification c;
   XAU_ClassifySetup(dir,atr[0],"",c);
   bool continuation=c.type==XAU_TIMING_TREND_CONTINUATION;
   bool correction=c.type==XAU_TIMING_PULLBACK_SCALP||c.type==XAU_TIMING_REVERSAL_RECLAIM;
   if(!continuation&&!correction)return;
   MqlTick q;if(!SymbolInfoTick(_Symbol,q)||q.bid<=0||q.ask<q.bid)return;
   double entry=dir>0?q.ask:q.bid,depth=0,recovery=0;
   string stage="";
   if(!ApexClassroomObserve(dir,continuation,entry,stage,depth,recovery))return;
   apexBasketLastSignal=g_m10Decision.closedBarTime;
   Print("APEX_CLASSROOM_EVIDENCE stage=",stage," depth=",depth," recovery=",recovery," native=",c.why);
   ApexBasketStart(dir,entry,"NATIVE_XAUCLOUD_PULLBACK:"+stage);
}
