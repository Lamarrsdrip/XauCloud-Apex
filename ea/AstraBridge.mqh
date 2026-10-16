// Astra owns market decisions; the canonical EA retains broker mechanics and
// unchanged Lifestyle native fallback. No provider key enters this process.
#ifndef APEX_ASTRA_BRIDGE
#define APEX_ASTRA_BRIDGE
#define ASTRA_KNOWLEDGE_VERSION "tradingcartel-breakfast-v1"

struct AstraDecision
  {
   bool valid,thesisValid;
   string decisionId,snapshotId,strategyVersion,state,action,direction,triggerId,expectedCampaignId;
   double confidence,setupQuality,locationQuality,freshness,extensionRisk,continuationQuality;
   double invalidationPrice,referenceBid,referenceAsk,maxDriftAtr,atr;
   long createdAtMs,expiresAtMs;
   int expectedLayers;
  };
AstraDecision g_astraDecision;
bool g_astraAvailable=false,g_astraPending=false;
string g_astraStatus="NATIVE_LIFESTYLE",g_astraFallback="",g_astraRequestId="",g_astraSnapshotId="";
string g_astraLastEvent="",g_astraLastApplied="";
ulong g_astraLastStatusMs=0,g_astraLastRequestMs=0,g_astraLastPollMs=0,g_astraPendingSince=0;
ulong g_astraBackoffUntil=0,g_astraTickSampleAt=0;
double g_astraLastSnapshotBid=0;
datetime g_astraRequestClosedBar=0;
MqlTick g_astraTicks[120];
int g_astraTickCount=0;

long AstraNowMs()
  {return IsTester()?((long)TimeCurrent()-(long)InpAstraTesterBrokerUTCOffsetMinutes*60)*1000:(long)TimeGMT()*1000;}
long AstraBrokerOffset()
  {
   if(IsTester())return (long)InpAstraTesterBrokerUTCOffsetMinutes*60;
   // Broker chart epochs differ from UTC. Round to a quarter-hour so quote
   // arrival jitter cannot shift historical candle timestamps by seconds.
   datetime brokerNow=TimeTradeServer();if(brokerNow<=0)brokerNow=TimeCurrent();
   return (long)MathRound((double)(brokerNow-TimeGMT())/900.0)*900;
  }
string AstraEscape(string s)
  {
   StringReplace(s,"\\","\\\\");StringReplace(s,"\"","\\\"");
   StringReplace(s,"\r","\\r");StringReplace(s,"\n","\\n");StringReplace(s,"\t","\\t");
   return s;
  }
bool AstraMember(const string value,const string list)
  {return StringFind("|"+list+"|","|"+value+"|")>=0;}
bool AstraUnit(double x){return MathIsValidNumber(x)&&x>=0&&x<=1;}
bool AstraHexTrigger(const string value)
  {
   if(StringLen(value)!=32)return false;
   for(int i=0;i<32;i++)
     {
      ushort c=StringGetCharacter(value,i);
      if(!((c>='0'&&c<='9')||(c>='a'&&c<='f')))return false;
     }
   return true;
  }

// Reject duplicate keys, non-object payloads and trailing material before using
// the shared typed scanner. Casual prose can never become an order command.
bool AstraParseObject(const string j)
  {
   if(StringLen(j)>65536)return false;
   int n=StringLen(j),p=JsonSkipWs(j,0);
   if(p>=n||StringGetCharacter(j,p)!='{')return false;
   p++;string seen="|";
   while(true)
     {
      p=JsonSkipWs(j,p);
      if(p>=n)return false;
      if(StringGetCharacter(j,p)=='}')return JsonSkipWs(j,p+1)==n&&JsonParseObject(j);
      string k="";int q=JsonReadString(j,p,k);
      if(q<0||k==""||StringFind(k,"|")>=0||StringFind(seen,"|"+k+"|")>=0)return false;
      seen+=k+"|";p=JsonSkipWs(j,q);
      if(p>=n||StringGetCharacter(j,p)!=':')return false;
      string v="";ushort t=0;q=JsonReadValue(j,p+1,v,t);
      if(q<0)return false;p=JsonSkipWs(j,q);
      if(p<n&&StringGetCharacter(j,p)=='}')return JsonSkipWs(j,p+1)==n&&JsonParseObject(j);
      if(p>=n||StringGetCharacter(j,p)!=',')return false;
      p=JsonSkipWs(j,p+1);
      if(p<n&&StringGetCharacter(j,p)=='}')return false;
     }
  }

