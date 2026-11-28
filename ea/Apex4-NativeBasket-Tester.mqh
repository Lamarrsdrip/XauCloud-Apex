// Native XauCloud v6.29.1 derivative; included only in the generated TESTER EA.
// All original XauCloud trade/network APIs remain fenced by the observer adapter.
// This is an explicitly high-risk historical experiment, not a live-money release.
#include <Trade/Trade.mqh>
input long InpApexBasketMagic = 90410001;
input int InpApexOrderGapMilliseconds = 250;
input bool InpApexNativePullbackEnabled = true;
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
bool ApexBasketInit()
{
   if(!ApexBasketTesterOnly()||InpApexBasketMagic<=0||InpApexOrderGapMilliseconds<1||
      AccountInfoInteger(ACCOUNT_MARGIN_MODE)!=ACCOUNT_MARGIN_MODE_RETAIL_HEDGING||
      AccountInfoString(ACCOUNT_CURRENCY)!="USD")return false;
   if(ApexBasketPositions()>0||ApexBasketHasPending())return false;
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
   // Preserve native direction and classification. Classroom lesson categories
   // are recorded as observations; their old SL/TP2 qualification is not
   // a trading authority for this different basket experiment.
   bool reclaim=dir>0?g_m10Snapshot.bullishReclaim:g_m10Snapshot.bearishReclaim;
   string stage=reclaim?"STRUCTURE_RECLAIM":(correction?"PULLBACK_RECOVERY":"TREND_CONTINUATION");
   MqlTick q;if(!SymbolInfoTick(_Symbol,q)||q.bid<=0||q.ask<q.bid)return;
   double step=SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_STEP);
   double vol=ApexBasketClip(AccountInfoDouble(ACCOUNT_EQUITY));
   if(step<=0||vol<=0)return;
   vol=NormalizeDouble(MathFloor((vol+1e-9)/step)*step,8);
   if(vol<SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_MIN)||vol>SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_MAX))return;
   apexBasketLastSignal=g_m10Decision.closedBarTime;
   apexBasketSide=dir;apexBasketAnchor=dir>0?q.ask:q.bid;
   apexBasketTarget=apexBasketAnchor+dir*5.0;apexBasketVolume=vol;
   Print("APEX_NATIVE_PLAN ",stage," dir=",dir," anchor=",apexBasketAnchor," target=",apexBasketTarget," clip=",vol," native=",c.why);
   ApexBasketManage();
}
