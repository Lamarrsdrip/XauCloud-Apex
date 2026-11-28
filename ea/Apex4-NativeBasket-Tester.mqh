// Native XauCloud v6.29.1 derivative; included only in the generated TESTER EA.
// All original XauCloud trade/network APIs remain fenced by the observer adapter.
// This is an explicitly high-risk historical experiment, not a live-money release.
#include <Trade/Trade.mqh>
input long InpApexBasketMagic = 90410001;
input int InpApexOrderGapMilliseconds = 100;
input bool InpApexNativePullbackEnabled = true;
// Native tester is always offline. The same executor may run on an explicitly
// opted-in USD hedging demo, never a real account in this candidate.
input bool InpApexNativeDemoExecution = false;
input string InpApexNativeLicense = "";
input bool InpApexNativeLiveOutlook = true;
bool apexDemoArmed=false,apexDemoLockHeld=false;
string apexDemoState="",apexDemoLock="";
long apexLastOutlookAt=0;
ulong apexLastPoll=0;
input bool InpApexReplayStrongOutlook = false;
// Tester broker clock minus UTC, explicitly provided for the historical period.
input int InpApexReplayBrokerUtcOffsetMinutes = 0;
input int InpApexReplayEntryFreshSeconds = 25;
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
double apexBasketLastFillVolume=0;
ulong apexBasketLastWallAttempt=0,apexBasketLastFillWall=0;
double apexBasketRetryCeiling=0;