void AstraEvent(string type,string reason="")
  {
   Emit(type,StringFormat(
      ",\"strategyOwner\":\"%s\",\"decisionId\":\"%s\",\"snapshotId\":\"%s\",\"setupPhase\":\"%s\","
      "\"action\":\"%s\",\"confidence\":%.4f,\"setupQuality\":%.4f,\"locationQuality\":%.4f,"
      "\"freshness\":%.4f,\"extensionRisk\":%.4f,\"strategyVersion\":\"%s\",\"fallbackReason\":\"%s\"",
      strategyOwner,AstraEscape(g_astraDecision.decisionId),AstraEscape(g_astraSnapshotId),AstraEscape(g_astraDecision.state),
      AstraEscape(g_astraDecision.action),g_astraDecision.confidence,g_astraDecision.setupQuality,g_astraDecision.locationQuality,
      g_astraDecision.freshness,g_astraDecision.extensionRisk,ASTRA_KNOWLEDGE_VERSION,AstraEscape(reason)));
  }
void AstraTakeover(string reason)
  {
   if(strategyOwner!="ASTRA")return;
   strategyOwner="LIFESTYLE_NATIVE";g_astraStopAdding=false;
   SaveState();AstraEvent("ASTRA_FALLBACK",reason);
  }
void AstraLateFill(bool firstEntry)
  {
   // Native pending reconciliation has established a real broker position.
   // Refresh Astra's price anchors from that position, not the request quote.
   int dir,count;double price;NewestMagicPosition(dir,price,count);
   if(price>0){lastAdd=price;if(firstEntry)firstEntryPrice=price;}
   AstraEvent(firstEntry?"ASTRA_ENTRY":"ASTRA_ADD","LATE_BROKER_CONFIRMED_FILL");
  }
void AstraFail(string reason)
  {
   bool changed=g_astraAvailable||g_astraPending||g_astraFallback!=reason;
   g_astraAvailable=false;g_astraPending=false;g_astraDecision.valid=false;
   g_astraRequestId="";g_astraStatus=reason;g_astraFallback=reason;
   g_astraBackoffUntil=GetTickCount64()+15000;
   if(strategyOwner=="ASTRA")AstraTakeover(reason);
   else if(changed)AstraEvent("ASTRA_FALLBACK",reason);
  }
void AstraResetAfterFlat()
  {
   g_astraDecision.valid=false;g_astraPending=false;g_astraRequestId="";
   g_astraCampaignInvalidation=0;
   g_astraLastEvent="";g_astraLastApplied="";
  }

bool AstraHttp(string method,string path,string body,string &response)
  {
   response="";
   if(IsTester()||!InpAstraBridge)return false;
   // An arbitrary unencrypted URL must never receive the user's license.
   if(StringFind(InpAstraBackendURL,"https://")!=0)return false;
   char data[],result[];string headers="Content-Type: application/json\r\n",rh;
   StringToCharArray(body,data,0,WHOLE_ARRAY,CP_UTF8);
   if(ArraySize(data)>0)ArrayResize(data,ArraySize(data)-1);
   ResetLastError();
   int code=WebRequest(method,InpAstraBackendURL+path,headers,
                       MathMax(100,MathMin(1000,InpAstraTransportTimeoutMs)),data,result,rh);
   if(code<200||code>=300||ArraySize(result)>65536)return false;
   response=CharArrayToString(result,0,WHOLE_ARRAY,CP_UTF8);
   return AstraParseObject(response);
  }

void AstraSampleTick()
  {
   MqlTick tk;if(!SymbolInfoTick(_Symbol,tk)||tk.bid<=0||tk.ask<tk.bid)return;
   ulong ms=IsTester()?(ulong)tk.time_msc:GetTickCount64();
   if(ms>=g_astraTickSampleAt&&ms-g_astraTickSampleAt<500)return;
   g_astraTickSampleAt=ms;
   if(g_astraTickCount==120)
     {for(int i=1;i<120;i++)g_astraTicks[i-1]=g_astraTicks[i];g_astraTickCount--;}
   g_astraTicks[g_astraTickCount++]=tk;
  }
string AstraCandles(ENUM_TIMEFRAMES tf,int count,long offset)
  {
   MqlRates bars[];ArraySetAsSeries(bars,true);
   int n=CopyRates(_Symbol,tf,1,count,bars);string out="[";
   for(int i=n-1;i>=0;i--)
     {
      if(i<n-1)out+=",";
      out+=StringFormat("{\"time\":%I64d,\"open\":%.5f,\"high\":%.5f,\"low\":%.5f,\"close\":%.5f}",
              ((long)bars[i].time-offset)*1000,bars[i].open,bars[i].high,bars[i].low,bars[i].close);
     }
   return out+"]";
  }
