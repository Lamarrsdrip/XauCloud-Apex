#property strict
#property version "4.000"
#property description "Apex 4 separate DEMO candidate: Outlook + local pullback, no external model execution"
#include <Trade/Trade.mqh>
input string ApexLicense="";
input bool EnableDemoExecution=false;
input bool EnablePullback=true;
input bool DemoMarginStress=false; // explicitly opt in, demo only; never a production setting
input int MaximumDemoLayers=40;    // bounded even in stress mode
input double BasketRiskPercent=10.0;
input double MaxSpreadUSD=0.35;
input int EntryWindowSeconds=25;
input int OrderGapMs=250;
input long Magic=90400001;
const string URL="https://xaucloud.io/api/cloud/apex/outlook-v4";
CTrade trade;
struct Plan { string id; int side; double ref,sl,tp1,tp2; datetime published,entryUntil; };
Plan active;
bool running=false,addAllowed=false,placedUncertain=false;
int sent=0;
double initialEquity=0;
ulong lastPoll=0,lastOrder=0;
datetime armedUntil=0,lastBar=0;
string lockKey="";
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
string ClaimKey(string id){return "AX4."+IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN))+"."+IntegerToString(Magic)+"."+id;}
bool Claim(string id){
 string key=ClaimKey(id);
 if(StringLen(key)>63||GlobalVariableCheck(key))return false;
 if(GlobalVariableSet(key,(double)TimeGMT())==0)return false;
 GlobalVariablesFlush();return true;
}
bool Valid(Plan &p,MqlTick &t){
 if(p.side!=1&&p.side!=-1)return false;
 if(p.sl<=0||p.tp2<=0||p.ref<=0||p.tp1<=0||TimeGMT()>=p.entryUntil||t.ask<t.bid||t.bid<=0)return false;
 if(t.ask-t.bid>MaxSpreadUSD)return false;
 // Quote-side geometry, stop & target spacing, no chase after TP1.
 double entry=p.side==1?t.ask:t.bid;
 double exitQuote=p.side==1?t.bid:t.ask;
 double risk=MathAbs(p.ref-p.sl);
 if(risk<=0||MathAbs(entry-p.ref)>risk*.25)return false;
 return p.side*(exitQuote-p.sl)>0 && p.side*(p.tp1-entry)>0 &&
        p.side*(p.tp2-p.tp1)>0 && p.side*(p.ref-p.sl)>0;
}
void Start(Plan &p){
 if(running||placedUncertain||PositionsOwned()>0||HasOrder()||OtherExposure()||TimeGMT()>=armedUntil)return;
 MqlTick t;if(!SymbolInfoTick(_Symbol,t)||!Valid(p,t)||!Claim(p.id))return;
 active=p;running=true;addAllowed=true;sent=0;initialEquity=AccountInfoDouble(ACCOUNT_EQUITY);
 Print("APEX4 DEMO PLAN ",p.id," side=",p.side," stop=",p.sl," TP2=",p.tp2);
}
void CloseBasket(){
 addAllowed=false;
 for(int i=PositionsTotal()-1;i>=0;i--){
   ulong ticket=PositionGetTicket(i);
   if(ticket==0||!Owned())continue;
   if(!trade.PositionClose(ticket)||trade.ResultRetcode()!=TRADE_RETCODE_DONE)
      Print("APEX4 CLOSE pending/rejected ",ticket," ",trade.ResultRetcode());
 }
}
void Manage(){
 if(!running)return;
 MqlTick t;if(!SymbolInfoTick(_Symbol,t))return;
 double exitQuote=active.side==1?t.bid:t.ask;
 if(active.side*(exitQuote-active.tp2)>=0||active.side*(exitQuote-active.sl)<=0){
   CloseBasket();return;
 }
 if(sent>0&&PositionsOwned()==0&&!HasOrder()){
   running=false;addAllowed=false;return;
 }
 if(TimeGMT()>=active.entryUntil||TimeGMT()>=armedUntil||!Valid(active,t))addAllowed=false;
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
 if(!DemoOK()||!EnableDemoExecution||!running||!addAllowed||placedUncertain||OtherExposure()||HasOrder())return;
 ulong now=GetTickCount64();if(now-lastOrder<(ulong)MathMax(100,OrderGapMs))return;
 if(sent>=MathMax(1,MathMin(200,MaximumDemoLayers))){addAllowed=false;return;}
 MqlTick t;if(!SymbolInfoTick(_Symbol,t)||!Valid(active,t)){addAllowed=false;return;}
 if(!TerminalInfoInteger(TERMINAL_TRADE_ALLOWED)||!MQLInfoInteger(MQL_TRADE_ALLOWED)){addAllowed=false;return;}
 double eq=AccountInfoDouble(ACCOUNT_EQUITY),free=AccountInfoDouble(ACCOUNT_MARGIN_FREE);
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
 if(eq<=cushion||free<margin+MathMax(0,-spreadLoss)+cushion){addAllowed=false;return;}
 if(!DemoMarginStress && BasketLoss(active.sl)+MathMax(0,-loss)>initialEquity*BasketRiskPercent/100.0){addAllowed=false;return;}
 double tickSize=SymbolInfoDouble(_Symbol,SYMBOL_TRADE_TICK_SIZE);
 if(tickSize<=0){addAllowed=false;return;}
 double sl=NormalizeDouble(MathRound(active.sl/tickSize)*tickSize,_Digits);
 double tp=NormalizeDouble(MathRound(active.tp2/tickSize)*tickSize,_Digits);
 double minDist=SymbolInfoInteger(_Symbol,SYMBOL_TRADE_STOPS_LEVEL)*_Point;
 double exitQuote=active.side==1?t.bid:t.ask;
 if(active.side*(exitQuote-sl)<=minDist||active.side*(tp-exitQuote)<=minDist){addAllowed=false;return;}
 lastOrder=now;sent++;
 bool ok=trade.PositionOpen(_Symbol,type,volume,entry,sl,tp,"AX4 "+StringSubstr(active.id,0,12));
 uint ret=trade.ResultRetcode();
 Print("APEX4 DEMO ORDER ",sent," ",volume," ret=",ret," deal=",trade.ResultDeal());
 if(!ok||(ret!=TRADE_RETCODE_DONE&&ret!=TRADE_RETCODE_DONE_PARTIAL)){
   // Do not retry an ambiguous broker acknowledgement. Inspect before any further entry.
   addAllowed=false;placedUncertain=true;
 }
}
bool Poll(){
 ulong now=GetTickCount64();MqlDateTime dt;TimeToStruct(TimeGMT(),dt);
 ulong gap=(dt.min<2)?1000:5000;
 if(now-lastPoll<gap)return false;lastPoll=now;
 string payload="{\"license\":\""+ApexLicense+"\",\"account\":\""+IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN))+"\"}";
 char data[],result[];string headers;
 StringToCharArray(payload,data,0,WHOLE_ARRAY,CP_UTF8);ArrayResize(data,ArraySize(data)-1);
 int status=WebRequest("POST",URL,"Content-Type: application/json\r\n",800,data,result,headers);
 if(status!=200){armedUntil=0;return true;}
 string line=CharArrayToString(result,0,-1,CP_UTF8),a[];
 int n=StringSplit(line,'|',a);
 if(n==2&&a[0]=="NONE"&&a[1]=="NO_FRESH_STRONG"){armedUntil=TimeGMT()+8;return true;}
 if(n!=9||a[0]!="APEX4"||(a[2]!="BUY"&&a[2]!="SELL")||StringLen(a[1])!=24){armedUntil=0;return true;}
 for(int i=0;i<24;i++){ushort c=StringGetCharacter(a[1],i);if(!((c>=48&&c<=57)||(c>=97&&c<=102))){armedUntil=0;return true;}}
 Plan p;p.id=a[1];p.side=a[2]=="BUY"?1:-1;p.ref=StringToDouble(a[3]);p.sl=StringToDouble(a[4]);p.tp1=StringToDouble(a[5]);p.tp2=StringToDouble(a[6]);
 p.published=(datetime)StringToInteger(a[7]);p.entryUntil=(datetime)MathMin(StringToInteger(a[8]),(long)p.published+MathMin(90,EntryWindowSeconds));
 if(p.published>TimeGMT()+2||TimeGMT()>=p.entryUntil){armedUntil=TimeGMT()+8;return true;}
 armedUntil=TimeGMT()+8;Start(p);return true;
}
// Candidate only, not a calibrated XauCloud model: detect a countertrend retracement
// after an impulse, using completed M1 candles, M5 direction, ATR and break of microstructure.
bool Pullback(Plan &p){
 MqlRates m[],h[];ArraySetAsSeries(m,true);ArraySetAsSeries(h,true);
 if(CopyRates(_Symbol,PERIOD_M1,1,16,m)!=16||CopyRates(_Symbol,PERIOD_M5,1,8,h)!=8)return false;
 if(m[0].time==lastBar)return false;lastBar=m[0].time;
 double atr=0;for(int i=0;i<14;i++)atr+=MathMax(m[i].high-m[i].low,MathMax(MathAbs(m[i].high-m[i+1].close),MathAbs(m[i].low-m[i+1].close)));
 atr/=14;if(atr<=0)return false;
 double impulse=m[3].close-m[9].close,trend=h[1].close-h[7].close;
 int side=0;
 if(impulse>=2*atr&&trend>0&&m[0].close<m[1].low&&m[1].high<m[2].high&&m[0].close>m[9].close+atr*.5)side=-1;
 if(impulse<=-2*atr&&trend<0&&m[0].close>m[1].high&&m[1].low>m[2].low&&m[0].close<m[9].close-atr*.5)side=1;
 if(!side)return false;
 MqlTick t;if(!SymbolInfoTick(_Symbol,t))return false;
 double entry=side==1?t.ask:t.bid;
 double sl=side==1?MathMin(m[1].low,m[2].low)-atr*.2:MathMax(m[1].high,m[2].high)+atr*.2;
 double tp2=entry+side*atr*1.1;
 // Don't trade if the retracement target would overshoot the original impulse origin.
 if(side==-1&&tp2<=m[9].close||side==1&&tp2>=m[9].close)return false;
 p.id="P"+IntegerToString((long)m[0].time);p.side=side;p.ref=entry;p.sl=sl;p.tp1=entry+side*atr*.55;p.tp2=tp2;p.published=TimeGMT();p.entryUntil=TimeGMT()+MathMin(15,EntryWindowSeconds);
 return true;
}
int OnInit(){
 if(!EnableDemoExecution||!DemoOK()||!LicenseOK()||StringFind(_Symbol,"XAUUSD")!=0||Magic<=0||
 BasketRiskPercent<=0||BasketRiskPercent>100||MaxSpreadUSD<=0||EntryWindowSeconds<1||MaximumDemoLayers<1){
 Print("Apex4 candidate: explicit DEMO USD hedging authorization and XAUUSD license required.");return INIT_FAILED;}
 // Prevent multiple EA instances in the same terminal. Stale locks require manual review.
 lockKey="AX4.LOCK."+IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN))+"."+IntegerToString(Magic);
 if(!GlobalVariableTemp(lockKey))return INIT_FAILED;
 if(!GlobalVariableSetOnCondition(lockKey,1,0)){lockKey="";return INIT_FAILED;}
 trade.SetExpertMagicNumber(Magic);trade.SetAsyncMode(false);trade.SetDeviationInPoints(10);trade.SetTypeFillingBySymbol(_Symbol);
 if(PositionsOwned()>0||HasOrder()){placedUncertain=true;Print("Apex4 restart: broker SL/TP remain; no new basket until operator review.");}
 EventSetMillisecondTimer(100);return INIT_SUCCEEDED;
}
void OnDeinit(const int reason){EventKillTimer();if(lockKey!="")GlobalVariableSet(lockKey,0);}
void OnTick(){Manage();}
void OnTimer(){
 if(!DemoOK())return;
 Manage();
 // Never perform a network request for every order; use one locally cached publication.
 if(running&&addAllowed){AddOne();return;}
 Poll();
 if(!running&&EnablePullback&&!placedUncertain&&TimeGMT()<armedUntil){
   MqlDateTime t;TimeToStruct(TimeGMT(),t);
   if(t.min>=2){Plan p;if(Pullback(p))Start(p);} // reserve first two minutes for Outlook
 }
}
