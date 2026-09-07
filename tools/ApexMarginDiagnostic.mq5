//+------------------------------------------------------------------+
//| ApexMarginDiagnostic.mq5                                          |
//| Read-only. Places NO orders. Prints every number needed to prove  |
//| why XauCloud-Apex v3.7.1 requested 200.00 lots on this account    |
//| (POST-AUDIT-LIVE-001) and what v3.8.0 would request instead.      |
//| Attach to the SAME symbol/chart the EA runs on, then copy the     |
//| Experts-log output.                                               |
//+------------------------------------------------------------------+
#property script_show_inputs
#property strict

input double InpL1Pct=15.0;    // NORMAL L1 margin %
input double InpL2Pct=50.0;    // NORMAL L2 margin %
input double InpL3Pct=100.0;   // NORMAL L3+ margin %

double VolStep(){double st=SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_STEP);if(st>0)return st;
                 double mn=SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_MIN);return mn>0?mn:0.01;}
int VolDigits(){double st=VolStep();for(int d=0;d<=8;d++){double f=MathPow(10.0,d);
                 if(MathAbs(st*f-MathRound(st*f))<1e-9)return d;}return 8;}
double FloorToStep(double v){double st=VolStep();if(st<=0)return 0;double n=MathFloor(v/st+1e-9)*st;
                 return n<0?0:NormalizeDouble(n,VolDigits());}

double MarginFor(ENUM_ORDER_TYPE t,double vol,double price)
  {double m=0;if(!OrderCalcMargin(t,_Symbol,vol,price,m))return -1;return m;}

double LargestWithinMargin(ENUM_ORDER_TYPE t,double price,double money,double hi)
  {
   if(hi<=0||money<=0)return 0;
   double m=MarginFor(t,hi,price);
   if(m>=0&&m<=money)return FloorToStep(hi);
   double lo=0,up=hi;
   for(int i=0;i<40;i++){double mid=(lo+up)/2;double mm=MarginFor(t,mid,price);
      if(mm<0||mm>money)up=mid;else lo=mid;}
   return FloorToStep(lo);
  }
bool CheckVol(ENUM_ORDER_TYPE t,double vol,double price,double sl,uint &rc)
  {
   rc=0;if(vol<=0)return false;
   MqlTradeRequest rq;MqlTradeCheckResult cr;ZeroMemory(rq);ZeroMemory(cr);
   rq.action=TRADE_ACTION_DEAL;rq.symbol=_Symbol;rq.volume=vol;rq.type=t;rq.price=price;rq.sl=sl;
   rq.magic=8620260903;rq.deviation=80;rq.type_filling=ORDER_FILLING_IOC;
   bool ok=OrderCheck(rq,cr);rc=cr.retcode;
   return ok||rc==TRADE_RETCODE_DONE||rc==TRADE_RETCODE_PLACED;
  }
double LargestPassingCheck(ENUM_ORDER_TYPE t,double price,double sl,double hi)
  {
   if(hi<=0)return 0;uint rc=0;
   if(CheckVol(t,FloorToStep(hi),price,sl,rc))return FloorToStep(hi);
   double lo=0,up=hi;
   for(int i=0;i<24;i++){double mid=FloorToStep((lo+up)/2);if(mid<=0){lo=0;break;}
      if(CheckVol(t,mid,price,sl,rc))lo=mid;else up=mid;}
   return FloorToStep(lo);
  }

void Report(ENUM_ORDER_TYPE t,double price,double sl,double pct,string label)
  {
   double free=AccountInfoDouble(ACCOUNT_MARGIN_FREE);
   double budget=free*MathMax(0.1,MathMin(100.0,pct))/100.0;
   double volMax=SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_MAX);
   double volMin=SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_MIN);
   double mMax=MarginFor(t,volMax,price);
   // v3.7.1 path
   double v371=(mMax>=0&&mMax<=budget)?volMax:0;
   if(v371==0){
      double lo=0,hi=volMax,m=0;
      for(int i=0;i<36;i++){double mid=(lo+hi)/2;m=MarginFor(t,mid,price);if(m<0||m>budget)hi=mid;else lo=mid;}
      v371=MathFloor(lo/VolStep())*VolStep();
      if(v371<volMin){double mm=MarginFor(t,volMin,price);v371=(mm>=0&&mm<=budget)?volMin:0;}
      else v371=MathMax(volMin,MathMin(volMax,v371));   // v3.7.1 NormVol clamps UP to min
   }
   // v3.8.0 path
   double capMargin=LargestWithinMargin(t,price,free,volMax);
   double capBroker=LargestPassingCheck(t,price,sl,capMargin);
   double byCapPct=FloorToStep(capBroker*MathMax(0.1,MathMin(100.0,pct))/100.0);
   double byBudget=LargestWithinMargin(t,price,budget,volMax);
   double req=MathMin(byCapPct,byBudget);
   uint rc=0;double finalV=req;
   if(finalV<volMin){double mm=MarginFor(t,volMin,price);finalV=(mm>=0&&mm<=budget)?volMin:0;}
   if(finalV>0&&!CheckVol(t,finalV,price,sl,rc))finalV=LargestPassingCheck(t,price,sl,finalV);
   PrintFormat("APEXDIAG %s pct=%.2f | budget=%.2f | marginAtVolMax=%.2f | v3.7.1_WOULD_SEND=%.4f"
               " | capacityByMargin=%.4f capacityByBroker=%.4f byCapacityPct=%.4f byMarginBudget=%.4f"
               " | v3.8.0_WOULD_SEND=%.4f (orderCheckRetcode=%d)",
               label,pct,budget,mMax,v371,capMargin,capBroker,byCapPct,byBudget,finalV,rc);
  }