string AstraSnapshot()
  {
   MqlTick tk;if(!SymbolInfoTick(_Symbol,tk))return "";
   long offset=AstraBrokerOffset(),now=AstraNowMs();
   long age=now-(tk.time_msc-offset*1000);if(age<0)age=0;
   string entries="[";double notional=0,vol=0;int n=0;
   for(int i=0;i<PositionsTotal();i++)
     {
      ulong ticket=PositionGetTicket(i);if(!ticket||!IsOurPosition(ticket))continue;
      double price=PositionGetDouble(POSITION_PRICE_OPEN),size=PositionGetDouble(POSITION_VOLUME);
      if(n++>0)entries+=",";
      entries+=StringFormat("{\"ticket\":\"%I64u\",\"price\":%.5f,\"volume\":%.4f}",ticket,price,size);
      notional+=price*size;vol+=size;
     }
   entries+="]";string ticks="[";int used=0;
   for(int i=0;i<g_astraTickCount;i++)
     {
      long time=g_astraTicks[i].time_msc-offset*1000;
      if(time<now-60000||time>now+2000)continue;
      if(used++>0)ticks+=",";
      ticks+=StringFormat("{\"time\":%I64d,\"bid\":%.5f,\"ask\":%.5f}",time,g_astraTicks[i].bid,g_astraTicks[i].ask);
     }
   ticks+="]";
   g_astraSnapshotId=StringFormat("%s-%I64u",g_instanceId,GetTickCount64());
   string snapshot=StringFormat(
      "{\"snapshotId\":\"%s\",\"observedAtMs\":%I64d,\"symbol\":\"%s\","
      "\"quote\":{\"bid\":%.5f,\"ask\":%.5f,\"ageMs\":%I64d},"
      "\"account\":{\"balance\":%.2f,\"equity\":%.2f,\"floatingProfit\":%.2f,\"freeMargin\":%.2f,\"marginLevel\":%.4f,\"leverage\":%I64d,\"profile\":\"%s\"},"
      "\"campaign\":{\"id\":\"%s\",\"owner\":\"%s\",\"direction\":\"%s\",\"layers\":%d,\"l1Price\":%.5f,\"weightedEntry\":%.5f,\"lastAddPrice\":%.5f,"
      "\"positions\":%s,\"basketProfit\":%.2f,\"mfe\":%.2f,\"mae\":%.2f},",
      AstraEscape(g_astraSnapshotId),now,AstraEscape(_Symbol),tk.bid,tk.ask,age,
      AccountInfoDouble(ACCOUNT_BALANCE),AccountInfoDouble(ACCOUNT_EQUITY),AccountInfoDouble(ACCOUNT_PROFIT),
      AccountInfoDouble(ACCOUNT_MARGIN_FREE),AccountInfoDouble(ACCOUNT_MARGIN_LEVEL),AccountInfoInteger(ACCOUNT_LEVERAGE),ExecutionProfile(),
      AstraEscape(campId),strategyOwner,campDir>0?"BUY":campDir<0?"SELL":"NONE",layers,
      firstEntryPrice,vol>0?notional/vol:0,lastAdd,entries,BasketProfitFloating(),mfe,mae);
   snapshot+="\"candles\":{\"m1\":"+AstraCandles(PERIOD_M1,90,offset)+",\"m3\":"+AstraCandles(PERIOD_M3,24,offset)+",\"m5\":"+AstraCandles(PERIOD_M5,18,offset)+"},\"recentTicks\":"+ticks;
   MqlRates forming[];ArraySetAsSeries(forming,true);
   if(CopyRates(_Symbol,PERIOD_M1,0,1,forming)==1)
      snapshot+=StringFormat(",\"forming\":{\"isClosed\":false,\"time\":%I64d,\"open\":%.5f,\"high\":%.5f,\"low\":%.5f,\"close\":%.5f}",
                   ((long)forming[0].time-offset)*1000,forming[0].open,forming[0].high,forming[0].low,forming[0].close);
   return "{\"license\":\""+AstraEscape(NormalizeLicense(InpApexLicense))+"\",\"account\":\""+
          StringFormat("%I64d",AccountInfoInteger(ACCOUNT_LOGIN))+"\",\"snapshot\":"+snapshot+"}}";
  }

