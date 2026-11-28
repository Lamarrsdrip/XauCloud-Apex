#property strict
#property version "4.000"
#property description "Apex 4 independent DEMO candidate: broker M1 to Apex backend, no provider execution"
#include <Trade/Trade.mqh>
input string ApexLicense="";
input bool EnableDemoExecution=false;
input bool EnablePullback=true;
input bool DemoMarginStress=false; // explicitly opt in, demo only; never a production setting
input int MaximumDemoLayers=0;    // zero = no software layer cap, DEMO only
input double BasketRiskPercent=10.0;
input double MaxSpreadUSD=0.35;
input int EntryWindowSeconds=25;
input int OrderGapMs=250;
input long Magic=90400001;
input bool AllowLoopbackStaging=false; // local disposable demo backend only
input string ApexBackendURL="https://apex.xaucloud.io/api/apex/v4/market";
CTrade trade;
struct Plan { string id; int side; double ref,sl,tp1,tp2; datetime published,entryUntil,tradeUntil; string kind; };
Plan active;
bool running=false,addAllowed=false,placedUncertain=false,needHistory=true,marginPaused=false;
double pausedFree=0;
int sent=0;
double initialEquity=0;
ulong lastPoll=0,lastOrder=0;
datetime armedUntil=0;
string lockKey="",stateKey="";
ulong lastClose=0;
double clip(double equity) {
 if(equity>=1000)return .50;
 if(equity>=500)return .20;
 if(equity>=200)return .10;
 if(equity>=100)return .05;
 if(equity>=50)return .02;
 return equity>=20?.01:0;
}
bool DemoOK() {
 return AccountInfoInteger(ACCOUNT_TRADE_MODE)==ACCOUNT_TRADE_MODE_DEMO &&
        AccountInfoInteger(ACCOUNT_MARGIN_MODE)==ACCOUNT_MARGIN_MODE_RETAIL_HEDGING &&
        AccountInfoString(ACCOUNT_CURRENCY)=="USD";
}
bool LicenseOK(){
 if(StringFind(ApexLicense,"APEX-")!=0 || StringLen(ApexLicense)>80)return false;
 for(int i=0;i<StringLen(ApexLicense);i++){ushort c=StringGetCharacter(ApexLicense,i);
 if(!((c>=48&&c<=57)||(c>=65&&c<=90)||(c>=97&&c<=122)||c==45))return false;}
 return true;
}
bool EndpointOK(){
 if(StringFind(ApexBackendURL,"https://")==0)return true;
 string prefix="http://127.0.0.1:";
 if(!AllowLoopbackStaging||StringFind(ApexBackendURL,prefix)!=0)return false;
 int start=StringLen(prefix),end=StringFind(ApexBackendURL,"/",start);
 if(end<=start||StringSubstr(ApexBackendURL,end)!="/api/apex/v4/market")return false;
 string port=StringSubstr(ApexBackendURL,start,end-start);
 if(StringLen(port)>5||StringToInteger(port)<1||StringToInteger(port)>65535)return false;
 for(int i=0;i<StringLen(port);i++){
   ushort c=StringGetCharacter(port,i);
   if(c<48||c>57)return false;
 }
 return true;
}
bool Owned() {return PositionGetString(POSITION_SYMBOL)==_Symbol && PositionGetInteger(POSITION_MAGIC)==Magic;}
int PositionsOwned(){
 int n=0;
 for(int i=PositionsTotal()-1;i>=0;i--){if(PositionGetTicket(i)>0&&Owned())n++;}
 return n;
}
bool OtherExposure(){
 for(int i=PositionsTotal()-1;i>=0;i--){if(PositionGetTicket(i)>0&&PositionGetString(POSITION_SYMBOL)==_Symbol&&!Owned())return true;}
 return false;
}
bool HasOrder(){
 for(int i=OrdersTotal()-1;i>=0;i--){if(OrderGetTicket(i)>0&&OrderGetString(ORDER_SYMBOL)==_Symbol&&OrderGetInteger(ORDER_MAGIC)==Magic)return true;}
 return false;
}
string TerminalScope(){
 string text=AccountInfoString(ACCOUNT_SERVER)+"|"+_Symbol+"|"+IntegerToString(Magic)+"|"+ApexLicense;
 uint hash=2166136261;
 for(int i=0;i<StringLen(text);i++)hash=(hash^(uint)StringGetCharacter(text,i))*16777619;
 return "AX4."+IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN))+"."+IntegerToString(hash);
}
string EscapeJson(string value){
 StringReplace(value,"\\","\\\\");
 StringReplace(value,"\"","\\\"");
 StringReplace(value,"\r","\\r");
 StringReplace(value,"\n","\\n");
 return value;
}
bool PlanIdOK(string id){
 if(StringLen(id)!=24)return false;
 for(int i=0;i<24;i++){
   ushort c=StringGetCharacter(id,i);
   if(!((c>=48&&c<=57)||(c>=97&&c<=102)))return false;
 }
 return true;
}
bool SaveCampaign(){
 string file=stateKey+".campaign",draft=file+".tmp";
 int h=FileOpen(draft,FILE_WRITE|FILE_CSV|FILE_ANSI,'|');
 if(h==INVALID_HANDLE)return false;
 uint bytes=FileWrite(h,active.id,active.side,active.ref,active.sl,active.tp1,active.tp2,
                      (long)active.published,(long)active.entryUntil,(long)active.tradeUntil,active.kind,initialEquity);
 FileFlush(h);FileClose(h);
 return bytes>0&&FileMove(draft,0,file,FILE_REWRITE);
}
bool RecoverCampaign(){
 int h=FileOpen(stateKey+".campaign",FILE_READ|FILE_CSV|FILE_ANSI,'|');
 if(h==INVALID_HANDLE)return false;
 Plan p;
 p.id=FileReadString(h);p.side=(int)FileReadNumber(h);p.ref=FileReadNumber(h);
 p.sl=FileReadNumber(h);p.tp1=FileReadNumber(h);p.tp2=FileReadNumber(h);
 p.published=(datetime)FileReadNumber(h);p.entryUntil=(datetime)FileReadNumber(h);
 p.tradeUntil=(datetime)FileReadNumber(h);p.kind=FileReadString(h);initialEquity=FileReadNumber(h);
 FileClose(h);
 if(!PlanIdOK(p.id)||(p.side!=1&&p.side!=-1)||p.ref<=0||p.sl<=0||p.tp2<=0||
    p.published<=0||p.tradeUntil<=p.published||p.side*(p.ref-p.sl)<=0||p.side*(p.tp2-p.tp1)<=0)return false;
 int n=0;
 for(int i=PositionsTotal()-1;i>=0;i--){
   if(PositionGetTicket(i)==0||!Owned())continue;
   bool buy=PositionGetInteger(POSITION_TYPE)==POSITION_TYPE_BUY;
   if(buy!=(p.side==1)||StringFind(PositionGetString(POSITION_COMMENT),"AX4 "+p.id)!=0||
      MathAbs(PositionGetDouble(POSITION_SL)-p.sl)>SymbolInfoDouble(_Symbol,SYMBOL_TRADE_TICK_SIZE)||
      MathAbs(PositionGetDouble(POSITION_TP)-p.tp2)>SymbolInfoDouble(_Symbol,SYMBOL_TRADE_TICK_SIZE))return false;
   n++;
 }
 if(n<1)return false;
 active=p;running=true;addAllowed=false;sent=n;
 GlobalVariableDel(stateKey+".unconfirmed");GlobalVariablesFlush();
 Print("APEX4 DEMO BASKET_RECOVERED ",p.id," positions=",n);
 return true;
}
bool DurableEvent(string id,string json){
 string file=stateKey+".event."+id+".json";
 if(FileIsExist(file))return true;
 string draft=file+".tmp";
 int h=FileOpen(draft,FILE_WRITE|FILE_TXT|FILE_ANSI);
 if(h==INVALID_HANDLE)return false;
 uint bytes=FileWriteString(h,json);
 FileFlush(h);FileClose(h);
 return bytes>0&&FileMove(draft,0,file,FILE_REWRITE);
}
string EventBatch(string &files[]){
 string name, payload="[";
 long f=FileFindFirst(stateKey+".event.*.json",name);
 if(f==INVALID_HANDLE)return "[]";
 do{
   int h=FileOpen(name,FILE_READ|FILE_TXT|FILE_ANSI);
   if(h==INVALID_HANDLE)continue;
   string line=FileReadString(h);FileClose(h);
   if(line==""||StringLen(line)>4096)continue;
   int n=ArraySize(files);ArrayResize(files,n+1);files[n]=name;
   if(n>0)payload+=",";
   payload+=line;
 }while(ArraySize(files)<24&&FileFindNext(f,name));
 FileFindClose(f);
 return payload+"]";
}
string PlanFromComment(string comment){
 if(StringFind(comment,"AX4 ")!=0)return "";
 string id=StringSubstr(comment,4,24);
 return PlanIdOK(id)?id:"";
}
string DealReason(long reason){
 switch((ENUM_DEAL_REASON)reason){
   case DEAL_REASON_SL:return "SL";
   case DEAL_REASON_TP:return "TP";
   case DEAL_REASON_SO:return "STOP_OUT";
   case DEAL_REASON_EXPERT:return "EXPERT";
   case DEAL_REASON_CLIENT:
   case DEAL_REASON_MOBILE:
   case DEAL_REASON_WEB:return "MANUAL";
   default:return "OTHER";
 }
}
bool RecordDeal(ulong deal){
 if(!HistoryDealSelect(deal))return false;
 if(HistoryDealGetString(deal,DEAL_SYMBOL)!=_Symbol)return true;
 long entry=HistoryDealGetInteger(deal,DEAL_ENTRY),type=HistoryDealGetInteger(deal,DEAL_TYPE);
 if((entry!=DEAL_ENTRY_IN&&entry!=DEAL_ENTRY_OUT&&entry!=DEAL_ENTRY_OUT_BY)||(type!=DEAL_TYPE_BUY&&type!=DEAL_TYPE_SELL))return true;
 ulong positionId=(ulong)HistoryDealGetInteger(deal,DEAL_POSITION_ID);
 if(positionId==0)return true;
 string id=PlanFromComment(HistoryDealGetString(deal,DEAL_COMMENT));
 long magic=HistoryDealGetInteger(deal,DEAL_MAGIC);
 long ms=HistoryDealGetInteger(deal,DEAL_TIME_MSC)-BrokerOffsetSeconds()*1000;
 double price=HistoryDealGetDouble(deal,DEAL_PRICE),volume=HistoryDealGetDouble(deal,DEAL_VOLUME);
 double commission=HistoryDealGetDouble(deal,DEAL_COMMISSION),swap=HistoryDealGetDouble(deal,DEAL_SWAP);
 double profit=HistoryDealGetDouble(deal,DEAL_PROFIT),fee=HistoryDealGetDouble(deal,DEAL_FEE);
 string reason=DealReason(HistoryDealGetInteger(deal,DEAL_REASON));
 if(entry==DEAL_ENTRY_IN){
   if(magic!=Magic||id=="")return true;
 }else{
   // Broker SL/TP and manual closes need not preserve the opening magic/comment.
   if(!HistorySelectByPosition(positionId))return false;
   id="";
   for(int i=0;i<HistoryDealsTotal();i++){
     ulong open=HistoryDealGetTicket(i);
     if(open>0&&HistoryDealGetInteger(open,DEAL_ENTRY)==DEAL_ENTRY_IN&&HistoryDealGetInteger(open,DEAL_MAGIC)==Magic){
       id=PlanFromComment(HistoryDealGetString(open,DEAL_COMMENT));
       if(id!="")break;
     }
   }
   if(id=="")return true;
 }
 string json=StringFormat("{\"kind\":\"DEAL\",\"dealId\":\"%I64u\",\"positionId\":\"%I64u\",\"planId\":\"%s\",\"atMs\":%I64d,\"entry\":\"%s\",\"direction\":\"%s\",\"price\":%.8f,\"volume\":%.8f,\"commission\":%.8f,\"swap\":%.8f,\"profit\":%.8f,\"fee\":%.8f,\"reason\":\"%s\"}",
   deal,positionId,id,ms,entry==DEAL_ENTRY_IN?"IN":"OUT",type==DEAL_TYPE_BUY?"BUY":"SELL",price,volume,commission,swap,profit,fee,reason);
 return DurableEvent("D"+IntegerToString((long)deal),json);
}
void ReconcileDealHistory(){
 static ulong last=0;
 ulong now=GetTickCount64();if(last>0&&now-last<60000)return;
 datetime to=TimeTradeServer();if(to<=0)return;
 last=now;
 string cursor=stateKey+".dealCursor";
 datetime from=(datetime)GlobalVariableGet(cursor);
 if(from<=0)from=to-86400;
 if(from>to)from=to-60;
 if(!HistorySelect(from,to))return;
 ulong tickets[];int count=HistoryDealsTotal();ArrayResize(tickets,count);
 for(int i=0;i<count;i++)tickets[i]=HistoryDealGetTicket(i);
 bool ok=true;
 for(int i=0;i<count;i++)if(tickets[i]>0&&!RecordDeal(tickets[i]))ok=false;
 if(ok){GlobalVariableSet(cursor,(double)to);GlobalVariablesFlush();}
}
void OnTradeTransaction(const MqlTradeTransaction &trans,const MqlTradeRequest &request,const MqlTradeResult &result){
 if(DemoOK()&&stateKey!=""&&trans.type==TRADE_TRANSACTION_DEAL_ADD&&trans.deal>0&&!RecordDeal(trans.deal))
   Print("APEX4 DEMO broker deal awaiting history reconciliation ",trans.deal);
}
string ClaimKey(string id){return stateKey+"."+id;}
bool Claim(string id){
 string key=ClaimKey(id);
 if(StringLen(key)>63||GlobalVariableCheck(key))return false;
 if(GlobalVariableSet(key,(double)TimeGMT())==0)return false;
 GlobalVariablesFlush();return true;
}
bool Valid(Plan &p,MqlTick &t,bool adding=false){
 if(p.side!=1&&p.side!=-1)return false;
 if(p.sl<=0||p.tp2<=0||p.ref<=0||p.tp1<=0||TimeGMT()>=(adding&&DemoMarginStress&&sent>0?p.tradeUntil:p.entryUntil)||t.ask<t.bid||t.bid<=0)return false;
 if(t.ask-t.bid>MaxSpreadUSD)return false;
 // Quote-side geometry, stop & target spacing, no chase after TP1.
 double entry=p.side==1?t.ask:t.bid;
 double exitQuote=p.side==1?t.bid:t.ask;
 double risk=MathAbs(p.ref-p.sl);
 if(risk<=0||(!(adding&&DemoMarginStress&&sent>0)&&MathAbs(entry-p.ref)>risk*.25))return false;
 double nextTarget=(adding&&DemoMarginStress&&sent>0)?p.tp2:p.tp1;
 return p.side*(exitQuote-p.sl)>0 && p.side*(nextTarget-entry)>0 &&
        p.side*(p.tp2-p.tp1)>0 && p.side*(p.ref-p.sl)>0;
}
void Start(Plan &p){
 if(!EnableDemoExecution||running||placedUncertain||PositionsOwned()>0||HasOrder()||OtherExposure()||TimeGMT()>=armedUntil)return;
 MqlTick t;if(!SymbolInfoTick(_Symbol,t)||!Valid(p,t)||!Claim(p.id))return;
 active=p;initialEquity=AccountInfoDouble(ACCOUNT_EQUITY);
 if(!SaveCampaign()){Print("APEX4 DEMO campaign state unavailable");return;}
 running=true;addAllowed=true;sent=0;marginPaused=false;
 Print("APEX4 DEMO PLAN ",p.id," side=",p.side," stop=",p.sl," TP2=",p.tp2);
}
void CloseBasket(){
 addAllowed=false;
 ulong now=GetTickCount64();if(lastClose>0&&now-lastClose<250)return;lastClose=now;
 for(int i=PositionsTotal()-1;i>=0;i--){
   ulong ticket=PositionGetTicket(i);
   if(ticket==0||!Owned())continue;
   if(!trade.PositionClose(ticket)||trade.ResultRetcode()!=TRADE_RETCODE_DONE)
      Print("APEX4 CLOSE pending/rejected ",ticket," ",trade.ResultRetcode());
 }
}
void Manage(){
 if(!EnableDemoExecution||!running||!DemoOK())return;
 MqlTick t;if(!SymbolInfoTick(_Symbol,t))return;
 double exitQuote=active.side==1?t.bid:t.ask;
 if((sent>0||TimeGMT()>=active.entryUntil)&&PositionsOwned()==0&&!HasOrder()){
   running=false;addAllowed=false;FileDelete(stateKey+".campaign");return;
 }
 if(TimeGMT()>=active.tradeUntil||active.side*(exitQuote-active.tp2)>=0||active.side*(exitQuote-active.sl)<=0){
   CloseBasket();if(PositionsOwned()==0&&!HasOrder()){running=false;addAllowed=false;FileDelete(stateKey+".campaign");}return;
 }
 if(TimeGMT()>=(DemoMarginStress&&sent>0?active.tradeUntil:active.entryUntil))addAllowed=false;
}
double BasketLoss(double sl){
 double total=0;
 for(int i=PositionsTotal()-1;i>=0;i--){
   if(PositionGetTicket(i)==0||!Owned())continue;
   double x=0;
   ENUM_ORDER_TYPE type=PositionGetInteger(POSITION_TYPE)==POSITION_TYPE_BUY?ORDER_TYPE_BUY:ORDER_TYPE_SELL;
   if(!OrderCalcProfit(type,_Symbol,PositionGetDouble(POSITION_VOLUME),PositionGetDouble(POSITION_PRICE_OPEN),sl,x))return DBL_MAX;
   total+=MathMax(0,-x);
 }
 return total;
}
void AddOne(){
 if(!DemoOK()||!EnableDemoExecution||!running||!addAllowed||placedUncertain||OtherExposure()||HasOrder()||TimeGMT()>=armedUntil)return;
 ulong now=GetTickCount64();if(now-lastOrder<(ulong)MathMax(100,OrderGapMs))return;
 if(MaximumDemoLayers>0&&sent>=MaximumDemoLayers){addAllowed=false;return;}
 MqlTick t;if(!SymbolInfoTick(_Symbol,t)||!Valid(active,t,true))return;
 if(!TerminalInfoInteger(TERMINAL_TRADE_ALLOWED)||!MQLInfoInteger(MQL_TRADE_ALLOWED)){addAllowed=false;return;}
 double eq=AccountInfoDouble(ACCOUNT_EQUITY),free=AccountInfoDouble(ACCOUNT_MARGIN_FREE);
 if(marginPaused&&free<pausedFree+MathMax(.10,MathAbs(pausedFree)*.005))return;
 marginPaused=false;
 // Freeze the tier at campaign start; never increase the clip as equity fluctuates.
 double volume=clip(initialEquity),step=SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_STEP);
 if(step<=0||volume<=0){addAllowed=false;return;}
 volume=NormalizeDouble(MathFloor((volume+1e-9)/step)*step,8);
 if(volume<SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_MIN)||volume>SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_MAX)){addAllowed=false;return;}
 ENUM_ORDER_TYPE type=active.side==1?ORDER_TYPE_BUY:ORDER_TYPE_SELL;
 double entry=active.side==1?t.ask:t.bid, margin=0, loss=0,spreadLoss=0;
 if(!OrderCalcMargin(type,_Symbol,volume,entry,margin)||!OrderCalcProfit(type,_Symbol,volume,entry,active.sl,loss)||
    !OrderCalcProfit(type,_Symbol,volume,entry,active.side==1?t.bid:t.ask,spreadLoss)){addAllowed=false;return;}
 double cushion=MathMax(0.50,eq*.02);
 if(eq<=cushion||free<margin+MathMax(0,-spreadLoss)+cushion){marginPaused=true;pausedFree=free;return;}
 if(!DemoMarginStress && BasketLoss(active.sl)+MathMax(0,-loss)>initialEquity*BasketRiskPercent/100.0){addAllowed=false;return;}
 double tickSize=SymbolInfoDouble(_Symbol,SYMBOL_TRADE_TICK_SIZE);
 if(tickSize<=0){addAllowed=false;return;}
 double sl=NormalizeDouble(MathRound(active.sl/tickSize)*tickSize,_Digits);
 double tp=NormalizeDouble(MathRound(active.tp2/tickSize)*tickSize,_Digits);
 double minDist=SymbolInfoInteger(_Symbol,SYMBOL_TRADE_STOPS_LEVEL)*_Point;
 double exitQuote=active.side==1?t.bid:t.ask;
 if(active.side*(exitQuote-sl)<=minDist||active.side*(tp-exitQuote)<=minDist){addAllowed=false;return;}
 string fence=stateKey+".unconfirmed";
 if(GlobalVariableSet(fence,(double)TimeGMT())==0){addAllowed=false;return;}
 GlobalVariablesFlush();
 lastOrder=now;
 ulong latencyStart=GetMicrosecondCount();
 bool ok=trade.PositionOpen(_Symbol,type,volume,entry,sl,tp,"AX4 "+active.id);
 uint ret=trade.ResultRetcode();
 double latency=(GetMicrosecondCount()-latencyStart)/1000.0;
 long ms=t.time_msc-BrokerOffsetSeconds()*1000;
 string id="R"+IntegerToString(ms)+"-"+IntegerToString((long)now)+"-"+active.id;

 ulong resultDeal=trade.ResultDeal();
 string dealField=resultDeal>0?StringFormat(",\"dealId\":\"%I64u\"",resultDeal):"";
 string result=StringFormat("{\"kind\":\"ORDER_RESULT\",\"eventId\":\"%s\",\"planId\":\"%s\",\"atMs\":%I64d,\"retcode\":%u,\"requestedPrice\":%.8f,\"requestedVolume\":%.8f,\"filledVolume\":%.8f,\"filledPrice\":%.8f,\"latencyMs\":%.3f,\"spread\":%.8f,\"equity\":%.2f,\"marginFree\":%.2f%s}",
   id,active.id,ms,ret,entry,volume,trade.ResultVolume(),trade.ResultPrice(),latency,t.ask-t.bid,eq,free,dealField);
 if(!DurableEvent(id,result))Print("APEX4 DEMO order telemetry could not be persisted ",id);

 Print("APEX4 DEMO ORDER ",sent+1," ",volume," ret=",ret," deal=",trade.ResultDeal());
 if(ret==TRADE_RETCODE_NO_MONEY){
   GlobalVariableDel(fence);GlobalVariablesFlush();
   marginPaused=true;pausedFree=AccountInfoDouble(ACCOUNT_MARGIN_FREE);return;
 }
 if(ok&&(ret==TRADE_RETCODE_DONE||ret==TRADE_RETCODE_DONE_PARTIAL)&&trade.ResultVolume()>0&&trade.ResultDeal()>0){
   GlobalVariableDel(fence);GlobalVariablesFlush();sent++;return;
 }
 {
   addAllowed=false;
   // Explicit rejections finish this attempt. Accepted or indeterminate
   // outcomes block further entries until the broker state is reconciled.
   bool knownReject=ret==TRADE_RETCODE_REQUOTE||ret==TRADE_RETCODE_REJECT||ret==TRADE_RETCODE_CANCEL||
      ret==TRADE_RETCODE_INVALID||ret==TRADE_RETCODE_INVALID_VOLUME||ret==TRADE_RETCODE_INVALID_PRICE||
      ret==TRADE_RETCODE_INVALID_STOPS||ret==TRADE_RETCODE_TRADE_DISABLED||ret==TRADE_RETCODE_MARKET_CLOSED||
      ret==TRADE_RETCODE_PRICE_CHANGED||ret==TRADE_RETCODE_PRICE_OFF||ret==TRADE_RETCODE_INVALID_FILL||
      ret==TRADE_RETCODE_TOO_MANY_REQUESTS;
   placedUncertain=!knownReject;
   if(knownReject){GlobalVariableDel(fence);GlobalVariablesFlush();}
 }
}
long BrokerOffsetSeconds(){
 datetime server=TimeTradeServer();if(server<=0)return 0;
 return (long)MathRound((double)(server-TimeGMT())/60.0)*60;
}
string BarPayload(long offset,int count){
 MqlRates rates[];ArraySetAsSeries(rates,false);
 int got=CopyRates(_Symbol,PERIOD_M1,1,count,rates);
 if(got<1)return "[]";
 string rows="[";
 for(int i=0;i<got;i++){
   if(i)rows+=",";
   rows+="{\"t\":"+IntegerToString(((long)rates[i].time-offset)*1000)+",\"o\":"+DoubleToString(rates[i].open,_Digits)+",\"h\":"+DoubleToString(rates[i].high,_Digits)+",\"l\":"+DoubleToString(rates[i].low,_Digits)+",\"c\":"+DoubleToString(rates[i].close,_Digits)+"}";
 }
 return rows+"]";
}
bool Poll(){
 ulong now=GetTickCount64();
 // One snapshot per second while flat, less often while accumulating. No
 // network request per order. Server must measure actual latency in demo.
 ulong gap=running?3000:1000;
 if(now-lastPoll<gap)return false;lastPoll=now;
 MqlTick t;if(!SymbolInfoTick(_Symbol,t)||t.bid<=0||TimeTradeServer()<=0)return false;
 long offset=BrokerOffsetSeconds(),utcTick=t.time_msc-offset*1000;
 string files[];
 string events=EventBatch(files);
 string payload="{\"license\":\""+ApexLicense+"\",\"account\":\""+IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN))+"\",\"environment\":\"DEMO\",\"brokerServer\":\""+EscapeJson(AccountInfoString(ACCOUNT_SERVER))+"\",\"brokerSymbol\":\""+EscapeJson(_Symbol)+"\",\"quote\":{\"bid\":"+DoubleToString(t.bid,_Digits)+",\"ask\":"+DoubleToString(t.ask,_Digits)+",\"atMs\":"+IntegerToString(utcTick)+"},\"bars\":"+BarPayload(offset,needHistory?7500:6)+",\"events\":"+events+"}";
 char data[],result[];string headers;
 StringToCharArray(payload,data,0,WHOLE_ARRAY,CP_UTF8);ArrayResize(data,ArraySize(data)-1);
 int status=WebRequest("POST",ApexBackendURL,"Content-Type: application/json\r\n",800,data,result,headers);
 if(status!=200){armedUntil=0;return true;}
 StringToLower(headers);
 if(StringFind(headers,"x-apex-events: committed")>=0)
   for(int i=0;i<ArraySize(files);i++)FileDelete(files[i]);
 string line=CharArrayToString(result,0,-1,CP_UTF8),a[];
 int n=StringSplit(line,'|',a);
 if(n==2&&a[0]=="NONE"&&a[1]=="NEED_HISTORY"){needHistory=true;armedUntil=0;return true;}
 if(n==2&&a[0]=="NONE"&&a[1]=="ARMED_NO_PLAN"){needHistory=false;armedUntil=TimeGMT()+8;return true;}
 if((n!=10&&n!=11)||a[0]!="APEX4"||(a[2]!="BUY"&&a[2]!="SELL")||!PlanIdOK(a[1])||(a[9]!="OUTLOOK"&&a[9]!="PULLBACK")){armedUntil=0;return true;}
 int hold=a[9]=="OUTLOOK"?60:20;
 if(n==11){
   if(a[9]!="PULLBACK"||(a[10]!="10"&&a[10]!="20"&&a[10]!="30"&&a[10]!="45"&&a[10]!="60"&&a[10]!="120")){
     armedUntil=0;return true;
   }
   hold=(int)StringToInteger(a[10]);
 }
 needHistory=false;armedUntil=TimeGMT()+8;
 if(a[9]=="PULLBACK"&&!EnablePullback)return true;
 Plan p;p.id=a[1];p.kind=a[9];p.side=a[2]=="BUY"?1:-1;p.ref=StringToDouble(a[3]);p.sl=StringToDouble(a[4]);p.tp1=StringToDouble(a[5]);p.tp2=StringToDouble(a[6]);
 p.published=(datetime)StringToInteger(a[7]);p.entryUntil=(datetime)MathMin(StringToInteger(a[8]),(long)p.published+MathMin(90,EntryWindowSeconds));
 p.tradeUntil=p.published+hold*60;
 if(p.published>TimeGMT()+2||TimeGMT()>=p.entryUntil)return true;
 Start(p);return true;
}
int OnInit(){
 if(!DemoOK()||!LicenseOK()||StringFind(_Symbol,"XAUUSD")!=0||Magic<=0||
 BasketRiskPercent<=0||BasketRiskPercent>100||MaxSpreadUSD<=0||EntryWindowSeconds<1||MaximumDemoLayers<0||_Period!=PERIOD_M1||!EndpointOK()){
 Print("Apex4 candidate: DEMO USD hedging account and XAUUSD license required.");return INIT_FAILED;}
 stateKey=TerminalScope();
 // Prevent multiple EA instances in the same terminal. Stale locks require manual review.
 lockKey="AX4.LOCK."+IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN))+"."+IntegerToString(Magic);
 if(!GlobalVariableTemp(lockKey)){lockKey="";return INIT_FAILED;}
 if(!GlobalVariableSetOnCondition(lockKey,1,0)){lockKey="";return INIT_FAILED;}
 trade.SetExpertMagicNumber(Magic);trade.SetAsyncMode(false);trade.SetDeviationInPoints(10);trade.SetTypeFillingBySymbol(_Symbol);
 bool recovered=EnableDemoExecution&&PositionsOwned()>0&&!HasOrder()&&RecoverCampaign();
 placedUncertain=GlobalVariableCheck(stateKey+".unconfirmed");
 if(!recovered&&(PositionsOwned()>0||HasOrder())){
   placedUncertain=true;
   Print("APEX4 DEMO restart: broker protections retained; campaign ownership needs reconciliation.");
 }
 EventSetMillisecondTimer(100);return INIT_SUCCEEDED;
}
void OnDeinit(const int reason){EventKillTimer();if(lockKey!="")GlobalVariableSet(lockKey,0);}
void OnTick(){Manage();}
void OnTimer(){
 if(!DemoOK())return;
 ReconcileDealHistory();
 Manage();
 if(running&&addAllowed)AddOne();
 Poll();
 if(running&&addAllowed)AddOne();
}