void OnStart()
  {
   MqlTick tk;
   if(!SymbolInfoTick(_Symbol,tk)){Print("APEXDIAG NO TICK");return;}
   PrintFormat("APEXDIAG ACCOUNT | login=%I64d company=%s server=%s currency=%s leverage=1:%I64d"
               " marginMode=%d tradeMode=%d",
      AccountInfoInteger(ACCOUNT_LOGIN),AccountInfoString(ACCOUNT_COMPANY),AccountInfoString(ACCOUNT_SERVER),
      AccountInfoString(ACCOUNT_CURRENCY),AccountInfoInteger(ACCOUNT_LEVERAGE),
      (int)AccountInfoInteger(ACCOUNT_MARGIN_MODE),(int)AccountInfoInteger(ACCOUNT_TRADE_MODE));
   PrintFormat("APEXDIAG MONEY | balance=%.2f equity=%.2f margin=%.2f freeMargin=%.2f marginLevel=%.2f",
      AccountInfoDouble(ACCOUNT_BALANCE),AccountInfoDouble(ACCOUNT_EQUITY),AccountInfoDouble(ACCOUNT_MARGIN),
      AccountInfoDouble(ACCOUNT_MARGIN_FREE),AccountInfoDouble(ACCOUNT_MARGIN_LEVEL));
   PrintFormat("APEXDIAG SYMBOL | %s bid=%.5f ask=%.5f digits=%d contract=%.2f volMin=%.4f volMax=%.4f volStep=%.5f"
               " volLimit=%.4f marginInitial=%.4f marginMaintenance=%.4f tradeMode=%d",
      _Symbol,tk.bid,tk.ask,(int)SymbolInfoInteger(_Symbol,SYMBOL_DIGITS),
      SymbolInfoDouble(_Symbol,SYMBOL_TRADE_CONTRACT_SIZE),
      SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_MIN),SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_MAX),
      SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_STEP),SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_LIMIT),
      SymbolInfoDouble(_Symbol,SYMBOL_MARGIN_INITIAL),SymbolInfoDouble(_Symbol,SYMBOL_MARGIN_MAINTENANCE),
      (int)SymbolInfoInteger(_Symbol,SYMBOL_TRADE_MODE));
   double probes[]={0.01,0.1,1.0,5.0,10.0,20.0,50.0,100.0,200.0};
   for(int i=0;i<ArraySize(probes);i++)
     {
      double v=probes[i];
      if(v>SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_MAX))continue;
      uint rcB=0,rcS=0;
      bool okB=CheckVol(ORDER_TYPE_BUY,v,tk.ask,0,rcB);
      bool okS=CheckVol(ORDER_TYPE_SELL,v,tk.bid,0,rcS);
      PrintFormat("APEXDIAG MARGIN | vol=%.4f  buyMargin=%.2f sellMargin=%.2f  orderCheckBuy=%s(%d) orderCheckSell=%s(%d)",
         v,MarginFor(ORDER_TYPE_BUY,v,tk.ask),MarginFor(ORDER_TYPE_SELL,v,tk.bid),
         okB?"OK":"FAIL",rcB,okS?"OK":"FAIL",rcS);
     }
   double slBuy=NormalizeDouble(tk.ask-30.0,(int)SymbolInfoInteger(_Symbol,SYMBOL_DIGITS));
   double slSell=NormalizeDouble(tk.bid+30.0,(int)SymbolInfoInteger(_Symbol,SYMBOL_DIGITS));
   Report(ORDER_TYPE_BUY,tk.ask,slBuy,InpL1Pct,"NORMAL_L1_BUY");
   Report(ORDER_TYPE_SELL,tk.bid,slSell,InpL1Pct,"NORMAL_L1_SELL");
   Report(ORDER_TYPE_BUY,tk.ask,0,InpL2Pct,"NORMAL_L2_BUY");
   Report(ORDER_TYPE_BUY,tk.ask,0,InpL3Pct,"NORMAL_L3_BUY");
   Print("APEXDIAG DONE | no orders were placed");
  }