bool AstraReadDecision()
  {
   AstraDecision d;ZeroMemory(d);double created,expires,expected;
   if(!JStrStrict("decisionId",d.decisionId)||!JStrStrict("snapshotId",d.snapshotId)||
      !JStrStrict("strategyVersion",d.strategyVersion)||!JStrStrict("state",d.state)||
      !JStrStrict("action",d.action)||!JStrStrict("direction",d.direction)||
      !JStrStrict("triggerId",d.triggerId)||!JStrStrict("expectedCampaignId",d.expectedCampaignId)||
      !JBoolStrict("thesisValid",d.thesisValid)||!JNumStrict("confidence",d.confidence)||
      !JNumStrict("setupQuality",d.setupQuality)||!JNumStrict("locationQuality",d.locationQuality)||
      !JNumStrict("freshness",d.freshness)||!JNumStrict("extensionRisk",d.extensionRisk)||
      !JNumStrict("continuationQuality",d.continuationQuality)||!JNumStrict("invalidationPrice",d.invalidationPrice)||
      !JNumStrict("referenceBid",d.referenceBid)||!JNumStrict("referenceAsk",d.referenceAsk)||
      !JNumStrict("maxDriftAtr",d.maxDriftAtr)||!JNumStrict("atr",d.atr)||
      !JNumStrict("createdAtMs",created)||!JNumStrict("expiresAtMs",expires)||!JNumStrict("expectedLayers",expected))return false;
   if(d.strategyVersion!=ASTRA_KNOWLEDGE_VERSION||d.snapshotId!=g_astraSnapshotId||d.decisionId!=g_astraRequestId||
      !AstraHexTrigger(d.triggerId)||StringLen(d.decisionId)>128||StringLen(d.expectedCampaignId)>128)return false;
   if(!AstraMember(d.action,"WAIT|ENTER_BUY|ENTER_SELL|ADD|HOLD|STOP_ADDING|REDUCE|EXIT")||
      !AstraMember(d.direction,"BUY|SELL|NONE")||
      !AstraMember(d.state,"NO_SETUP|WATCHING|APPROACH|IMPULSE|EXTREME_TEST|SWEEP|REJECTION_PENDING|REJECTION|FRESH_PROOF|ENTRY_READY|ENTRY_ACTIVE|CONTINUATION|ADD_READY|EXPANSION|THESIS_WEAKENING|INVALID|EXIT"))return false;
   if(!AstraUnit(d.confidence)||!AstraUnit(d.setupQuality)||!AstraUnit(d.locationQuality)||!AstraUnit(d.freshness)||
      !AstraUnit(d.extensionRisk)||!AstraUnit(d.continuationQuality)||d.referenceBid<=0||d.referenceAsk<d.referenceBid||
      d.atr<=0||d.maxDriftAtr<=0||d.maxDriftAtr>0.5||d.invalidationPrice<0||expected<0||expected>100000||expected!=MathFloor(expected))return false;
   if(created!=MathFloor(created)||expires!=MathFloor(expires)||created>AstraNowMs()+2000||
      expires<=created||expires-created>8000||AstraNowMs()>expires)return false;
   d.createdAtMs=(long)created;d.expiresAtMs=(long)expires;d.expectedLayers=(int)expected;
   if(d.action=="ENTER_BUY"&&(d.direction!="BUY"||d.state!="ENTRY_READY"))return false;
   if(d.action=="ENTER_SELL"&&(d.direction!="SELL"||d.state!="ENTRY_READY"))return false;
   if(d.action=="ADD"&&!AstraMember(d.state,"ADD_READY|EXPANSION"))return false;
   if(AstraMember(d.action,"ENTER_BUY|ENTER_SELL|ADD")&&(!d.thesisValid||d.invalidationPrice<=0||d.direction=="NONE"))return false;
   d.valid=true;g_astraDecision=d;return true;
  }

// Pure predicate also exercised by the extracted C++ boundary tests.
bool AstraFreshEnvelope(long nowMs,long expiresMs,ulong elapsedMs,bool sameSnapshot,bool sameCampaign,
                        int expectedLayers,int actualLayers,double drift,double allowedDrift)
  {
   return nowMs<=expiresMs&&elapsedMs<=8000&&sameSnapshot&&sameCampaign&&expectedLayers==actualLayers&&
          MathIsValidNumber(drift)&&allowedDrift>0&&drift<=allowedDrift;
  }
bool AstraWinnerProof(double basketProfit,int direction,bool freshMarketEvent)
  {return basketProfit>0&&(direction==1||direction==-1)&&freshMarketEvent;}

