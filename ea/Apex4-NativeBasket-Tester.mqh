// Native XauCloud v6.29.1 derivative; included only in the generated TESTER EA.
// All original XauCloud trade/network APIs remain fenced by the observer adapter.
// This is an explicitly high-risk historical experiment, not a live-money release.
#include <Trade/Trade.mqh>
input long InpApexBasketMagic = 90410001;
input int InpApexOrderGapMilliseconds = 100;
enum ENUM_APEX_STRATEGY { APEX_PULLBACK_ONLY=0, APEX_OUTLOOK_ONLY=1, APEX_OUTLOOK_AND_PULLBACK=2 };
input ENUM_APEX_STRATEGY InpApexStrategy = APEX_PULLBACK_ONLY;
input bool InpApexNativePullbackEnabled = true;
ENUM_APEX_STRATEGY apexStrategy=APEX_PULLBACK_ONLY;
string apexEntryDiagnostic="Waiting for closed market evidence";
string apexEntrySource="";
int apexBuyScore=0,apexSellScore=0;
string ApexStrategyName(){return apexStrategy==APEX_OUTLOOK_ONLY?"OUTLOOK":apexStrategy==APEX_OUTLOOK_AND_PULLBACK?"BOTH":"PULLBACK";}
bool ApexPullbacksOn(){return InpApexNativePullbackEnabled&&apexStrategy!=APEX_OUTLOOK_ONLY;}
bool ApexOutlookOn(){return apexStrategy!=APEX_PULLBACK_ONLY;}
bool ApexApplyStrategy(const string mode){
 if(mode=="PULLBACK")apexStrategy=APEX_PULLBACK_ONLY;
 else if(mode=="OUTLOOK")apexStrategy=APEX_OUTLOOK_ONLY;
 else if(mode=="BOTH")apexStrategy=APEX_OUTLOOK_AND_PULLBACK;
 else return false;
 return true;
}
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
   apexBasketSide=0;apexBasketAnchor=0;apexBasketTarget=0;apexBasketVolume=0;apexEntrySource="";
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
   apexStrategy=InpApexStrategy;
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
   if(ApexBasketTesterOnly()&&ApexOutlookOn()&&!InpApexReplayStrongOutlook){Print("APEX_OUTLOOK_REPLAY_REQUIRED");return false;}
   if(InpApexReplayStrongOutlook&&ApexBasketTesterOnly()&&ApexOutlookOn())
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
   apexBasketSide=dir;apexBasketAnchor=anchor;apexBasketTarget=anchor+dir*5.0;apexBasketVolume=vol;apexEntrySource=source;
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
   string payload=StringFormat("{\"license\":\"%s\",\"account\":\"%I64d\",\"environment\":\"DEMO\",\"terminalArmed\":%s,\"basketActive\":%s,\"side\":%d,\"anchor\":%.8f,\"target\":%.8f,\"positions\":%d,\"orders\":%d,\"preferredVolume\":%.8f,\"lastFillVolume\":%.8f,\"freeMargin\":%.8f,\"equity\":%.8f,\"orderGapMs\":%d}",
      InpApexNativeLicense,AccountInfoInteger(ACCOUNT_LOGIN),apexDemoArmed?"true":"false",apexBasketSide!=0?"true":"false",apexBasketSide,
      apexBasketAnchor,apexBasketTarget,ApexBasketPositions(),apexBasketOrders,apexBasketVolume,apexBasketLastFillVolume,
      AccountInfoDouble(ACCOUNT_MARGIN_FREE),AccountInfoDouble(ACCOUNT_EQUITY),InpApexOrderGapMilliseconds);
   payload=StringSubstr(payload,0,StringLen(payload)-1)+StringFormat(",\"strategy\":\"%s\",\"entrySource\":\"%s\",\"buyScore\":%d,\"sellScore\":%d,\"diagnostic\":\"%s\"}",ApexStrategyName(),BotMonitorJsonSafe(apexEntrySource,100),apexBuyScore,apexSellScore,BotMonitorJsonSafe(apexEntryDiagnostic,200));
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
   int n=StringSplit(line,'|',parts);
   if(n==3&&parts[0]=="NONE"&&parts[1]=="ARMED_NO_PLAN"&&ApexApplyStrategy(parts[2])){apexDemoArmed=true;return;}
   if(n==3&&parts[0]=="NONE"&&parts[1]=="NOT_ARMED"){ApexApplyStrategy(parts[2]);apexDemoArmed=false;return;}
   if(n!=8||parts[0]!="NATIVE"||(parts[2]!="BUY"&&parts[2]!="SELL")||!ApexApplyStrategy(parts[7]))return;
   int side=parts[2]=="BUY"?1:-1;
   double anchor=StringToDouble(parts[3]),target=StringToDouble(parts[4]);
   long at=StringToInteger(parts[5]),expires=StringToInteger(parts[6]);
   if(anchor<=5||MathAbs(target-anchor-side*5.0)>0.000001||at>utc||utc>=expires||utc-at>60)return;
   apexDemoArmed=true;
   if(!InpApexNativeLiveOutlook||!ApexOutlookOn()||at<=apexLastOutlookAt)return;
   apexLastOutlookAt=at;
   if(!ApexBasketSave()){apexDemoArmed=false;return;}
   ApexBasketStart(side,anchor,"CANONICAL_STRONG_OUTLOOK:"+parts[1]);
}
void ApexBasketReplayTick()
{
   if(!ApexBasketTesterOnly()||!InpApexReplayStrongOutlook||!ApexOutlookOn())return;
   MqlTick q;if(!SymbolInfoTick(_Symbol,q)||q.time<=0)return;
   long utc=(long)q.time-InpApexReplayBrokerUtcOffsetMinutes*60;
   while(apexReplayReady&&apexReplayAt<=utc)
   {
      if(utc<apexReplayExpires&&utc-apexReplayAt<=InpApexReplayEntryFreshSeconds)
         ApexBasketStart(apexReplaySide,apexReplayEntry,"CANONICAL_STRONG_OUTLOOK:"+apexReplayId);
      if(!ApexBasketReadReplay())break;
   }
}
// Closed-candle feature definitions from vendored XauCloud analyzeFrame and
// Codex's recognizePullback classroom. No outcome/forward prices enter here.
struct ApexClassroomFrame
{
   double atr,pressure,acceleration,high,low,momentum,extension,rsi,emaFast,emaSlow,close;
   int trend;
   bool hasHigh,hasLow,sweptHigh,sweptLow,upperRejection,lowerRejection,brokeUp,brokeDown;
};
bool ApexClassroomFeatures(MqlRates &bars[],ApexClassroomFrame &f)
{
   ZeroMemory(f);
   int n=ArraySize(bars);
   if(n<30)return false;
   double atr=0,ef=bars[0].close,es=ef,prevHigh=0,prevLow=0;
   int lastHi=-1,lastLo=-1,priorHi=-1,priorLo=-1;
   for(int i=n-14;i<n;i++)
      atr+=MathMax(bars[i].high-bars[i].low,MathMax(MathAbs(bars[i].high-bars[i-1].close),MathAbs(bars[i].low-bars[i-1].close)));
   atr/=14.0;if(atr<=0)return false;
   f.atr=NormalizeDouble(atr,2);if(f.atr<=0)return false;
   for(int i=1;i<n;i++){ef=bars[i].close*.2+ef*.8;es=bars[i].close*(2.0/22.0)+es*(20.0/22.0);}
   for(int i=2;i<n-2;i++)
   {
      bool hi=true,lo=true;
      for(int j=-2;j<=2;j++)if(j!=0){if(bars[i+j].high>=bars[i].high)hi=false;if(bars[i+j].low<=bars[i].low)lo=false;}
      if(hi){priorHi=lastHi;prevHigh=f.high;lastHi=i;f.high=bars[i].high;f.hasHigh=true;}
      if(lo){priorLo=lastLo;prevLow=f.low;lastLo=i;f.low=bars[i].low;f.hasLow=true;}
   }
   if(ef>es&&(priorHi<0||f.high>=prevHigh)&&(priorLo<0||f.low>=prevLow))f.trend=1;
   else if(ef<es&&(priorHi<0||f.high<=prevHigh)&&(priorLo<0||f.low<=prevLow))f.trend=-1;
   double pressure=0;
   for(int i=n-6;i<n;i++)
   {
      double range=bars[i].high-bars[i].low;
      if(range>0)pressure+=((2*bars[i].close-bars[i].low-bars[i].high)/range+(bars[i].close-bars[i].open)/range)/2.0;
   }
   f.pressure=NormalizeDouble(pressure/6.0,2);
   f.close=bars[n-1].close;f.emaFast=ef;f.emaSlow=es;f.momentum=(f.close-bars[n-4].close)/atr;f.extension=(f.close-es)/atr;
   double gain=0,loss=0;
   for(int i=1;i<n;i++){double d=bars[i].close-bars[i-1].close;if(i<=14){gain+=MathMax(d,0)/14.0;loss+=MathMax(-d,0)/14.0;}else{gain=(gain*13+MathMax(d,0))/14.0;loss=(loss*13+MathMax(-d,0))/14.0;}}
   f.rsi=loss==0?100:100-100/(1+gain/loss);
   f.acceleration=NormalizeDouble(((bars[n-1].close-bars[n-4].close)-(bars[n-4].close-bars[n-7].close))/atr,2);
   double body=MathAbs(bars[n-1].close-bars[n-1].open);
   f.upperRejection=bars[n-1].high-MathMax(bars[n-1].open,bars[n-1].close)>=MathMax(2*body,.5*atr);
   f.lowerRejection=MathMin(bars[n-1].open,bars[n-1].close)-bars[n-1].low>=MathMax(2*body,.5*atr);
   for(int i=n-3;i<n;i++)
   {
      if(lastHi>=0&&lastHi<n-3&&bars[i].high>f.high&&bars[n-1].close<f.high)f.sweptHigh=true;
      if(lastLo>=0&&lastLo<n-3&&bars[i].low<f.low&&bars[n-1].close>f.low)f.sweptLow=true;
   }
   f.brokeUp=f.hasHigh&&bars[n-1].close>f.high;f.brokeDown=f.hasLow&&bars[n-1].close<f.low;
   return true;
}
bool ApexClassroomObserve(const int dir,const bool continuation,const double quote,string &stage,double &depth,double &recovery,datetime &episode)
{
   MqlRates five[],one[],m15[];
   ArraySetAsSeries(five,false);ArraySetAsSeries(one,false);ArraySetAsSeries(m15,false);
   int n5=CopyRates(_Symbol,PERIOD_M5,1,120,five),n1=CopyRates(_Symbol,PERIOD_M1,1,120,one);
   if(n5<30||n1<60||quote<=0||CopyRates(_Symbol,PERIOD_M15,1,120,m15)<30)return false;
   ApexClassroomFrame f1,f5,f15;
   if(!ApexClassroomFeatures(one,f1)||!ApexClassroomFeatures(five,f5)||!ApexClassroomFeatures(m15,f15))return false;
   int parent=f15.trend!=0?f15.trend:f5.trend;
   if(continuation&&parent!=0&&parent!=dir)return false;
   int impulseDir=continuation?dir:-dir;
   // Match the classroom's last 16 completed M5 bars and last 90 M1 bars.
   int base=n5-16,peak=base+3,start=base;
   for(int i=base+4;i<n5;i++)
      if(impulseDir*(impulseDir>0?five[i].high-five[peak].high:five[i].low-five[peak].low)>=0)peak=i;
   for(int i=base+1;i<peak;i++)
      if(impulseDir*(impulseDir>0?five[i].low-five[start].low:five[i].high-five[start].high)<=0)start=i;
   double peakPrice=impulseDir>0?five[peak].high:five[peak].low;
   double startPrice=impulseDir>0?five[start].low:five[start].high;
   double impulse=impulseDir*(peakPrice-startPrice);
   if(impulse<1.25*f5.atr||TimeCurrent()-five[start].time>90*60)return false;
   int peak1=-1;
   for(int i=(int)MathMax(0,n1-90);i<n1;i++)
      if(one[i].time>=five[peak].time&&one[i].time<five[peak].time+300&&
         MathAbs((impulseDir>0?one[i].high:one[i].low)-peakPrice)<=_Point*.5)peak1=i;
   if(peak1<0||peak1>=n1-1)return false;
   episode=one[peak1].time;
   double extreme=impulseDir>0?one[peak1+1].low:one[peak1+1].high;
   for(int i=peak1+2;i<n1;i++)extreme=impulseDir>0?MathMin(extreme,one[i].low):MathMax(extreme,one[i].high);
   depth=impulseDir*(peakPrice-extreme)/impulse;
   if(depth<.12)return false;
   bool broken=depth>=1.0||(continuation&&((dir>0&&f15.hasLow&&extreme<=f15.low)||(dir<0&&f15.hasHigh&&extreme>=f15.high)));
   if(broken){stage="STRUCTURE_BROKEN";return false;}
   recovery=continuation?dir*(quote-extreme)/(impulse*depth):dir*(quote-peakPrice)/impulse;
   if(recovery>=.85){stage="LATE";return false;}
   bool sweep=dir>0?f1.sweptLow:f1.sweptHigh;
   bool rejection=dir>0?f1.lowerRejection:f1.upperRejection;
   bool reclaim=dir>0?f1.brokeUp:f1.brokeDown;
   bool recoveryPressure=dir*f1.pressure>.1&&dir*f1.acceleration>0;
   stage=sweep&&recoveryPressure?"SWEEP_RECOVERY":reclaim?"STRUCTURE_RECLAIM":
      rejection?"REJECTION":recoveryPressure?"MOMENTUM_RECOVERY":"DEVELOPING";
   // Use the actionable classroom stages, never its old variable exit plan.
   // Native M10 direction and classifier are required independently.
   return stage!="DEVELOPING"&&recovery>=0;
}
// Evaluate both directions on exactly the same closed history. Native
// classification is evidence, not an unconditional permission to enter.
// Scores are evidence weights, not win probabilities. This is a challenger
// to be tested with actual basket outcomes, not a fitted profitable model.
struct ApexPullbackCandidate
{
 int side,score;datetime episode;string stage,reason;
 double depth,recovery,room;
 bool valid;
};
void ApexScorePullback(const int dir,const MqlTick &q,ApexClassroomFrame &m1,ApexClassroomFrame &m5,ApexClassroomFrame &m15,ApexClassroomFrame &h1,
                       const double atr,ApexPullbackCandidate &p)
{
 p.side=dir;p.score=0;p.valid=false;p.episode=0;p.depth=0;p.recovery=0;p.room=0;p.stage="";p.reason="";
 XAU_SetupClassification c;
 XAU_ClassifySetup(dir,atr,"",c);
 bool continuation=c.type==XAU_TIMING_TREND_CONTINUATION;
 bool correction=c.type==XAU_TIMING_PULLBACK_SCALP||c.type==XAU_TIMING_REVERSAL_RECLAIM;
 if(!continuation&&!correction){p.reason="native exhaustion/late chase";return;}
 double px=dir>0?q.ask:q.bid;
 if(!ApexClassroomObserve(dir,continuation,px,p.stage,p.depth,p.recovery,p.episode)){p.reason="classroom: "+p.stage;return;}
 bool sweep=dir>0?m1.sweptLow:m1.sweptHigh;
 bool rejection=dir>0?m1.lowerRejection:m1.upperRejection;
 bool reclaim=dir>0?m1.brokeUp:m1.brokeDown;
 bool pressure=dir*m1.pressure>.1,acceleration=dir*m1.acceleration>0;
 bool momentum=dir*m1.momentum>.15;
 bool higher=h1.trend==dir,mid=m15.trend==dir,local=m5.trend==dir;
 bool nativeAgrees=g_m10Decision.preferredDirection==dir;
 bool oppositeImpulse=dir*m5.momentum<-.3&&dir*m5.pressure<-.15;
 if(!pressure||(!momentum&&!acceleration)){p.reason="no current directional follow-through";return;}
 if(dir*m1.extension>2.5||((dir>0?m1.rsi>80:m1.rsi<20)&&!reclaim)){p.reason="late extended entry";return;}
 if(continuation)
 {
   if(!mid&&!higher){p.reason="continuation lacks higher-frame trend";return;}
   if(oppositeImpulse&&!reclaim&&!sweep){p.reason="correction still accelerating against entry";return;}
   if(!c.immediateConfirm&&!reclaim&&!(sweep&&acceleration)){p.reason="native continuation not yet reclaimed";return;}
 }
 else
 {
   // Original classifier allows immediate countertrend only with 5/6
   // exhaustion evidence and reclaim. A 4/6 pattern is not an immediate call.
   if(!c.immediateConfirm||c.reversalHits<5||!c.reclaimSeen){p.reason="marginal native countertrend";return;}
   if(!reclaim&&!(sweep&&rejection)){p.reason="countertrend lacks fresh M1 structure";return;}
 }
 // Measure actual available room relative to the fixed $5 basket target.
 // An opposing level already broken on M1 is not treated as remaining resistance.
 double level=dir>0?m5.high:m5.low;
 bool has=dir>0?m5.hasHigh:m5.hasLow;
 p.room=has?dir*(level-px):0;
 if(has&&p.room>0&&p.room<5.0&&!(dir>0?m5.brokeUp:m5.brokeDown)&&!reclaim){p.reason="near opposing structure before basket target";return;}
 // Same documented XauCloud evidence weights, plus native/classroom context.
 p.score=(higher?2:0)+(mid?1:0)+(local?1:0)+(momentum?1:0)+(pressure?1:0)+(acceleration?1:0)
        +(sweep?2:0)+(rejection?1:0)+(reclaim?2:0)+(nativeAgrees?1:0)+(c.immediateConfirm?1:0)+(correction?2:0);
 p.valid=p.score>=6;
 p.reason=StringFormat("%s %s score=%d native=%d/6 depth=%.3f recovery=%.3f room=%.2f H1=%d M15=%d M5=%d M1pressure=%.2f",
   continuation?"CONTINUATION":"COUNTERTREND",p.stage,p.score,c.reversalHits,p.depth,p.recovery,p.room,h1.trend,m15.trend,m5.trend,m1.pressure);
}
void ApexBasketConsiderNative()
{
 if(!ApexBasketCanStart()||!ApexPullbacksOn()||apexBasketSide!=0||ApexBasketPositions()>0||ApexBasketHasPending()||ApexBasketOtherExposure())return;
 if(!g_m10Snapshot.complete||g_m10Snapshot.freshnessState!="FRESH"||g_m10Snapshot.closedBarTime!=iTime(_Symbol,PERIOD_M10,1)||
    g_m10Decision.closedBarTime!=g_m10Snapshot.closedBarTime||g_m10Decision.closedBarTime<=0)return;
 MqlTick q;if(!SymbolInfoTick(_Symbol,q)||q.bid<=0||q.ask<q.bid)return;
 static long lastAssessment=-1;static datetime lastClosed=0;
 datetime closed=iTime(_Symbol,PERIOD_M1,1);
 if(lastAssessment>=0&&q.time_msc-lastAssessment<250&&closed==lastClosed)return;
 lastAssessment=q.time_msc;lastClosed=closed;
 double atr[1];
 if(hATR==INVALID_HANDLE||CopyBuffer(hATR,0,1,1,atr)!=1||atr[0]<=0||ArraySize(bufEMAFast)<2||ArraySize(bufEMASlow)<2)return;
 MqlRates one[],five[],fifteen[],hour[];
 ArraySetAsSeries(one,false);ArraySetAsSeries(five,false);ArraySetAsSeries(fifteen,false);ArraySetAsSeries(hour,false);
 if(CopyRates(_Symbol,PERIOD_M1,1,120,one)<60||CopyRates(_Symbol,PERIOD_M5,1,120,five)<30||
    CopyRates(_Symbol,PERIOD_M15,1,120,fifteen)<30||CopyRates(_Symbol,PERIOD_H1,1,120,hour)<30)return;
 ApexClassroomFrame m1,m5,m15,h1;
 if(!ApexClassroomFeatures(one,m1)||!ApexClassroomFeatures(five,m5)||!ApexClassroomFeatures(fifteen,m15)||!ApexClassroomFeatures(hour,h1))return;
 ApexPullbackCandidate buy,sell,chosen;
 ApexScorePullback(1,q,m1,m5,m15,h1,atr[0],buy);
 ApexScorePullback(-1,q,m1,m5,m15,h1,atr[0],sell);
 apexBuyScore=buy.score;apexSellScore=sell.score;
 apexEntryDiagnostic="BUY "+buy.reason+" | SELL "+sell.reason;
 if(buy.valid&&sell.valid&&MathAbs(buy.score-sell.score)<2){apexEntryDiagnostic="Conflicting pullbacks | "+apexEntryDiagnostic;return;}
 if(buy.valid&&(!sell.valid||buy.score>sell.score))chosen=buy;
 else if(sell.valid)chosen=sell;
 else return;
 if(chosen.episode<=apexBasketLastSignal)return;
 apexBasketLastSignal=chosen.episode;
 double entry=chosen.side>0?q.ask:q.bid;
 Print("APEX_ENTRY_EVIDENCE ",apexEntryDiagnostic," chosen=",chosen.side," entry=",entry," episode=",chosen.episode);
 ApexBasketStart(chosen.side,entry,"NATIVE_XAUCLOUD_PULLBACK:"+chosen.stage);
}
void ApexNativeDisplay()
{
 Comment("APEX 4 | ",ApexStrategyName(),"\n",apexBasketSide==0?"Scanning Gold":apexBasketSide>0?"BUY basket":"SELL basket",
   "\nPositions: ",ApexBasketPositions()," | target: ",DoubleToString(apexBasketTarget,_Digits),
   "\nBuy evidence: ",apexBuyScore," | Sell evidence: ",apexSellScore,"\n",apexEntryDiagnostic);
}