bool ApexBasketTesterOnly(){return (bool)MQLInfoInteger(MQL_TESTER);}
bool ApexBasketAllowed()
{
   return ApexBasketTesterOnly()||(InpApexNativeDemoExecution&&AccountInfoInteger(ACCOUNT_TRADE_MODE)==ACCOUNT_TRADE_MODE_DEMO);
}
bool ApexBasketCanStart(){return ApexBasketAllowed()&&(ApexBasketTesterOnly()||apexDemoArmed);}
bool ApexBasketSave()
{
   if(ApexBasketTesterOnly())return true;
   string draft=apexDemoState+".tmp";
   int h=FileOpen(draft,FILE_WRITE|FILE_CSV|FILE_ANSI,'|');
   if(h==INVALID_HANDLE)return false;
   uint bytes=FileWrite(h,apexBasketSide,apexBasketAnchor,apexBasketTarget,apexBasketVolume,
      (long)apexBasketLastSignal,apexLastOutlookAt,apexBasketOrders,(int)apexBasketClosing);
   FileFlush(h);FileClose(h);
   return bytes>0&&FileMove(draft,0,apexDemoState,FILE_REWRITE);
}
bool ApexBasketLoad()
{
   int h=FileOpen(apexDemoState,FILE_READ|FILE_CSV|FILE_ANSI,'|');
   if(h==INVALID_HANDLE)return false;
   int side=(int)FileReadNumber(h);
   double anchor=FileReadNumber(h),target=FileReadNumber(h),volume=FileReadNumber(h);
   datetime lastSignal=(datetime)FileReadNumber(h);
   long lastOutlook=(long)FileReadNumber(h);
   int orders=(int)FileReadNumber(h);bool closing=FileReadNumber(h)!=0;
   FileClose(h);
   if(side!=0&&side!=1&&side!=-1)return false;
   if(side!=0&&(anchor<=5||volume<=0||MathAbs(target-anchor-side*5.0)>0.000001))return false;
   for(int i=PositionsTotal()-1;i>=0;i--)
      if(PositionGetTicket(i)>0&&ApexBasketOwned())
      {
         int positionSide=PositionGetInteger(POSITION_TYPE)==POSITION_TYPE_BUY?1:-1;
         if(side!=positionSide||StringFind(PositionGetString(POSITION_COMMENT),"APEX_NATIVE_BASKET")!=0)return false;
      }
   apexBasketLastSignal=lastSignal;apexLastOutlookAt=lastOutlook;
   if(ApexBasketPositions()>0||ApexBasketHasPending())
   {
      if(side==0)return false;
      apexBasketSide=side;apexBasketAnchor=anchor;apexBasketTarget=target;apexBasketVolume=volume;
      apexBasketOrders=orders;apexBasketClosing=closing;apexBasketFilled=ApexBasketPositions()>0;
      // Resume managing an identified basket, not sending fresh orders after an ambiguous restart.
      apexBasketUncertain=true;
   }
   return true;
}
void ApexBasketShutdown()
{
   if(apexReplayFile!=INVALID_HANDLE){FileClose(apexReplayFile);apexReplayFile=INVALID_HANDLE;}
   if(apexDemoLockHeld){ApexBasketSave();GlobalVariableSet(apexDemoLock,0);GlobalVariablesFlush();apexDemoLockHeld=false;}
}
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
   apexBasketLastAttempt=-1;apexBasketLastWallAttempt=0;apexBasketClosing=false;apexBasketFilled=false;apexBasketUncertain=false;apexBasketOrders=0;apexBasketLastFillVolume=0;apexBasketLastFillWall=0;apexBasketRetryCeiling=0;
   if(apexDemoLockHeld&&!ApexBasketSave())Print("APEX_NATIVE_STATE_SAVE_FAILED");
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
   if(!ApexBasketAllowed()||InpApexBasketMagic<=0||InpApexOrderGapMilliseconds<1||
      AccountInfoInteger(ACCOUNT_MARGIN_MODE)!=ACCOUNT_MARGIN_MODE_RETAIL_HEDGING||
      AccountInfoString(ACCOUNT_CURRENCY)!="USD")return false;
   if(ApexBasketTesterOnly()&&(ApexBasketPositions()>0||ApexBasketHasPending()))return false;
   if(!ApexBasketTesterOnly())
   {
      if(StringFind(InpApexNativeLicense,"APEX-")!=0||StringLen(InpApexNativeLicense)>80)return false;
      for(int i=0;i<StringLen(InpApexNativeLicense);i++)
      {
         ushort ch=StringGetCharacter(InpApexNativeLicense,i);
         if(!((ch>='A'&&ch<='Z')||(ch>='a'&&ch<='z')||(ch>='0'&&ch<='9')||ch=='-'))return false;
      }
      string scope=IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN))+"."+IntegerToString(InpApexBasketMagic);
      apexDemoState="ApexNativeBasket."+scope+".csv";apexDemoLock="AXN.LOCK."+scope;
      if(!GlobalVariableTemp(apexDemoLock)||!GlobalVariableSetOnCondition(apexDemoLock,1,0))return false;
      apexDemoLockHeld=true;
      if(FileIsExist(apexDemoState))
      {
         if(!ApexBasketLoad()){GlobalVariableSet(apexDemoLock,0);apexDemoLockHeld=false;return false;}
      }
      else if(ApexBasketPositions()>0||ApexBasketHasPending())
      {GlobalVariableSet(apexDemoLock,0);apexDemoLockHeld=false;return false;}
   }
   if(InpApexReplayStrongOutlook&&ApexBasketTesterOnly())
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
   Print("APEX_NATIVE ",ApexBasketTesterOnly()?"TESTER":"DEMO"," | XauCloud v6.29.1 | no SL | fixed $5 basket target | dynamic broker margin | pacing=",InpApexOrderGapMilliseconds,"ms");
   return true;
}
void ApexBasketClose()
{
   apexBasketClosing=true;
   if(apexDemoLockHeld&&!ApexBasketSave())Print("APEX_NATIVE_CLOSE_STATE_SAVE_FAILED");
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
// Descend through legal volume increments. Never wait for the preferred
// tier if the broker can accept a smaller volume. OrderCheck models actual
// account margin (including existing positions) rather than leverage guesses.
ENUM_ORDER_TYPE_FILLING ApexBasketFilling()
{
   long flags=SymbolInfoInteger(_Symbol,SYMBOL_FILLING_MODE);
   if((flags&SYMBOL_FILLING_FOK)!=0)return ORDER_FILLING_FOK;
   if((flags&SYMBOL_FILLING_IOC)!=0)return ORDER_FILLING_IOC;
   if(SymbolInfoInteger(_Symbol,SYMBOL_TRADE_EXEMODE)==SYMBOL_TRADE_EXECUTION_MARKET)return ORDER_FILLING_FOK;
   return ORDER_FILLING_RETURN;
}
double ApexBasketAffordableVolume(const ENUM_ORDER_TYPE type,const double price,const double ceiling)
{
   double step=SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_STEP);
   double minimum=SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_MIN);
   double maximum=SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_MAX);
   if(step<=0||minimum<=0||maximum<minimum||ceiling<minimum)return 0;
   long low=(long)MathCeil((minimum-1e-9)/step);
   long high=(long)MathFloor((MathMin(maximum,ceiling)+1e-9)/step);
   for(long units=high;units>=low;units--)
   {
      double vol=NormalizeDouble(units*step,8);
      MqlTradeRequest req={};MqlTradeCheckResult check={};
      req.action=TRADE_ACTION_DEAL;req.symbol=_Symbol;req.magic=(ulong)InpApexBasketMagic;
      req.type=type;req.volume=vol;req.price=price;req.deviation=10;req.type_filling=ApexBasketFilling();
      req.sl=0;req.tp=0;req.comment="APEX_NATIVE_BASKET";
      ResetLastError();
      bool checked=OrderCheck(req,check);
      if(checked&&(check.retcode==0||check.retcode==TRADE_RETCODE_DONE))
      {
         if(check.margin_free>=-1e-8)return vol;
         continue;
      }
      // Invalid volume/limit can be satisfied by a smaller order. All
      // unknown errors fail closed, rather than spinning on broker errors.
      if(check.retcode!=TRADE_RETCODE_NO_MONEY&&check.retcode!=TRADE_RETCODE_INVALID_VOLUME&&check.retcode!=TRADE_RETCODE_LIMIT_VOLUME)
      {
         Print("APEX_NATIVE_MARGIN_CHECK ret=",check.retcode," error=",GetLastError());return 0;
      }
   }
   return 0;
}
void ApexBasketManage()
{
   if(!ApexBasketAllowed()||apexBasketSide==0)return;
   MqlTick q;
   if(!SymbolInfoTick(_Symbol,q)||q.bid<=0||q.ask<q.bid)return;
   if(apexBasketFilled&&ApexBasketPositions()==0&&!ApexBasketHasPending())
   {
      Print("APEX_NATIVE_BASKET_END positions gone (broker exit or stop-out) orders=",apexBasketOrders);
      ApexBasketReset();return;
   }
   if(apexBasketClosing||apexBasketSide*((apexBasketSide>0?q.bid:q.ask)-apexBasketTarget)>=0)
   {ApexBasketClose();return;}
   if(!ApexBasketCanStart()||apexBasketUncertain||ApexBasketHasPending()||ApexBasketOtherExposure())return;
   ulong wall=GetTickCount64();
   if(ApexBasketTesterOnly())
   {
      if(apexBasketLastAttempt>=0&&q.time_msc-apexBasketLastAttempt<InpApexOrderGapMilliseconds)return;
   }
   else if(apexBasketLastWallAttempt>0&&wall-apexBasketLastWallAttempt<(ulong)InpApexOrderGapMilliseconds)return;
   apexBasketLastAttempt=q.time_msc;apexBasketLastWallAttempt=wall;
   double price=apexBasketSide>0?q.ask:q.bid;
   if(apexBasketSide*(apexBasketTarget-price)<=0)return;
   ENUM_ORDER_TYPE type=apexBasketSide>0?ORDER_TYPE_BUY:ORDER_TYPE_SELL;
   double ceiling=apexBasketRetryCeiling>0?MathMin(apexBasketVolume,apexBasketRetryCeiling):apexBasketVolume;
   double volume=ApexBasketAffordableVolume(type,price,ceiling);
   if(volume<=0){apexBasketRetryCeiling=0;return;}
   apexNativeTrade.SetTypeFilling(ApexBasketFilling());
   // No SL, broker TP, arbitrary holding deadline, or software layer/risk cap.
   // The basket owns its fixed exit. Broker restrictions and stop-out still apply.
   bool sent=apexNativeTrade.PositionOpen(_Symbol,type,volume,price,0.0,0.0,"APEX_NATIVE_BASKET");
   uint ret=apexNativeTrade.ResultRetcode();
   if(sent&&(ret==TRADE_RETCODE_DONE||ret==TRADE_RETCODE_DONE_PARTIAL)&&apexNativeTrade.ResultDeal()>0)
   {
      apexBasketFilled=true;apexBasketOrders++;apexBasketLastFillVolume=apexNativeTrade.ResultVolume();apexBasketLastFillWall=GetTickCount64();apexBasketRetryCeiling=0;
      if(!ApexBasketSave()){apexBasketUncertain=true;Print("APEX_NATIVE_FILL_STATE_SAVE_FAILED");}
      Print("APEX_NATIVE_FILL #",apexBasketOrders," vol=",apexNativeTrade.ResultVolume()," price=",apexNativeTrade.ResultPrice()," target=",apexBasketTarget);
      return;
   }
   if(ret==TRADE_RETCODE_NO_MONEY||ret==TRADE_RETCODE_INVALID_VOLUME||ret==TRADE_RETCODE_LIMIT_VOLUME)
   {
      double next=NormalizeDouble(volume-SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_STEP),8);
      apexBasketRetryCeiling=next>=SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_MIN)?next:0;
      return;
   }
   if(ret==TRADE_RETCODE_REQUOTE||ret==TRADE_RETCODE_PRICE_CHANGED||
      ret==TRADE_RETCODE_PRICE_OFF||ret==TRADE_RETCODE_MARKET_CLOSED||ret==TRADE_RETCODE_TOO_MANY_REQUESTS)return;
   Print("APEX_NATIVE_ORDER_REJECT_OR_UNCERTAIN ret=",ret);
   // Avoid duplicate exposure after an ambiguous broker result.
   apexBasketUncertain=true;
}
bool ApexBasketStart(const int dir,const double anchor,const string source)
{
   if(!ApexBasketCanStart()||apexBasketSide!=0||ApexBasketPositions()>0||
      ApexBasketHasPending()||ApexBasketOtherExposure()||(dir!=1&&dir!=-1)||anchor<=5)return false;
   MqlTick q;if(!SymbolInfoTick(_Symbol,q)||q.bid<=0||q.ask<q.bid)return false;
   double step=SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_STEP);
   double vol=ApexBasketClip(AccountInfoDouble(ACCOUNT_EQUITY));
   if(step<=0||vol<=0)return false;
   vol=NormalizeDouble(MathFloor((vol+1e-9)/step)*step,8);
   if(vol<SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_MIN)||vol>SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_MAX))return false;
   if(dir*((dir>0?q.ask:q.bid)-(anchor+dir*5.0))>=0)return false;
   apexBasketSide=dir;apexBasketAnchor=anchor;apexBasketTarget=anchor+dir*5.0;apexBasketVolume=vol;
   if(!ApexBasketSave()){ApexBasketReset();return false;}
   Print("APEX_NATIVE_PLAN ",source," dir=",dir," anchor=",apexBasketAnchor," target=",apexBasketTarget," preferred clip=",vol);
   ApexBasketManage();
   if(!apexBasketFilled&&!apexBasketUncertain&&!ApexBasketHasPending()&&ApexBasketPositions()==0)
   {
      Print("APEX_NATIVE_INITIAL_ENTRY_NOT_FILLED");
      ApexBasketReset();return false;
   }
   return true;
}
string ApexBasketBarsJson()
{
   static datetime last=0;
   static string cache="";
   datetime closed=iTime(_Symbol,PERIOD_M1,1);
   if(closed<=0)return "[]";
   if(last==closed&&cache!="")return cache;
   MqlRates bars[];
   ArraySetAsSeries(bars,false);
   int n=CopyRates(_Symbol,PERIOD_M1,1,7500,bars);
   if(n<450)return "[]";
   long offset=(long)MathRound((double)(TimeTradeServer()-TimeGMT())/60.0)*60;
   string json="[";
   for(int i=0;i<n;i++)
   {
      if(i>0)json+=",";
      json+=StringFormat("{\"t\":%I64d,\"o\":%.8f,\"h\":%.8f,\"l\":%.8f,\"c\":%.8f}",
         ((long)bars[i].time-offset)*1000,bars[i].open,bars[i].high,bars[i].low,bars[i].close);
   }
   cache=json+"]";last=closed;return cache;
}
void ApexBasketLiveOutlookTick()
{
   if(ApexBasketTesterOnly()||!ApexBasketAllowed())return;
   ulong now=GetTickCount64();
   // Synchronous HTTP must not interrupt the rapid fill loop. Once the
   // broker cannot fund another order, normal telemetry/polling resumes.
   if(apexBasketSide!=0&&apexBasketLastFillWall>0&&now-apexBasketLastFillWall<250)return;
   ulong interval=apexBasketSide!=0?5000:1000;
   if(apexLastPoll>0&&now-apexLastPoll<interval)return;
   apexLastPoll=now;
   string payload=StringFormat("{\"license\":\"%s\",\"account\":\"%I64d\",\"environment\":\"DEMO\",\"basketActive\":%s,\"side\":%d,\"anchor\":%.8f,\"target\":%.8f,\"positions\":%d,\"orders\":%d,\"preferredVolume\":%.8f,\"lastFillVolume\":%.8f,\"freeMargin\":%.8f,\"equity\":%.8f,\"orderGapMs\":%d}",
      InpApexNativeLicense,AccountInfoInteger(ACCOUNT_LOGIN),apexBasketSide!=0?"true":"false",apexBasketSide,
      apexBasketAnchor,apexBasketTarget,ApexBasketPositions(),apexBasketOrders,apexBasketVolume,apexBasketLastFillVolume,
      AccountInfoDouble(ACCOUNT_MARGIN_FREE),AccountInfoDouble(ACCOUNT_EQUITY),InpApexOrderGapMilliseconds);
   long utc=(long)TimeGMT();
   if(InpApexNativeLiveOutlook&&apexBasketSide==0&&utc%3600<60&&apexNativeEvidencePacket!="")
   {
      payload=StringSubstr(payload,0,StringLen(payload)-1)+",\"brokerServer\":\""+
        BotMonitorJsonSafe(AccountInfoString(ACCOUNT_SERVER),80)+"\",\"nativeEvidence\":"+apexNativeEvidencePacket+
        ",\"bars\":"+ApexBasketBarsJson()+"}";
   }
   char data[],result[];string headers;
   StringToCharArray(payload,data,0,WHOLE_ARRAY,CP_UTF8);ArrayResize(data,ArraySize(data)-1);
   int status=WebRequest("POST","https://apex.xaucloud.io/api/apex/v4/native-outlook","Content-Type: application/json\r\n",1000,data,result,headers);
   string line=CharArrayToString(result,0,-1,CP_UTF8),parts[];
   if(status==401||status==403||line=="NONE|NOT_ARMED"||line=="NONE|CANDIDATE_DISABLED"){apexDemoArmed=false;return;}
   // No new Outlook may originate during an outage. Native demo execution,
   // once armed this session, retains its local recognition and exit logic.
   if(status!=200)return;
   if(line=="NONE|ARMED_NO_PLAN"){apexDemoArmed=true;return;}
   int n=StringSplit(line,'|',parts);
   if(n!=7||parts[0]!="NATIVE"||(parts[2]!="BUY"&&parts[2]!="SELL"))return;
   int side=parts[2]=="BUY"?1:-1;
   double anchor=StringToDouble(parts[3]),target=StringToDouble(parts[4]);
   long at=StringToInteger(parts[5]),expires=StringToInteger(parts[6]);
   if(anchor<=5||MathAbs(target-anchor-side*5.0)>0.000001||at>utc||utc>=expires||utc-at>60)return;
   apexDemoArmed=true;
   if(!InpApexNativeLiveOutlook||at<=apexLastOutlookAt)return;
   apexLastOutlookAt=at;
   if(!ApexBasketSave()){apexDemoArmed=false;return;}
   ApexBasketStart(side,anchor,"CANONICAL_STRONG_OUTLOOK:"+parts[1]);
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
   if(!ApexBasketCanStart()||!InpApexNativePullbackEnabled||apexBasketSide!=0||
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