bool AstraSubmissionValid()
  {
   AstraDecision d=g_astraDecision;MqlTick tk;
   if(!d.valid||!g_astraAvailable||!SymbolInfoTick(_Symbol,tk)||tk.bid<=0||tk.ask<tk.bid)return false;
   double drift=MathMax(MathAbs(tk.bid-d.referenceBid),MathAbs(tk.ask-d.referenceAsk));
   bool first=(d.action=="ENTER_BUY"||d.action=="ENTER_SELL");
   // Start() assigns a provisional campaign ID before sizing. First entries must
   // still be flat; adds must match the exact frozen campaign and layer prefix.
   bool sameCampaign=first?(CountPos()==0&&d.expectedCampaignId==""&&layers==0):
                          (campId==d.expectedCampaignId&&strategyOwner=="ASTRA"&&campState==CAMP_ACTIVE);
   if(!AstraFreshEnvelope(AstraNowMs(),d.expiresAtMs,GetTickCount64()-g_astraPendingSince,
                         d.snapshotId==g_astraSnapshotId,sameCampaign,d.expectedLayers,layers,drift,d.maxDriftAtr*d.atr))return false;
   if(g_astraRequestClosedBar!=iTime(_Symbol,PERIOD_M1,1))return false;
   long age=AstraNowMs()-(tk.time_msc-AstraBrokerOffset()*1000);if(age>3000)return false;
   int dir=d.direction=="BUY"?1:d.direction=="SELL"?-1:0;
   if(dir==0||!d.thesisValid||d.invalidationPrice<=0)return false;
   if(dir>0?tk.bid<=d.invalidationPrice:tk.ask>=d.invalidationPrice)return false;
   // A fresh market event can support a clustered/pullback fill slightly behind
   // the latest leg. Signed movement since lastAdd remains a model feature.
   if(!first&&(campDir!=dir||!AstraWinnerProof(BasketProfitFloating(),dir,d.triggerId!="")))return false;
   if(!first&&TriggerUseCount("ASTRA|"+d.triggerId)>0)return false;
   return true;
  }

long AstraMicroEventTime()
  {
   long eventTime=0;double low=DBL_MAX,high=-DBL_MAX;
   long cutoff=(long)TimeCurrent()*1000-60000;
   for(int i=0;i<g_astraTickCount;i++)
     {
      MqlTick t=g_astraTicks[i];if(t.time_msc<cutoff)continue;
      if(i>1&&low<DBL_MAX&&high>-DBL_MAX)
        {
         MqlTick p=g_astraTicks[i-1];double spread=MathMax(t.ask-t.bid,p.ask-p.bid);
         if((p.bid-low>=spread&&t.bid<low)||(high-p.ask>=spread&&t.ask>high))eventTime=t.time_msc;
        }
      low=MathMin(low,t.bid);high=MathMax(high,t.ask);
     }
   return eventTime;
  }
string AstraEventFingerprint()
  {
   double atr=ATR();MqlTick tk;if(atr<=0||!SymbolInfoTick(_Symbol,tk))return "";
   MqlRates b[];ArraySetAsSeries(b,true);if(CopyRates(_Symbol,PERIOD_M1,0,3,b)<3)return "";
   // A bar/position-prefix transition or live break/reclaim is an event. The
   // change in executable price is a request trigger, never permission to ADD.
   bool microSell=tk.bid<MathMin(b[1].low,b[2].low),microBuy=tk.ask>MathMax(b[1].high,b[2].high);
   bool reclaim=S.extreme>0&&(S.dir<0?tk.ask>=S.extreme:tk.bid<=S.extreme);
   return StringFormat("%I64d|%s|%d|%d|%s|%s|%s|%s|%s|%I64d",(long)b[1].time,campId,layers,CountPos(),strategyOwner,
                        SetupStateText(),BoolJson(microSell),BoolJson(microBuy),BoolJson(reclaim),AstraMicroEventTime());
  }

// Cost guard: every request is a paid call on the USER's key. When flat, ask
// only while the market shows the impulse+sweep attention condition (the same
// predicate native Lifestyle uses to arm a watch), at most once per closed M1
// bar. Measured on 2026-06-11 real ticks: ~500 requests/day versus ~23,000 for a
// per-microstructure-change trigger. Inside an Astra campaign, a new closed bar
// or a fresh micro event may trigger, never faster than every 5 seconds.
datetime g_astraAttnBar=0,g_astraAttnUntil=0;
bool AstraAttention()
  {
   datetime bar=iTime(_Symbol,PERIOD_M1,1);
   if(bar!=g_astraAttnBar)
     {
      g_astraAttnBar=bar;
      double a=ATR();MqlRates m1[];
      if(a>0&&Rates(PERIOD_M1,90,m1))
        {
         double move=m1[1].close-m1[8].close;int imp=move>=0?1:-1,directional=0;
         for(int i=1;i<=7;i++)
            if((imp>0&&m1[i].close>m1[i].open)||(imp<0&&m1[i].close<m1[i].open))directional++;
         double ph=-DBL_MAX,pl=DBL_MAX;
         for(int i=9;i<80;i++){ph=MathMax(ph,m1[i].high);pl=MathMin(pl,m1[i].low);}
         bool swept=imp>0?m1[1].high>=ph+C.sweepAtr*a:m1[1].low<=pl-C.sweepAtr*a;
         if(MathAbs(move)/a>=C.impulseAtr&&directional>=5&&swept)
            g_astraAttnUntil=TimeCurrent()+(datetime)MathMax(1,C.watchExpiryMinutes)*60;
        }
     }
   return TimeCurrent()<=g_astraAttnUntil;
  }
bool AstraRequestDue(ulong nowMs,string event,double bid)
  {
   datetime closed=iTime(_Symbol,PERIOD_M1,1);
   if(campState==CAMP_IDLE)
      return closed!=g_astraRequestClosedBar&&AstraAttention();
   if(strategyOwner!="ASTRA")return false;
   if(closed!=g_astraRequestClosedBar)return true;
   if(nowMs-g_astraLastRequestMs<5000)return false;
   double atr=ATR();
   return event!=g_astraLastEvent||(atr>0&&MathAbs(bid-g_astraLastSnapshotBid)>=atr*0.25);
  }

void AstraExportContext()
  {
   AstraSampleTick();ulong now=(ulong)TimeCurrent()*1000;
   string event=AstraEventFingerprint();MqlTick tk;if(event==""||!SymbolInfoTick(_Symbol,tk))return;
   // Same gate as live, so an export measures the real request rate and cost.
   if(!AstraRequestDue(now,event,tk.bid))return;
   string body=AstraSnapshot();if(body==""||!JsonParseObject(body))return;
   int index=JIdx("snapshot");if(index<0||g_jtype[index]!='o')return;
   // Write only market/account context. License envelope and credentials are
   // excluded even if the tester's Inputs happen to contain a real license.
   string snapshot=g_jval[index];
   string file="AstraContexts_"+StringFormat("%I64d",(long)TimeCurrent()/86400)+".ndjson";
   int h=FileOpen(file,FILE_READ|FILE_WRITE|FILE_TXT|FILE_ANSI,0,CP_UTF8);
   if(h==INVALID_HANDLE){Print("ASTRA CONTEXT EXPORT FAILED | file=",file);return;}
   FileSeek(h,0,SEEK_END);FileWriteString(h,snapshot+"\r\n");FileFlush(h);FileClose(h);
   g_astraLastRequestMs=now;g_astraLastEvent=event;g_astraLastSnapshotBid=tk.bid;
   g_astraRequestClosedBar=iTime(_Symbol,PERIOD_M1,1);
  }

// At most ONE short HTTP operation per timer pass, after hard management. The
// provider request executes asynchronously in the backend, never in WebRequest.
bool AstraService()
  {
   if(g_astraRestartTakeover)
     {g_astraRestartTakeover=false;SaveState();AstraEvent("ASTRA_FALLBACK","RESTART_NATIVE_TAKEOVER");}
   if(IsTester())
     {
      // Tester forbids WebRequest. Export the causal prefix for a later honest
      // backend evaluation rather than substitute an invented AI decision.
      if(InpAstraExportContexts)AstraExportContext();
      return false;
     }
   if(!InpAstraBridge)
     {if(g_astraAvailable||strategyOwner=="ASTRA")AstraFail("DISABLED");return false;}
   AstraSampleTick();ulong now=GetTickCount64();
   if(strategyOwner=="LIFESTYLE_NATIVE"&&campState!=CAMP_IDLE)return false;
   if(now<g_astraBackoffUntil)return false;
   // The license travels only in HTTPS POST bodies, never in URLs that proxies,
   // access logs or browser history could retain.
   string auth="\"license\":\""+AstraEscape(NormalizeLicense(InpApexLicense))+"\",\"account\":\""+StringFormat("%I64d",AccountInfoInteger(ACCOUNT_LOGIN))+"\"";
   string r="",status="";
   if(g_astraPending)
     {
      if(now-g_astraPendingSince>8000){AstraFail("AI_TIMEOUT");return false;}
      if(now-g_astraLastPollMs<500)return false;
      g_astraLastPollMs=now;
      if(!AstraHttp("POST","/api/apex/astra/decision","{"+auth+",\"requestId\":\""+AstraEscape(g_astraRequestId)+"\"}",r)||!JStrStrict("status",status))
        {AstraFail("AI_ERROR");return true;}
      if(status=="PENDING")return true;
      if(status!="ACTIVE"){AstraFail(status);return true;}
      if(!AstraReadDecision()){AstraFail("SCHEMA_FAILURE");return true;}
      g_astraPending=false;g_astraAvailable=true;g_astraStatus="ACTIVE";g_astraFallback="";
      AstraEvent("ASTRA_DECISION");return true;
     }
   if(g_astraLastStatusMs==0||now-g_astraLastStatusMs>=15000)
     {
      g_astraLastStatusMs=now;bool enabled=false,hasKey=false;
      if(!AstraHttp("POST","/api/apex/astra/status","{"+auth+"}",r)||!JBoolStrict("enabled",enabled)||!JBoolStrict("hasKey",hasKey))
        {AstraFail("AI_ERROR");return true;}
      if(!enabled||!hasKey){AstraFail(enabled?"NO_API_KEY":"DISABLED");return true;}
      if(JStrStrict("status",status)&&status=="DAILY_BUDGET_REACHED"){AstraFail(status);return true;}
      g_astraAvailable=true;return true;
     }
   if(!g_astraAvailable)return false;
   string event=AstraEventFingerprint();MqlTick tk;if(event==""||!SymbolInfoTick(_Symbol,tk))return false;
   if(!AstraRequestDue(now,event,tk.bid))return false;
   string body=AstraSnapshot();if(body==""){AstraFail("INVALID_MARKET_CONTEXT");return false;}
   g_astraLastEvent=event;g_astraLastSnapshotBid=tk.bid;g_astraLastRequestMs=now;
   g_astraRequestClosedBar=iTime(_Symbol,PERIOD_M1,1);
   g_astraPendingSince=now;g_astraDecision.valid=false;
   AstraEvent("ASTRA_REQUEST");
   if(!AstraHttp("POST","/api/apex/astra/context",body,r)||!JStrStrict("status",status))
     {AstraFail("AI_ERROR");return true;}
   if(status!="PENDING"){AstraFail(status);return true;}
   string snapshotId="";
   if(!JStrStrict("requestId",g_astraRequestId)||!JStrStrict("snapshotId",snapshotId)||
      snapshotId!=g_astraSnapshotId||g_astraRequestId==""||StringLen(g_astraRequestId)>128)
     {AstraFail("SCHEMA_FAILURE");return true;}
   g_astraPending=true;g_astraLastPollMs=now;return true;
  }

bool AstraEntryAuthority()
  {
   if(!g_astraAvailable||IsTester()||!InpAstraBridge)return false;
   if(g_astraPending)return true; // bounded by AstraService's monotonic timeout
   if(!g_astraDecision.valid)return true;
   AstraDecision d=g_astraDecision;
   if(d.decisionId==g_astraLastApplied)return true;
   if(!AstraMember(d.action,"ENTER_BUY|ENTER_SELL"))return true;
   if(!AstraSubmissionValid())
     {AstraFail("STALE_OR_CHANGED_MARKET");return false;}
   Setup nativeSetup=S;Snap s;ZeroMemory(s);
   s.dir=d.direction=="BUY"?1:-1;s.score=d.confidence*100;s.atr=d.atr;
   s.sig="ASTRA_REFERENCE_TRADER";s.valid=true;
   S.id="ASTRA|"+d.triggerId;S.extreme=d.invalidationPrice;S.triggerPrice=0;S.triggerBarTime=0;
   S.armedAt=TimeCurrent();S.bosKind="ASTRA_MACHINE_DECISION";
   g_astraSubmitting=true;Start(s,"ASTRA");g_astraSubmitting=false;
   if(campState==CAMP_IDLE)S=nativeSetup;
   else
     {
      g_astraCampaignInvalidation=d.invalidationPrice;g_astraLastApplied=d.decisionId;
      AstraEvent(campState==CAMP_SUBMITTING?"ASTRA_SUBMITTING":"ASTRA_ENTRY");SaveState();
     }
   return true;
  }

bool AstraManage()
  {
   if(strategyOwner!="ASTRA")return false;
   if(!g_astraAvailable||IsTester()||!InpAstraBridge)
     {AstraTakeover(g_astraFallback==""?"AI_UNAVAILABLE":g_astraFallback);return false;}
   // The brain supplied this thesis boundary. The body can enforce its crossing
   // immediately, including while an inference is pending. Native-owned campaigns
   // never use this additional strategy condition.
   MqlTick live;
   if(g_astraCampaignInvalidation>0&&SymbolInfoTick(_Symbol,live)&&
      (campDir>0?live.bid<=g_astraCampaignInvalidation:live.ask>=g_astraCampaignInvalidation))
     {AstraEvent("ASTRA_INVALID","LIVE_THESIS_BOUNDARY_RECLAIMED");RequestClose("ASTRA_INVALID","LIVE_THESIS_BOUNDARY_RECLAIMED");return true;}
   if(g_astraPending||!g_astraDecision.valid)return true;
   AstraDecision d=g_astraDecision;
   if(d.decisionId==g_astraLastApplied)return true;
   if(d.expectedCampaignId!=campId||d.expectedLayers!=layers||d.direction!=(campDir>0?"BUY":"SELL"))
     {AstraFail("CAMPAIGN_PREFIX_CHANGED");return false;}
   if(AstraNowMs()>d.expiresAtMs||GetTickCount64()-g_astraPendingSince>8000)
     {AstraFail("STALE_DECISION");return false;}
   if(d.thesisValid&&d.invalidationPrice>0)
     {
      double tightened=g_astraCampaignInvalidation<=0?d.invalidationPrice:
                       campDir>0?MathMax(g_astraCampaignInvalidation,d.invalidationPrice):MathMin(g_astraCampaignInvalidation,d.invalidationPrice);
      if(tightened!=g_astraCampaignInvalidation){g_astraCampaignInvalidation=tightened;SaveState();}
     }
   if(d.action=="EXIT"||d.state=="INVALID"||!d.thesisValid)
     {
      g_astraLastApplied=d.decisionId;AstraEvent(d.state=="INVALID"?"ASTRA_INVALID":"ASTRA_EXIT");
      RequestClose("ASTRA_THESIS_EXIT","REFERENCE_TRADER_THESIS_INVALIDATED");return true;
     }
   if(d.action=="STOP_ADDING")
     {g_astraStopAdding=true;g_astraLastApplied=d.decisionId;SaveState();AstraEvent("ASTRA_STOP_ADDING");return true;}
   if(d.action=="REDUCE")
     {
      // Policy: remove newest non-master leg in full. The model never computes
      // broker lots; master/remaining campaign keep all existing protections.
      ulong newest=0;long newestTime=0;
      for(int i=0;i<PositionsTotal();i++)
        {
         ulong t=PositionGetTicket(i);if(!t||t==masterTicket||!IsOurPosition(t))continue;
         long time=PositionGetInteger(POSITION_TIME_MSC);if(time>=newestTime){newest=t;newestTime=time;}
        }
      // One attempt per decision: never retry a stale REDUCE into a changed market.
      // Adds stop regardless; the event reports only what the broker confirmed.
      g_astraStopAdding=true;g_astraLastApplied=d.decisionId;SaveState();
      if(newest==0){AstraEvent("ASTRA_STOP_ADDING","REDUCE_SOLE_MASTER_STOP_ADDING");return true;}
      trade.SetExpertMagicNumber(InpMagic);
      bool sent=trade.PositionClose(newest);
      uint rc=trade.ResultRetcode();
      bool closed=sent&&(rc==TRADE_RETCODE_DONE||rc==TRADE_RETCODE_DONE_PARTIAL)&&!IsOurPosition(newest);
      AstraEvent(closed?"ASTRA_REDUCE":"ASTRA_STOP_ADDING",
                 closed?"REDUCE_NEWEST_LEG_BROKER_CONFIRMED":
                 StringFormat("REDUCE_NOT_CONFIRMED_RETCODE_%u_LEG_REMAINS_PROTECTED",rc));
      return true;
     }
   if(d.action!="ADD")
     {g_astraLastApplied=d.decisionId;AstraEvent("ASTRA_HOLD");return true;}
   if(!C.armed||(C.maxLayers>0&&layers>=C.maxLayers))return true;
   if(!AstraSubmissionValid())
     {AstraFail("STALE_OR_CHANGED_MARKET");return false;}
   g_astraStopAdding=false;g_astraSubmitting=true;
   // No native score/BOS/ATR spacing gate on the Astra authority path. Positive
   // basket, fresh event, envelope age/drift, trigger and native
   // broker preflight are rechecked immediately before every submission.
   bool filled=OpenLayer(campDir,d.confidence*100,"ASTRA_WINNER_PROOF",d.invalidationPrice,0,d.atr,0,true);
   g_astraSubmitting=false;
   if(filled)
     {ConsumeTrigger("ASTRA|"+d.triggerId);g_astraLastApplied=d.decisionId;SaveState();AstraEvent("ASTRA_ADD");}
   else if(g_pending.active)
     {
      g_pending.family="ASTRA";g_pending.triggerId="ASTRA|"+d.triggerId;
      g_pending.isFirstEntry=false;g_astraLastApplied=d.decisionId;SaveState();
     }
   return true;
  }
#endif
