//+------------------------------------------------------------------+
//|  XauCloud Apex v3.8.4 "EntryRetest"                               |
//|                                                                   |
//|  Strategy skeleton is still:                                      |
//|      impulse -> liquidity sweep -> rejection -> displacement      |
//|      -> ORIGIN STORED (confirmation is NOT an entry)              |
//|      -> WAIT for the displacement-origin retest                   |
//|      -> ENTER only in the executable origin region                |
//|      -> pyramid adds at EACH ADD'S OWN location while the         |
//|         ORIGINAL campaign invalidation is still intact            |
//|      -> basket exit on target / ratchet / master SL / recovery.   |
//|                                                                   |
//|  v3.8.4 is ENTRY QUALITY only. Sizing, leverage, UNLIMITED        |
//|  allocation, NORMAL 15/50/100, ratchet, master SL and recovery    |
//|  are unchanged from v3.8.2 CapacityTruth.                         |
//+------------------------------------------------------------------+
#property copyright "XauCloud Apex"
#property version   "3.840"
#property strict
#property description "ApexStack: XAUUSD exhaustion/reversal with origin-retest entries and aggressive profit-side pyramiding"

#include <Trade/Trade.mqh>
CTrade trade;

#define APEX_VERSION       "XauCloud-Apex_v3.8.4-EntryRetest"
#define APEX_BUILD_ID      "3.8.4"
#define APEX_MAGIC         8620260903
#define APEX_STATE_SCHEMA  4
#define APEX_CONFIG_SCHEMA 2
#define APEX_SCORE_BASE    25.0    // constant, non-discriminating ranking offset -- see APEX-AUDIT-006
#define APEX_MAX_TRIGGERS  32
#define APEX_EVENTQ_MAX    2048

//====================== enums used by inputs =========================
enum ApexBosMode
  {
   BOS_V371_CLOSE_OR_WICK=0,   // v3.7.1 predicate, unchanged (close break OR 3-bar wick breach + close confirm)
   BOS_CLOSE_BREAK_ONLY=1      // strict: close beyond the previous M1 bar extreme only
  };
enum ApexGateMode
  {
   GATE_SHADOW=0,              // evaluate + report only, never blocks (unvalidated hypothesis)
   GATE_ENFORCE=1              // block the entry
  };

//====================== inputs =======================================
input string InpCloudURL="https://xaucloud.io";        // canonical XauCloud license/heartbeat infrastructure
input string InpApexLicense="";                        // ONLY credential customer enters
input int    InpConfigPollSeconds=8;                   // remote command/config sync
input int    InpCloudTimeoutMs=2500;                   // bounded transport budget per request (APEX-AUDIT-002)
input bool   InpCloudDiagnostics=true;
input int    InpScanMilliseconds=250;
input bool   InpRequireRemoteArm=true;
input long   InpMagic=APEX_MAGIC;

// --- Fallback seeds. Once a config poll (or the last-good local cache) is applied,
// --- C.* is authoritative for every one of these. APEX-AUDIT-012.
input double InpNormalMarginPct=15.0;         // NORMAL L1 confirmation/probe margin %
input double InpNormalL2MarginPct=50.0;       // NORMAL L2 confirmed-add margin %
input double InpNormalL3PlusMarginPct=100.0;  // NORMAL L3+ use up to this % of available margin
input long   InpNormalReferenceLeverage=0;    // NORMAL fallback economic leverage (0=AUTO; used ONLY when the broker margin model is untrustworthy)
input double InpNormalTakeProfitPct=0.0;      // NORMAL hard basket TP %; 0 = disabled
input double InpNormalFixedSLGoldMove=30.0;   // L1 fixed XAU price SL distance; 0 = no broker SL
input bool   InpProfitRatchetEnabled=true;    // Protect basket profit after it reaches trigger
input double InpRatchetTriggerPct=180.0;
input double InpRatchetLockPct=100.0;
input double InpRatchetStepPct=100.0;
input double InpRatchetLockStepPct=100.0;
input bool   InpMasterBreakEvenEnabled=true;
input double InpMasterBreakEvenTriggerPct=50.0;
input bool   InpRecoveryExitEnabled=true;
input double InpRecoveryExitArmPctOfSL=40.0;

// --- APEX-AUDIT-001/003: the setup's OWN level and its OWN configured lifetime decide
// --- executability. No new numeric threshold is introduced by these two.
input bool   InpRejectReclaimedExtreme=true;  // Refuse to submit once the live quote has reclaimed the setup's rejected extreme
input bool   InpRequireFreshTrigger=false;    // TELEMETRY ONLY since v3.8.3: a newer M1 is a retest, not a reject

// --- OWNER DECISION REQUIRED. Astra asked for these gates to EXIST; the numeric values
// --- are unvalidated hypotheses, so they ship disabled / shadow. Enabling them is a
// --- deliberate owner action, never a default.
input ApexGateMode InpEntryExtensionMode=GATE_SHADOW; // trigger->fill distance gate
input double InpMaxEntryExtensionAtr=1.50;            // ...in ATR. Only used when the mode is GATE_ENFORCE.
input int    InpMaxQuoteAgeMs=0;                      // 0 = disabled. >0 rejects a quote older than this at submission.

// --- APEX-AUDIT-006: the confirmation predicate is now explicit and truthfully labelled.
// --- Default preserves the exact v3.7.1 predicate; no entries are removed.
input ApexBosMode InpBosMode=BOS_V371_CLOSE_OR_WICK;

// --- APEX-AUDIT-004/005: add-trigger identity. 1 = one add per distinct confirmed
// --- trigger (the documented rule). Raise it for deliberate, explicit batching.
input int    InpMaxAddsPerTrigger=1;
input bool   InpAddRequireM3=false;           // OWNER DECISION: apply the M3 colour filter to continuation adds too
// OWNER DECISION REQUIRED (default off = v3.7.1): require the M3 colour bar to have
// closed AFTER the sweep. Freshness is always measured and reported either way.
input bool   InpRequireFreshM3=false;

// --- APEX-AUDIT-014. OWNER DECISION REQUIRED: all three ship DISABLED (= v3.7.1).
input double InpMaxBasketLots=0.0;            // 0 = unlimited total basket volume (v3.7.1 behaviour)
input double InpMinMarginLevelPct=0.0;        // 0 = disabled
input double InpMarginReservePct=0.0;         // 0 = disabled; % of free margin never allocated
// Netting accounts cannot represent a multi-layer basket at all (positions merge, so
// masterTicket / per-layer state are meaningless). This is a PLATFORM capability guard,
// not a risk policy: on netting the EA still manages what is open, but will not add.
input bool   InpAllowNettingAccounts=false;

// POST-AUDIT-LIVE-001: when the broker rejects a request for SIZE reasons only
// (no money / invalid volume / volume limit), Apex halves onto the broker's volume grid
// and retries within the same tick rather than discarding a still-valid setup. The
// descent terminates at SYMBOL_VOLUME_MIN; this bound only limits how many probes are
// spent, it is not a lot cap.
input int    InpMaxSizingAttempts=10;

// --- APEX-AUDIT-010/027 operational correctness
input int    InpCloseStallWarnSeconds=300;    // Telemetry only: warn if still CLOSING after this long. Never abandons the close.
input bool   InpSingleInstanceLock=true;      // Only one manager per account+symbol+magic; the loser becomes observer-only

//====================== configuration ================================
struct Config
  {
   bool     armed;
   string   account,symbolContains,targetMode,accountProfile;
   double   targetEquity,targetMultiplier,normalTargetProfitPct,baseMarginPct,layerMultiplier;
   int      maxLayers;
   double   entryScore,addScore,impulseAtr,sweepAtr,addSpacingAtr,rejectionZoneAtr;
   int      rejectionBars,watchExpiryMinutes,cooldownMinutes;
   bool     requireM3Confirm,requireM5Context,learningEnabled;
   double   learnEntryAdj,learnAddAdj;
   // APEX-AUDIT-012: dashboard-only in v3.7.1, now genuinely consumed by the runtime.
   double   normalL1MarginPct,normalL2MarginPct,normalL3PlusMarginPct,normalFixedSLGoldMove;
   // v3.8.2: the economic leverage NORMAL falls back to when the broker/terminal reports a
   // pathological margin model (e.g. 1:2000000000 with marginAt1Lot=0). 0 = AUTO, which is
   // only legal while the broker model IS trustworthy. Never used to choose the profile.
   long     normalReferenceLeverage;
   bool     profitRatchetEnabled;
   double   ratchetTriggerPct,ratchetLockPct,ratchetStepPct,ratchetLockStepPct;
   bool     masterBreakEvenEnabled;
   double   masterBreakEvenTriggerPct;
   bool     recoveryExitEnabled;
   double   recoveryExitArmPctOfSL;
   // APEX-AUDIT-014 owner exposure controls (0 = disabled)
   double   maxBasketLots,minMarginLevelPct,marginReservePct;
   long     revision;
   string   configHash;
  };

// APEX-AUDIT-028: the policy the campaign was STARTED under. Frozen for the campaign's
// lifetime except for changes that can only TIGHTEN protection.
struct Policy
  {
   string   accountProfile;
   double   targetEq;
   bool     profitRatchetEnabled;
   double   ratchetTriggerPct,ratchetLockPct,ratchetStepPct,ratchetLockStepPct;
   bool     masterBreakEvenEnabled;
   double   masterBreakEvenTriggerPct;
   bool     recoveryExitEnabled;
   double   recoveryExitArmPctOfSL;
   double   normalFixedSLGoldMove;
  };

Config C;
Policy P;

//====================== structural JSON parser =======================
// APEX-AUDIT-016/019: v3.7.1 used a substring scan. `"armed":` matched inside nested
// objects, inside string values and inside longer key names, and any token shape was
// silently coerced to any requested type. This is a real top-level object scanner that
// records each value's TOKEN TYPE, so a wrong type is a protocol error, not a coercion.
string g_jkey[]; string g_jval[]; ushort g_jtype[]; int g_jcount=0;

string trim(string s){StringTrimLeft(s);StringTrimRight(s);return s;}

int JsonSkipWs(const string j,int p)
  {
   int n=StringLen(j);
   while(p<n)
     {
      ushort c=StringGetCharacter(j,p);
      if(c==' '||c=='\t'||c=='\r'||c=='\n') p++; else break;
     }
   return p;
  }

int JsonReadString(const string j,int p,string &out)
  {
   int n=StringLen(j);
   if(p>=n||StringGetCharacter(j,p)!='"') return -1;
   p++; out="";
   while(p<n)
     {
      ushort c=StringGetCharacter(j,p);
      if(c=='"') return p+1;
      if(c=='\\')
        {
         p++;
         if(p>=n) return -1;
         ushort e=StringGetCharacter(j,p);
         if(e=='n') out+="\n";
         else if(e=='t') out+="\t";
         else if(e=='r') out+="\r";
         else if(e=='u')
           {
            if(p+4>=n) return -1;
            int code=(int)StringToInteger("0x"+StringSubstr(j,p+1,4));
            out+=ShortToString((ushort)code);
            p+=4;
           }
         else out+=ShortToString(e);
         p++;
         continue;
        }
      out+=ShortToString(c);
      p++;
     }
   return -1;
  }

bool JsonIsNumberToken(const string t)
  {
   int n=StringLen(t);
   if(n<=0) return false;
   int i=0; bool digits=false;
   if(StringGetCharacter(t,i)=='-') i++;
   while(i<n && StringGetCharacter(t,i)>='0' && StringGetCharacter(t,i)<='9'){i++;digits=true;}
   if(i<n && StringGetCharacter(t,i)=='.')
     {
      i++; bool frac=false;
      while(i<n && StringGetCharacter(t,i)>='0' && StringGetCharacter(t,i)<='9'){i++;frac=true;}
      if(!frac) return false;
     }
   if(i<n && (StringGetCharacter(t,i)=='e'||StringGetCharacter(t,i)=='E'))
     {
      i++;
      if(i<n && (StringGetCharacter(t,i)=='+'||StringGetCharacter(t,i)=='-')) i++;
      bool ex=false;
      while(i<n && StringGetCharacter(t,i)>='0' && StringGetCharacter(t,i)<='9'){i++;ex=true;}
      if(!ex) return false;
     }
   return digits && i==n;
  }

int JsonReadValue(const string j,int p,string &out,ushort &type)
  {
   int n=StringLen(j);
   p=JsonSkipWs(j,p);
   if(p>=n) return -1;
   ushort c=StringGetCharacter(j,p);
   if(c=='"'){type='s';return JsonReadString(j,p,out);}
   if(c=='{'||c=='[')
     {
      type=(c=='{')?'o':'a';
      int depth=0,start=p;
      while(p<n)
        {
         ushort x=StringGetCharacter(j,p);
         if(x=='"'){string tmp;int q=JsonReadString(j,p,tmp);if(q<0)return -1;p=q;continue;}
         if(x=='{'||x=='[') depth++;
         else if(x=='}'||x==']')
           {
            depth--;
            if(depth==0){out=StringSubstr(j,start,p-start+1);return p+1;}
           }
         p++;
        }
      return -1;
     }
   int s=p;
   while(p<n)
     {
      ushort x=StringGetCharacter(j,p);
      if(x==','||x=='}'||x==']'||x==' '||x=='\t'||x=='\r'||x=='\n') break;
      p++;
     }
   out=StringSubstr(j,s,p-s);
   if(out=="true"||out=="false") type='b';
   else if(out=="null") type='z';
   else if(JsonIsNumberToken(out)) type='n';
   else return -1;                     // unquoted garbage is a protocol error
   return p;
  }

bool JsonParseObject(const string j)
  {
   g_jcount=0;
   ArrayResize(g_jkey,0); ArrayResize(g_jval,0); ArrayResize(g_jtype,0);
   int n=StringLen(j),p=JsonSkipWs(j,0);
   if(p>=n||StringGetCharacter(j,p)!='{') return false;
   p++; p=JsonSkipWs(j,p);
   if(p<n && StringGetCharacter(j,p)=='}') return true;
   while(p<n)
     {
      string k=""; p=JsonSkipWs(j,p);
      int q=JsonReadString(j,p,k);
      if(q<0) return false;
      p=JsonSkipWs(j,q);
      if(p>=n||StringGetCharacter(j,p)!=':') return false;
      p++;
      string v=""; ushort t=0;
      q=JsonReadValue(j,p,v,t);
      if(q<0) return false;
      p=JsonSkipWs(j,q);
      int idx=g_jcount++;
      ArrayResize(g_jkey,g_jcount); ArrayResize(g_jval,g_jcount); ArrayResize(g_jtype,g_jcount);
      g_jkey[idx]=k; g_jval[idx]=v; g_jtype[idx]=t;
      if(p<n && StringGetCharacter(j,p)==','){p++;continue;}
      if(p<n && StringGetCharacter(j,p)=='}') return true;
      return false;
     }
   return false;
  }

int  JIdx(const string k){for(int i=0;i<g_jcount;i++) if(g_jkey[i]==k) return i; return -1;}
bool JHas(const string k){return JIdx(k)>=0;}
bool JBoolStrict(const string k,bool &out)
  {int i=JIdx(k); if(i<0||g_jtype[i]!='b') return false; out=(g_jval[i]=="true"); return true;}
bool JNumStrict(const string k,double &out)
  {int i=JIdx(k); if(i<0||g_jtype[i]!='n') return false; out=StringToDouble(g_jval[i]); return true;}
bool JStrStrict(const string k,string &out)
  {int i=JIdx(k); if(i<0||g_jtype[i]!='s') return false; out=g_jval[i]; return true;}
// Lenient variants: used ONLY for reading our own state/cache files, never for
// validating a remote protocol payload.
double JNumOr(const string k,double d){double v;return JNumStrict(k,v)?v:d;}
bool   JBoolOr(const string k,bool d){bool v;return JBoolStrict(k,v)?v:d;}
string JStrOr(const string k,string d){string v;return JStrStrict(k,v)?v:d;}

// "present but wrong type" is reported by the caller via g_cfgTypeErrors; absent keeps current.
int g_cfgTypeErrors=0; string g_cfgTypeErrorList="";
void NoteTypeError(const string k){g_cfgTypeErrors++; if(StringLen(g_cfgTypeErrorList)<200) g_cfgTypeErrorList+=(g_cfgTypeErrorList==""?"":",")+k;}
double CfgNum(const string k,double cur)
  {double v; if(JNumStrict(k,v)) return v; if(JHas(k)) NoteTypeError(k); return cur;}
bool CfgBool(const string k,bool cur)
  {bool v; if(JBoolStrict(k,v)) return v; if(JHas(k)) NoteTypeError(k); return cur;}
string CfgStr(const string k,string cur)
  {string v; if(JStrStrict(k,v)) return v; if(JHas(k)) NoteTypeError(k); return cur;}

//====================== runtime state ================================
// APEX-AUDIT-010: a campaign is never "not a campaign" while it still owns positions.
enum CampState { CAMP_IDLE=0, CAMP_ACTIVE=1, CAMP_CLOSING=2 };
// APEX-AUDIT-003: an explicit setup lifecycle instead of one frozen boolean.
enum SetupState { SETUP_NONE=0, SETUP_WATCHING=1, SETUP_CONFIRMED=2, SETUP_INVALIDATED=3, SETUP_EXPIRED=4, SETUP_CONSUMED=5 };
// APEX-AUDIT-008: a broker request outcome is not a Boolean.
enum ExecClass { EXEC_NONE=0, EXEC_FILLED=1, EXEC_PARTIAL=2, EXEC_PENDING=3, EXEC_REJECTED=4, EXEC_UNCONFIRMED=5 };

struct ExecResult
  {
   ExecClass cls;
   uint      retcode;
   ulong     deal,order,position;
   double    requestedVolume,filledVolume,fillPrice;
   int       mt5Error;
   string    detail;
  };

struct Setup
  {
   SetupState state;
   string     id,sig,cancelReason;
   int        dir;
   datetime   armedAt,sweepBarTime,confirmedAt,triggerBarTime;
   double     extreme,prior,atr,triggerPrice;
   string     bosKind;
   double     originHigh,originLow,originClose,originOpen;
   datetime   originBarTime;
   double     execHigh,execLow;
   bool       dead;
   string     deadReason;
  };

struct Snap
  {
   bool   valid;
   int    dir;
   double score,atr,price,extreme,impulseMult,sweepMult,wickRatio;
   bool   swept,rejected,microBreak,m3Color,m5Color,m3Fresh;
   bool   continuation,pullbackFail;
   string sig,reason,bosKind;
   datetime triggerBarTime;
   double triggerPrice;
   double originHigh,originLow,originClose,originOpen;
   datetime originBarTime;
   double execHigh,execLow;
   bool   inLocation,locationNow;
  };

struct AddCandidate
  {
   bool     addEligible;
   string   family;        // "REVERSAL" | "CONTINUATION" | "FAILED_PULLBACK"
   double   score,atr;
   string   reason,triggerId;
   datetime triggerBarTime;
   int      dir;
   double   execHigh,execLow,triggerPrice;
  };

int      hAtr=INVALID_HANDLE;
datetime lastCfg=0,lastEnd=0;

CampState campState=CAMP_IDLE;
int      campDir=0,layers=0;
double   cycleStart=0,targetEq=0,lastAdd=0,mfe=0,mae=0,peakProfitPct=0;
double   earnedFloorPct=0;               // APEX-AUDIT-013: monotonic, persisted
bool     ratchetArmed=false;
double   firstEntryPrice=0,firstSLPrice=0,firstInitialSLPrice=0;
bool     recoveryExitArmed=false;
bool     anchorsKnown=true;              // APEX-AUDIT-011: false => historical anchors unknown
ulong    masterTicket=0;
int      masterGuardStage=0;
datetime campStart=0;
string   campId="",campSig="";
double   campInvalidLevel=0,campOriginHigh=0,campOriginLow=0,campOriginClose=0;
datetime campOriginBar=0;
datetime g_noRearmBeforeBar=0;
int      g_noRearmDir=0;
// Dead-thesis identity: the SAME failed run cannot reincarnate as a "new" setup
// just because the next M1 printed a slightly higher high. Cleared only by a
// genuine opposite impulse (new displacement cycle), never by a time cooldown.
bool     g_deadThesisActive=false;
int      g_deadThesisDir=0;
double   g_deadThesisExtreme=0,g_deadThesisPrior=0;
datetime g_deadThesisSweep=0;
// APEX-AUDIT-010 closing intent
string   closingOutcome="",closingReason="";
datetime closingSince=0;
int      closeAttempts=0;

Setup    S;                              // the single active setup slot
string   consumedTriggers[];             // APEX-AUDIT-004
int      consumedCount=0;

bool     g_observerOnly=false;           // APEX-AUDIT-027
string   g_instanceId="";
string   g_preflightBlock="";            // non-empty => new exposure refused, protection continues

// --- cloud link state ---
bool     g_cloudEverValidated=false;
bool     g_cloudUsingCache=false;
bool     g_cloudExplicitDenied=false;
string   g_cloudDeniedReason="";
int      g_cloudConsecutiveFails=0;
long     g_cloudLastCommandRevision=0;
datetime g_cloudLastOk=0;
string   g_cloudLastStatus="NEVER_CONNECTED";
string   g_cloudProtocolError="";

// --- risk-loop instrumentation (APEX-AUDIT-002) ---
ulong    g_lastManageTickMs=0;
ulong    g_maxRiskLoopGapMs=0;
ulong    g_lastNetworkMs=0;

// --- v3.8.1 LIVE-READY operational state -----------------------------
// A broker/session MARKET_CLOSED response is not a strategy rejection. Keep the
// setup/campaign intact, stop hammering the trade server every 250ms, then retry.
datetime g_marketClosedRetryAt=0;
int      g_marketClosedBackoffSec=0;

bool IsTester(){return (bool)MQLInfoInteger(MQL_TESTER);}
double clamp(double x,double a,double b){return MathMax(a,MathMin(b,x));}
string BoolJson(bool v){return v?"true":"false";}
string NormalizeLicense(string s){s=trim(s);StringToUpper(s);StringReplace(s," ","");return s;}

uint Fnv1a(const string s)
  {
   uint h=2166136261;
   for(int i=0;i<StringLen(s);i++){h^=(uint)StringGetCharacter(s,i);h*=16777619;}
   return h;
  }
uint LicenseHash(){return Fnv1a(NormalizeLicense(InpApexLicense));}

// APEX-AUDIT-011/027: identity is account + broker + symbol + magic, never magic alone.
string OwnerKey()
  {
   return StringFormat("%I64d_%u_%s_%I64d",
      AccountInfoInteger(ACCOUNT_LOGIN),
      Fnv1a(AccountInfoString(ACCOUNT_COMPANY)+"|"+AccountInfoString(ACCOUNT_SERVER)),
      _Symbol,InpMagic);
  }
string StateFile(){return "ApexState_"+OwnerKey()+".json";}
string ConfigCacheFile(){return StringFormat("ApexConfig_%I64d_%u.json",AccountInfoInteger(ACCOUNT_LOGIN),LicenseHash());}

//====================== atomic, checksummed file IO ===================
// APEX-AUDIT-011/020: write to a unique temp file, then rename. A truncated or
// corrupted payload is an explicit failure, never a silently empty state.
bool WriteFileAtomic(const string target,const string payload)
  {
   string tmp=target+".tmp"+IntegerToString((int)GetTickCount());
   int h=FileOpen(tmp,FILE_WRITE|FILE_TXT|FILE_ANSI);
   if(h==INVALID_HANDLE) return false;
   string framed=StringFormat("{\"checksum\":%u,\"payload\":%s}",Fnv1a(payload),payload);
   FileWriteString(h,framed);
   FileClose(h);
   FileDelete(target);
   if(!FileMove(tmp,0,target,FILE_REWRITE)){FileDelete(tmp);return false;}
   return true;
  }
// Returns: 1 ok, 0 missing, -1 corrupt/unreadable (explicitly distinguished).
int ReadFileChecked(const string target,string &payload)
  {
   payload="";
   if(!FileIsExist(target)) return 0;
   int h=FileOpen(target,FILE_READ|FILE_TXT|FILE_ANSI);
   if(h==INVALID_HANDLE) return -1;
   string raw="";
   while(!FileIsEnding(h)) raw+=FileReadString(h);
   FileClose(h);
   if(StringLen(raw)==0) return -1;
   if(!JsonParseObject(raw)) return -1;
   double sum=0; string inner="";
   if(!JNumStrict("checksum",sum)) return -1;
   int i=JIdx("payload");
   if(i<0||g_jtype[i]!='o') return -1;
   inner=g_jval[i];
   if((uint)sum!=Fnv1a(inner)) return -1;
   payload=inner;
   return 1;
  }

//====================== consumed-trigger ledger (APEX-AUDIT-004) ======
bool TriggerConsumed(const string id)
  {
   for(int i=0;i<consumedCount;i++) if(consumedTriggers[i]==id) return true;
   return false;
  }
int TriggerUseCount(const string id)
  {
   int n=0; for(int i=0;i<consumedCount;i++) if(consumedTriggers[i]==id) n++;
   return n;
  }
void ConsumeTrigger(const string id)
  {
   if(consumedCount>=APEX_MAX_TRIGGERS)
     {
      for(int i=0;i<consumedCount-1;i++) consumedTriggers[i]=consumedTriggers[i+1];
      consumedCount--;
     }
   ArrayResize(consumedTriggers,consumedCount+1);
   consumedTriggers[consumedCount++]=id;
  }
void ClearTriggers(){consumedCount=0;ArrayResize(consumedTriggers,0);}
string TriggersJson()
  {
   string s="[";
   for(int i=0;i<consumedCount;i++){if(i>0)s+=",";s+="\""+consumedTriggers[i]+"\"";}
   return s+"]";
  }
void TriggersFromJson(const string arr)
  {
   ClearTriggers();
   int n=StringLen(arr),p=0;
   while(p<n)
     {
      if(StringGetCharacter(arr,p)=='"')
        {
         string v; int q=JsonReadString(arr,p,v);
         if(q<0) return;
         ConsumeTrigger(v); p=q; continue;
        }
      p++;
     }
  }

//====================== single-instance lease (APEX-AUDIT-027) ========
// Terminal-scoped lease. Two Apex instances on the same account+symbol+magic cannot
// both manage the basket; the loser runs observer-only and never submits an order.
string LockVar(){return "APXLK_"+OwnerKey();}
string OwnVar(){return "APXOW_"+OwnerKey();}
#define APEX_LEASE_SECONDS 30

bool AcquireOrRefreshLease()
  {
   if(!InpSingleInstanceLock) return true;
   double owner=0,ts=0;
   double me=(double)Fnv1a(g_instanceId);
   bool haveOwner=GlobalVariableCheck(OwnVar());
   bool haveTs=GlobalVariableCheck(LockVar());
   if(haveOwner) owner=GlobalVariableGet(OwnVar());
   if(haveTs)    ts=GlobalVariableGet(LockVar());
   datetime now=TimeCurrent();
   bool stale=(!haveTs)||((double)now-ts>APEX_LEASE_SECONDS);
   if(!haveOwner||stale||owner==me)
     {
      GlobalVariableSet(OwnVar(),me);
      GlobalVariableSet(LockVar(),(double)now);
      return true;
     }
   return false;
  }
void ReleaseLease()
  {
   if(!InpSingleInstanceLock) return;
   if(GlobalVariableCheck(OwnVar())&&GlobalVariableGet(OwnVar())==(double)Fnv1a(g_instanceId))
     {GlobalVariableDel(OwnVar());GlobalVariableDel(LockVar());}
  }

//====================== bounded transport + local event queue =========
// APEX-AUDIT-002. HONEST STATEMENT OF THE LIMITATION: MQL5 runs OnTimer,
// OnTick and OnTradeTransaction on ONE terminal thread. A second handler in the
// same EA is NOT asynchronous, and v3.7.1's comments implying otherwise were wrong.
// What v3.8.0 actually does:
//   * every telemetry Emit() is queued and durably persisted locally; it performs no network request;
//   * the queue is drained at most ONE request per timer tick, and only after
//     Manage() (protection/closing) has already run this tick;
//   * no network call happens between the entry decision and the order submit --
//     and the executable-price gate is re-evaluated immediately before submit
//     regardless, so any preceding delay cannot authorise a stale entry;
//   * the risk-loop gap is measured and reported instead of assumed.
// A genuinely off-thread transport needs a separate terminal component; that is NOT
// implemented here and is recorded as an outstanding limitation.
string g_eventQ[]; int g_eventQHead=0,g_eventQCount=0;

// v3.8.2 CAPACITY-TRUTH: event delivery is a durable local outbox.  The EA may keep
// trading through a transient WebRequest failure, but WATCH_ARMED/LAYER_OPEN/
// CAMPAIGN_END must survive terminal restart instead of living only in RAM.
string EventQueueFile(){return "ApexEventQueue_"+OwnerKey()+".ndjson";}

bool PersistEventQueue()
  {
   if(IsTester()) return true;
   string target=EventQueueFile();
   string tmp=target+".tmp"+IntegerToString((int)GetTickCount());
   int h=FileOpen(tmp,FILE_WRITE|FILE_TXT|FILE_ANSI);
   if(h==INVALID_HANDLE) return false;
   for(int i=0;i<g_eventQCount;i++)
     {
      int idx=(g_eventQHead+i)%APEX_EVENTQ_MAX;
      FileWriteString(h,g_eventQ[idx]+"\r\n");
     }
   FileFlush(h);FileClose(h);
   FileDelete(target);
   if(!FileMove(tmp,0,target,FILE_REWRITE)){FileDelete(tmp);return false;}
   return true;
  }

void LoadEventQueue()
  {
   if(IsTester()) return;
   g_eventQHead=0;g_eventQCount=0;
   ArrayResize(g_eventQ,APEX_EVENTQ_MAX);
   int h=FileOpen(EventQueueFile(),FILE_READ|FILE_TXT|FILE_ANSI);
   if(h==INVALID_HANDLE) return;
   while(!FileIsEnding(h)&&g_eventQCount<APEX_EVENTQ_MAX)
     {
      string line=trim(FileReadString(h));
      if(line=="") continue;
      g_eventQ[g_eventQCount++]=line;
     }
   FileClose(h);
   if(g_eventQCount>0) PrintFormat("APEX DURABLE EVENT OUTBOX RESTORED | pending=%d",g_eventQCount);
  }

void QueueEvent(const string body)
  {
   if(g_eventQCount>=APEX_EVENTQ_MAX)
     {
      // Keep trading independent, but make telemetry loss loud and deterministic.
      Print("APEX EVENT OUTBOX FULL | dropping oldest telemetry record");
      g_eventQHead=(g_eventQHead+1)%APEX_EVENTQ_MAX;
      g_eventQCount--;
     }
   if(ArraySize(g_eventQ)<APEX_EVENTQ_MAX) ArrayResize(g_eventQ,APEX_EVENTQ_MAX);
   g_eventQ[(g_eventQHead+g_eventQCount)%APEX_EVENTQ_MAX]=body;
   g_eventQCount++;
   if(!PersistEventQueue()) Print("APEX EVENT OUTBOX WRITE FAILED | event remains in RAM");
  }

bool Http(string method,string ep,string body,string &resp,int &httpCode,int &mt5Err)
  {
   resp="";httpCode=0;mt5Err=0;
   if(IsTester())return false;
   char d[],r[];string rh;
   string hdr="Content-Type: application/json\r\nAccept: application/json\r\n";
   StringToCharArray(body,d,0,StringLen(body),CP_UTF8);
   ResetLastError();
   ulong t0=GetTickCount64();
   httpCode=WebRequest(method,InpCloudURL+ep,hdr,InpCloudTimeoutMs,d,r,rh);
   g_lastNetworkMs=GetTickCount64()-t0;
   mt5Err=GetLastError();
   if(httpCode>=0)resp=CharArrayToString(r,0,-1,CP_UTF8);
   return httpCode>=200&&httpCode<300;
  }

void CloudFailure(string label,int code,int err,string response)
  {
   g_cloudConsecutiveFails++;
   if(InpCloudDiagnostics)
      Print("APEX CLOUD ",label," FAILED | url=",InpCloudURL,
            " | http=",code," mt5err=",err,
            " | consecutiveFails=",g_cloudConsecutiveFails,
            " | response=",StringSubstr(response,0,300),
            " | MONITOR/CONTROL ONLY; trading uses last validated local config");
  }
void CloudSuccess(){g_cloudConsecutiveFails=0;g_cloudLastOk=TimeCurrent();g_cloudLastStatus="CONNECTED";}

double BasketProfitFloating();
double BasketVolume();
int    CountPos();

// APEX-AUDIT-018: report real terminal/broker readiness and real financials.
string TelemetryCommon()
  {
   return StringFormat(
     "\"account\":\"%I64d\",\"broker\":\"%s\",\"server\":\"%s\",\"currency\":\"%s\",\"symbol\":\"%s\","
     "\"version\":\"%s\",\"buildId\":\"%s\",\"campaignId\":\"%s\",\"signature\":\"%s\",\"direction\":%d,"
     "\"layers\":%d,\"campaignState\":\"%s\",\"openPositions\":%d,\"basketVolume\":%.4f,"
     "\"balance\":%.2f,\"equity\":%.2f,\"freeMargin\":%.2f,\"marginLevel\":%.2f,"
     "\"terminalConnected\":%s,\"terminalTradeAllowed\":%s,\"eaTradeAllowed\":%s,\"symbolTradeMode\":%d,"
     "\"appliedRevision\":%I64d,\"configHash\":\"%s\",\"observerOnly\":%s,\"preflightBlock\":\"%s\","
     "\"anchorsKnown\":%s,\"riskLoopMaxGapMs\":%I64u",
     AccountInfoInteger(ACCOUNT_LOGIN),AccountInfoString(ACCOUNT_COMPANY),AccountInfoString(ACCOUNT_SERVER),
     AccountInfoString(ACCOUNT_CURRENCY),_Symbol,APEX_VERSION,APEX_BUILD_ID,campId,campSig,campDir,
     layers,(campState==CAMP_CLOSING?"CLOSING":campState==CAMP_ACTIVE?"ACTIVE":"IDLE"),CountPos(),BasketVolume(),
     AccountInfoDouble(ACCOUNT_BALANCE),AccountInfoDouble(ACCOUNT_EQUITY),AccountInfoDouble(ACCOUNT_MARGIN_FREE),
     AccountInfoDouble(ACCOUNT_MARGIN_LEVEL),
     BoolJson((bool)TerminalInfoInteger(TERMINAL_CONNECTED)),
     BoolJson((bool)TerminalInfoInteger(TERMINAL_TRADE_ALLOWED)),
     BoolJson((bool)MQLInfoInteger(MQL_TRADE_ALLOWED)),
     (int)SymbolInfoInteger(_Symbol,SYMBOL_TRADE_MODE),
     g_cloudLastCommandRevision,C.configHash,BoolJson(g_observerOnly),g_preflightBlock,
     BoolJson(anchorsKnown),g_maxRiskLoopGapMs);
  }

// Emit() performs no NETWORK I/O. v3.8.2 durably appends the local event outbox before returning.
void Emit(string type,string extra="")
  {
   if(IsTester())return;
   string b=StringFormat("{\"license_key\":\"%s\",\"type\":\"%s\",\"eventId\":\"%s-%I64u-%u\",\"emittedAt\":%I64d,%s%s}",
      NormalizeLicense(InpApexLicense),type,g_instanceId,GetTickCount64(),(uint)MathRand(),
      (long)TimeCurrent(),TelemetryCommon(),extra);
   QueueEvent(b);
  }

// Drains AT MOST ONE queued event per call. Called only after protection has run.
void FlushEventQueue()
  {
   if(IsTester()||g_eventQCount<=0) return;
   string b=g_eventQ[g_eventQHead];
   string r;int code=0,err=0;
   if(Http("POST","/api/cloud/apex/event",b,r,code,err))
     {g_eventQHead=(g_eventQHead+1)%APEX_EVENTQ_MAX;g_eventQCount--;PersistEventQueue();CloudSuccess();}
   else
     {
      CloudFailure("EVENT",code,err,r);
      // 4xx other than 429 means the server will never accept this body: drop it
      // rather than head-of-line blocking the whole queue forever.
      if(code>=400&&code<500&&code!=429){g_eventQHead=(g_eventQHead+1)%APEX_EVENTQ_MAX;g_eventQCount--;PersistEventQueue();}
     }
  }

void AckCommand(long revision,string status)
  {
   if(IsTester()||revision<=0)return;
   string b=StringFormat("{\"license_key\":\"%s\",\"account\":\"%I64d\",\"type\":\"COMMAND_ACK\","
      "\"eventId\":\"ack-%s-%I64d\",\"revision\":%I64d,\"status\":\"%s\",\"appliedRevision\":%I64d,"
      "\"eaVersion\":\"%s\",\"buildId\":\"%s\",\"configHash\":\"%s\"}",
      NormalizeLicense(InpApexLicense),AccountInfoInteger(ACCOUNT_LOGIN),g_instanceId,revision,
      revision,status,g_cloudLastCommandRevision,APEX_VERSION,APEX_BUILD_ID,C.configHash);
   QueueEvent(b);
  }

//====================== config: defaults / cache / apply ==============
void Defaults()
  {
   C.armed=!InpRequireRemoteArm;C.account="0";C.symbolContains="XAUUSD";C.targetMode="MULTIPLIER";
   C.accountProfile="NORMAL";C.targetEquity=1000;C.targetMultiplier=100;
   C.normalTargetProfitPct=InpNormalTakeProfitPct;
   C.profitRatchetEnabled=InpProfitRatchetEnabled;
   C.ratchetTriggerPct=InpRatchetTriggerPct;
   C.ratchetLockPct=InpRatchetLockPct;
   C.ratchetStepPct=InpRatchetStepPct;
   C.ratchetLockStepPct=InpRatchetLockStepPct;
   // APEX-AUDIT-012: seeded from the matching Input so a cold EA / Strategy Tester run
   // behaves exactly as the compiled Inputs say; a successful poll then overrides.
   C.normalL1MarginPct=InpNormalMarginPct;
   C.normalL2MarginPct=InpNormalL2MarginPct;
   C.normalL3PlusMarginPct=InpNormalL3PlusMarginPct;
   C.normalReferenceLeverage=(InpNormalReferenceLeverage>0?InpNormalReferenceLeverage:0);
   C.normalFixedSLGoldMove=InpNormalFixedSLGoldMove;
   C.masterBreakEvenEnabled=InpMasterBreakEvenEnabled;
   C.masterBreakEvenTriggerPct=InpMasterBreakEvenTriggerPct;
   C.recoveryExitEnabled=InpRecoveryExitEnabled;
   C.recoveryExitArmPctOfSL=InpRecoveryExitArmPctOfSL;
   C.maxBasketLots=InpMaxBasketLots;
   C.minMarginLevelPct=InpMinMarginLevelPct;
   C.marginReservePct=InpMarginReservePct;
   C.baseMarginPct=100;C.layerMultiplier=2;C.maxLayers=0;C.entryScore=76;C.addScore=70;
   C.impulseAtr=1.8;C.sweepAtr=.05;C.rejectionBars=5;C.watchExpiryMinutes=12;
   C.addSpacingAtr=.22;C.rejectionZoneAtr=.12;C.cooldownMinutes=0;C.requireM3Confirm=true;
   C.requireM5Context=false;C.learningEnabled=true;C.learnEntryAdj=0;C.learnAddAdj=0;
   C.revision=0;C.configHash="";
  }

string ConfigCanonical(const Config &x)
  {
   return StringFormat(
     "%s|%s|%s|%s|%.4f|%.4f|%.4f|%.4f|%.4f|%d|%.4f|%.4f|%.4f|%.4f|%.4f|%.4f|%d|%d|%d|%s|%s|%s|%.4f|%.4f"
     "|%.4f|%.4f|%.4f|%.4f|%s|%.4f|%.4f|%.4f|%.4f|%s|%.4f|%s|%.4f|%.4f|%.4f|%.4f|%I64d",
     BoolJson(x.armed),x.account,x.symbolContains,x.targetMode,x.targetEquity,x.targetMultiplier,
     x.normalTargetProfitPct,x.baseMarginPct,x.layerMultiplier,x.maxLayers,x.entryScore,x.addScore,
     x.impulseAtr,x.sweepAtr,x.addSpacingAtr,x.rejectionZoneAtr,x.rejectionBars,x.watchExpiryMinutes,
     x.cooldownMinutes,BoolJson(x.requireM3Confirm),BoolJson(x.requireM5Context),BoolJson(x.learningEnabled),
     x.learnEntryAdj,x.learnAddAdj,x.normalL1MarginPct,x.normalL2MarginPct,x.normalL3PlusMarginPct,
     x.normalFixedSLGoldMove,BoolJson(x.profitRatchetEnabled),x.ratchetTriggerPct,x.ratchetLockPct,
     x.ratchetStepPct,x.ratchetLockStepPct,BoolJson(x.masterBreakEvenEnabled),x.masterBreakEvenTriggerPct,
     BoolJson(x.recoveryExitEnabled),x.recoveryExitArmPctOfSL,x.maxBasketLots,x.minMarginLevelPct,
     x.marginReservePct,x.normalReferenceLeverage);
  }
string ConfigHash(const Config &x){return StringFormat("%08x",Fnv1a(ConfigCanonical(x)+"|"+x.accountProfile));}

string ConfigToJson(const Config &x)
  {
   return StringFormat(
     "{\"schema\":%d,\"armed\":%s,\"account\":\"%s\",\"symbolContains\":\"%s\",\"targetMode\":\"%s\","
     "\"accountProfile\":\"%s\",\"targetEquity\":%.6f,\"targetMultiplier\":%.6f,\"normalTargetProfitPct\":%.6f,"
     "\"baseMarginPct\":%.6f,\"layerMultiplier\":%.6f,\"maxLayers\":%d,\"entryScore\":%.6f,\"addScore\":%.6f,"
     "\"impulseAtr\":%.6f,\"sweepAtr\":%.6f,\"addSpacingAtr\":%.6f,\"rejectionZoneAtr\":%.6f,"
     "\"rejectionBars\":%d,\"watchExpiryMinutes\":%d,\"cooldownMinutes\":%d,\"requireM3Confirm\":%s,"
     "\"requireM5Context\":%s,\"learningEnabled\":%s,\"entryScoreAdjustment\":%.6f,\"addScoreAdjustment\":%.6f,"
     "\"normalL1MarginPct\":%.6f,\"normalL2MarginPct\":%.6f,\"normalL3PlusMarginPct\":%.6f,"
     "\"normalFixedSLGoldMove\":%.6f,\"profitRatchetEnabled\":%s,\"ratchetTriggerPct\":%.6f,"
     "\"ratchetLockPct\":%.6f,\"ratchetStepPct\":%.6f,\"ratchetLockStepPct\":%.6f,"
     "\"masterBreakEvenEnabled\":%s,\"masterBreakEvenTriggerPct\":%.6f,\"recoveryExitEnabled\":%s,"
     "\"recoveryExitArmPctOfSL\":%.6f,\"maxBasketLots\":%.6f,\"minMarginLevelPct\":%.6f,"
     "\"marginReservePct\":%.6f,\"normalReferenceLeverage\":%I64d,"
     "\"commandRevision\":%I64d,\"denied\":%s,\"deniedReason\":\"%s\"}",
     APEX_CONFIG_SCHEMA,BoolJson(x.armed),x.account,x.symbolContains,x.targetMode,x.accountProfile,
     x.targetEquity,x.targetMultiplier,x.normalTargetProfitPct,x.baseMarginPct,x.layerMultiplier,x.maxLayers,
     x.entryScore,x.addScore,x.impulseAtr,x.sweepAtr,x.addSpacingAtr,x.rejectionZoneAtr,x.rejectionBars,
     x.watchExpiryMinutes,x.cooldownMinutes,BoolJson(x.requireM3Confirm),BoolJson(x.requireM5Context),
     BoolJson(x.learningEnabled),x.learnEntryAdj,x.learnAddAdj,x.normalL1MarginPct,x.normalL2MarginPct,
     x.normalL3PlusMarginPct,x.normalFixedSLGoldMove,BoolJson(x.profitRatchetEnabled),x.ratchetTriggerPct,
     x.ratchetLockPct,x.ratchetStepPct,x.ratchetLockStepPct,BoolJson(x.masterBreakEvenEnabled),
     x.masterBreakEvenTriggerPct,BoolJson(x.recoveryExitEnabled),x.recoveryExitArmPctOfSL,
     x.maxBasketLots,x.minMarginLevelPct,x.marginReservePct,x.normalReferenceLeverage,
     g_cloudLastCommandRevision,BoolJson(g_cloudExplicitDenied),g_cloudDeniedReason);
  }

// APEX-AUDIT-016: cache EVERYTHING, strings and revision included, atomically.
void SaveCloudCache()
  {
   C.configHash=ConfigHash(C);
   if(!WriteFileAtomic(ConfigCacheFile(),ConfigToJson(C)))
      Print("APEX CONFIG CACHE WRITE FAILED | file=",ConfigCacheFile());
  }

// Reads a validated config object (already parsed into the global token table) into `out`.
// Returns false only for a structurally invalid / wrong-schema envelope.
bool ConfigFromParsed(Config &out)
  {
   double sch=0;
   if(JNumStrict("schema",sch) && (int)sch!=APEX_CONFIG_SCHEMA) return false;
   out.armed              =CfgBool("armed",out.armed);
   out.account            =CfgStr("account",out.account);
   out.symbolContains     =CfgStr("symbolContains",out.symbolContains);
   out.targetMode         =CfgStr("targetMode",out.targetMode);
   out.accountProfile     =CfgStr("accountProfile",out.accountProfile);
   out.targetEquity       =CfgNum("targetEquity",out.targetEquity);
   out.targetMultiplier   =CfgNum("targetMultiplier",out.targetMultiplier);
   out.normalTargetProfitPct=CfgNum("normalTargetProfitPct",out.normalTargetProfitPct);
   out.baseMarginPct      =CfgNum("baseMarginPct",out.baseMarginPct);
   out.layerMultiplier    =CfgNum("layerMultiplier",out.layerMultiplier);
   out.maxLayers          =(int)CfgNum("maxLayers",(double)out.maxLayers);
   out.entryScore         =CfgNum("entryScore",out.entryScore);
   out.addScore           =CfgNum("addScore",out.addScore);
   out.impulseAtr         =CfgNum("impulseAtr",out.impulseAtr);
   out.sweepAtr           =CfgNum("sweepAtr",out.sweepAtr);
   out.rejectionBars      =(int)CfgNum("rejectionBars",(double)out.rejectionBars);
   out.watchExpiryMinutes =(int)CfgNum("watchExpiryMinutes",(double)out.watchExpiryMinutes);
   out.addSpacingAtr      =CfgNum("addSpacingAtr",out.addSpacingAtr);
   out.rejectionZoneAtr   =CfgNum("rejectionZoneAtr",out.rejectionZoneAtr);
   out.cooldownMinutes    =(int)CfgNum("cooldownMinutes",(double)out.cooldownMinutes);
   out.requireM3Confirm   =CfgBool("requireM3Confirm",out.requireM3Confirm);
   out.requireM5Context   =CfgBool("requireM5Context",out.requireM5Context);
   out.learningEnabled    =CfgBool("learningEnabled",out.learningEnabled);
   out.learnEntryAdj      =CfgNum("entryScoreAdjustment",out.learnEntryAdj);
   out.learnAddAdj        =CfgNum("addScoreAdjustment",out.learnAddAdj);
   out.normalL1MarginPct  =CfgNum("normalL1MarginPct",out.normalL1MarginPct);
   out.normalL2MarginPct  =CfgNum("normalL2MarginPct",out.normalL2MarginPct);
   out.normalL3PlusMarginPct=CfgNum("normalL3PlusMarginPct",out.normalL3PlusMarginPct);
   out.normalReferenceLeverage=(long)CfgNum("normalReferenceLeverage",(double)out.normalReferenceLeverage);
   if(out.normalReferenceLeverage<0) out.normalReferenceLeverage=0;
   out.normalFixedSLGoldMove=CfgNum("normalFixedSLGoldMove",out.normalFixedSLGoldMove);
   out.profitRatchetEnabled=CfgBool("profitRatchetEnabled",out.profitRatchetEnabled);
   out.ratchetTriggerPct  =CfgNum("ratchetTriggerPct",out.ratchetTriggerPct);
   out.ratchetLockPct     =CfgNum("ratchetLockPct",out.ratchetLockPct);
   out.ratchetStepPct     =CfgNum("ratchetStepPct",out.ratchetStepPct);
   out.ratchetLockStepPct =CfgNum("ratchetLockStepPct",out.ratchetLockStepPct);
   out.masterBreakEvenEnabled=CfgBool("masterBreakEvenEnabled",out.masterBreakEvenEnabled);
   out.masterBreakEvenTriggerPct=CfgNum("masterBreakEvenTriggerPct",out.masterBreakEvenTriggerPct);
   out.recoveryExitEnabled=CfgBool("recoveryExitEnabled",out.recoveryExitEnabled);
   out.recoveryExitArmPctOfSL=CfgNum("recoveryExitArmPctOfSL",out.recoveryExitArmPctOfSL);
   out.maxBasketLots      =CfgNum("maxBasketLots",out.maxBasketLots);
   out.minMarginLevelPct  =CfgNum("minMarginLevelPct",out.minMarginLevelPct);
   out.marginReservePct   =CfgNum("marginReservePct",out.marginReservePct);
   return true;
  }

bool LoadCloudCache()
  {
   string payload;
   int rc=ReadFileChecked(ConfigCacheFile(),payload);
   if(rc==0) return false;
   if(rc<0){Print("APEX CONFIG CACHE CORRUPT | refusing to trade on unreadable cache | file=",ConfigCacheFile());return false;}
   if(!JsonParseObject(payload)){Print("APEX CONFIG CACHE UNPARSEABLE");return false;}
   Config staged=C;
   if(!ConfigFromParsed(staged)){Print("APEX CONFIG CACHE SCHEMA MISMATCH | ignored");return false;}
   bool denied=false; JBoolStrict("denied",denied);
   string dreason=""; JStrStrict("deniedReason",dreason);
   double rev=0; JNumStrict("commandRevision",rev);
   C=staged;
   g_cloudLastCommandRevision=(long)rev;
   C.revision=(long)rev;
   C.configHash=ConfigHash(C);
   // APEX-AUDIT-015: a persisted authenticated denial survives restart. An offline
   // restart cannot resurrect a stale armed cache after the licence was revoked.
   if(denied)
     {
      g_cloudExplicitDenied=true;g_cloudDeniedReason=(dreason==""?"LICENSE_DENIED":dreason);
      C.armed=false;g_cloudLastStatus=g_cloudDeniedReason;
      Print("APEX DENIAL TOMBSTONE RESTORED | reason=",g_cloudDeniedReason," | new exposure refused");
     }
   else
     {
      g_cloudUsingCache=true;g_cloudLastStatus="CACHED_LAST_KNOWN_GOOD";
      Print("APEX CLOUD CACHE RESTORED | armed=",C.armed?"true":"false"," | rev=",g_cloudLastCommandRevision,
            " | hash=",C.configHash," | trading remains local");
     }
   return true;
  }

//====================== policy snapshot / live tightening =============
void SnapshotPolicy()
  {
   P.accountProfile=C.accountProfile;
   P.targetEq=targetEq;
   P.profitRatchetEnabled=C.profitRatchetEnabled;
   P.ratchetTriggerPct=C.ratchetTriggerPct;
   P.ratchetLockPct=C.ratchetLockPct;
   P.ratchetStepPct=C.ratchetStepPct;
   P.ratchetLockStepPct=C.ratchetLockStepPct;
   P.masterBreakEvenEnabled=C.masterBreakEvenEnabled;
   P.masterBreakEvenTriggerPct=C.masterBreakEvenTriggerPct;
   P.recoveryExitEnabled=C.recoveryExitEnabled;
   P.recoveryExitArmPctOfSL=C.recoveryExitArmPctOfSL;
   P.normalFixedSLGoldMove=C.normalFixedSLGoldMove;
  }

// v3.8.1 LIVE-READY: account profile is campaign policy. A dashboard switch while a
// basket is open is deliberately effective NEXT campaign, exactly as ReconcileLivePolicy()
// already reports. This prevents NORMAL->UNLIMITED (or the reverse) half-way through.
string ExecutionProfile()
  {
   // v3.8.2: the profile decides which SIZING MODEL runs, so it must never be
   // decided by casing/whitespace.  Anything that is not recognisably NORMAL used
   // to fall through to the aggressive path silently; normalise before comparing.
   string p=trim(campState==CAMP_ACTIVE||campState==CAMP_CLOSING?P.accountProfile:C.accountProfile);
   StringToUpper(p);
   return p;
  }

// APEX-AUDIT-028. During a live campaign only strictly-tightening protection changes
// are adopted; everything else is reported as deferred to the next campaign. This is
// NOT a new restriction: it stops a mid-campaign config edit from silently REMOVING a
// protection the campaign is already relying on, which was the defect.
void ReconcileLivePolicy()
  {
   if(campState==CAMP_IDLE){SnapshotPolicy();return;}
   string deferred="",tightened="";
   if(C.profitRatchetEnabled&&!P.profitRatchetEnabled){P.profitRatchetEnabled=true;tightened+="ratchetEnabled;";}
   else if(!C.profitRatchetEnabled&&P.profitRatchetEnabled) deferred+="profitRatchetEnabled;";
   if(C.ratchetTriggerPct<P.ratchetTriggerPct&&C.ratchetTriggerPct>0){P.ratchetTriggerPct=C.ratchetTriggerPct;tightened+="ratchetTriggerPct;";}
   else if(C.ratchetTriggerPct>P.ratchetTriggerPct) deferred+="ratchetTriggerPct;";
   if(C.ratchetLockPct>P.ratchetLockPct){P.ratchetLockPct=C.ratchetLockPct;tightened+="ratchetLockPct;";}
   else if(C.ratchetLockPct<P.ratchetLockPct) deferred+="ratchetLockPct;";
   if(C.ratchetLockStepPct>P.ratchetLockStepPct){P.ratchetLockStepPct=C.ratchetLockStepPct;tightened+="ratchetLockStepPct;";}
   else if(C.ratchetLockStepPct<P.ratchetLockStepPct) deferred+="ratchetLockStepPct;";
   if(C.ratchetStepPct!=P.ratchetStepPct) deferred+="ratchetStepPct;";
   if(C.masterBreakEvenEnabled&&!P.masterBreakEvenEnabled){P.masterBreakEvenEnabled=true;tightened+="masterBreakEvenEnabled;";}
   else if(!C.masterBreakEvenEnabled&&P.masterBreakEvenEnabled) deferred+="masterBreakEvenEnabled;";
   if(C.masterBreakEvenTriggerPct<P.masterBreakEvenTriggerPct){P.masterBreakEvenTriggerPct=C.masterBreakEvenTriggerPct;tightened+="masterBreakEvenTriggerPct;";}
   else if(C.masterBreakEvenTriggerPct>P.masterBreakEvenTriggerPct) deferred+="masterBreakEvenTriggerPct;";
   if(C.recoveryExitEnabled&&!P.recoveryExitEnabled){P.recoveryExitEnabled=true;tightened+="recoveryExitEnabled;";}
   else if(!C.recoveryExitEnabled&&P.recoveryExitEnabled) deferred+="recoveryExitEnabled;";
   if(C.recoveryExitArmPctOfSL<P.recoveryExitArmPctOfSL){P.recoveryExitArmPctOfSL=C.recoveryExitArmPctOfSL;tightened+="recoveryExitArmPctOfSL;";}
   else if(C.recoveryExitArmPctOfSL>P.recoveryExitArmPctOfSL) deferred+="recoveryExitArmPctOfSL;";
   if(C.accountProfile!=P.accountProfile) deferred+="accountProfile;";
   if(StringLen(deferred)>0||StringLen(tightened)>0)
      Emit("POLICY_RECONCILED",StringFormat(",\"appliedNow\":\"%s\",\"effectiveNextCampaign\":\"%s\"",tightened,deferred));
  }

//====================== cloud sync ====================================
// APEX-AUDIT-015/016. Three distinct outcomes, never conflated:
//   AUTHENTICATED DENIAL  -> persist tombstone, refuse NEW exposure, keep managing exits
//   TRANSPORT FAILURE     -> keep the last validated local config exactly as before
//   PROTOCOL ERROR (bad 200 / stale revision) -> log, keep last-good, do NOT fabricate a denial
void RecordDenial(string reason)
  {
   g_cloudExplicitDenied=true;
   g_cloudDeniedReason=(reason==""?"LICENSE_DENIED":reason);
   g_cloudLastStatus=g_cloudDeniedReason;
   C.armed=false;
   SaveCloudCache();               // tombstone survives restart
   Print("APEX LICENSE DENIED BY XAUCLOUD | reason=",g_cloudDeniedReason," | new exposure refused, exits still managed");
  }

// True when an HTTP response is a structured, authenticated denial rather than an outage.
bool IsAuthenticatedDenial(int code,const string resp,string &reason)
  {
   reason="";
   if(code!=401&&code!=403) return false;
   if(!JsonParseObject(resp)) {reason="LICENSE_DENIED";return true;}   // 403 with any body is still a denial
   string r="";
   if(JStrStrict("reason",r)&&r!="") reason=r;
   else if(JStrStrict("error",r)&&r!="") reason=r;
   else if(JStrStrict("licenseStatus",r)&&r!="") reason=r;
   else reason="LICENSE_DENIED";
   return true;
  }

// Diagnostic only: what the CLIENT margin model claims one lot costs right now. A 0
// here next to a huge broker_reported_leverage is the pathological signature that makes
// NORMAL fall back to the configured reference leverage.
double HeartbeatMarginAtOneLot()
  {
   double m=0;
   double price=SymbolInfoDouble(_Symbol,SYMBOL_ASK);
   if(price<=0) return 0;
   if(!OrderCalcMargin(ORDER_TYPE_BUY,_Symbol,1.0,price,m)) return -1;
   return m;
  }

bool CloudSync()
  {
   if(IsTester()){C.armed=true;return true;}
   string license=NormalizeLicense(InpApexLicense);
   if(StringLen(license)<8)
     {
      g_cloudLastStatus="LICENSE_MISSING";
      if(!g_cloudEverValidated&&!g_cloudUsingCache)C.armed=false;
      if(InpCloudDiagnostics)Print("APEX LICENSE MISSING | enter Apex license in EA Inputs");
      return false;
     }
   string b=StringFormat(
      "{\"license_key\":\"%s\",\"account_number\":\"%I64d\",\"broker_server\":\"%s\","
      "\"symbol\":\"%s\",\"timeframe\":\"%d\",\"ea_version\":\"%s\",\"build_id\":\"%s\",\"balance\":%.2f,\"equity\":%.2f,"
      "\"free_margin\":%.2f,\"margin_level\":%.2f,\"open_positions\":%d,\"basket_volume\":%.4f,"
      "\"campaign_active\":%s,\"campaign_state\":\"%s\",\"layers\":%d,\"campaign_id\":\"%s\","
      "\"applied_revision\":%I64d,\"config_hash\":\"%s\",\"observer_only\":%s,\"preflight_block\":\"%s\","
      "\"scan_gate\":\"%s\",\"algo_trading\":%s,\"trading_allowed\":%s,\"mt5_connected\":%s,"
      "\"account_connected\":%s,\"symbol_trade_mode\":%d,"
      "\"account_profile\":\"%s\",\"broker_reported_leverage\":%I64d,"
      "\"configured_normal_reference_leverage\":%I64d,\"margin_at_1_lot\":%.4f,"
      "\"ea_active\":true,\"bot_state\":\"APEX\"}",
      license,AccountInfoInteger(ACCOUNT_LOGIN),AccountInfoString(ACCOUNT_SERVER),_Symbol,(int)_Period,
      APEX_VERSION,APEX_BUILD_ID,AccountInfoDouble(ACCOUNT_BALANCE),AccountInfoDouble(ACCOUNT_EQUITY),
      AccountInfoDouble(ACCOUNT_MARGIN_FREE),AccountInfoDouble(ACCOUNT_MARGIN_LEVEL),CountPos(),BasketVolume(),
      BoolJson(campState!=CAMP_IDLE),(campState==CAMP_CLOSING?"CLOSING":campState==CAMP_ACTIVE?"ACTIVE":"IDLE"),
      layers,campId,g_cloudLastCommandRevision,C.configHash,BoolJson(g_observerOnly),g_preflightBlock,
      (g_observerOnly?"OBSERVER_ONLY":g_preflightBlock!=""?g_preflightBlock:C.armed?"SCANNING":"DISARMED"),
      BoolJson((bool)TerminalInfoInteger(TERMINAL_TRADE_ALLOWED)),BoolJson((bool)MQLInfoInteger(MQL_TRADE_ALLOWED)),
      BoolJson((bool)TerminalInfoInteger(TERMINAL_CONNECTED)),
      BoolJson(AccountInfoInteger(ACCOUNT_LOGIN)>0),(int)SymbolInfoInteger(_Symbol,SYMBOL_TRADE_MODE),
      ExecutionProfile(),AccountInfoInteger(ACCOUNT_LEVERAGE),C.normalReferenceLeverage,
      HeartbeatMarginAtOneLot());

   string r;int code=0,err=0;
   if(!Http("POST","/api/cloud/monitor/heartbeat",b,r,code,err))
     {
      string reason;
      // APEX-AUDIT-015: heartbeat denial is handled EXACTLY like config denial.
      if(IsAuthenticatedDenial(code,r,reason)){RecordDenial(reason);return false;}
      CloudFailure("HEARTBEAT",code,err,r);
      return false;                    // transport failure never alters C.armed
     }

   string configPath=StringFormat("/api/cloud/apex/config?license_key=%s&account=%I64d",
                                  license,AccountInfoInteger(ACCOUNT_LOGIN));
   if(!Http("GET",configPath,"",r,code,err))
     {
      string reason;
      if(IsAuthenticatedDenial(code,r,reason)){RecordDenial(reason);return false;}
      CloudFailure("CONFIG",code,err,r);
      return false;
     }

   // A 200 that is not a well-formed object is a PROTOCOL error, never a licence denial.
   if(!JsonParseObject(r))
     {
      g_cloudProtocolError="MALFORMED_200_NOT_JSON";
      g_cloudLastStatus="PROTOCOL_ERROR";
      Print("APEX CLOUD PROTOCOL ERROR | malformed 200 body | last-good config retained | body=",StringSubstr(r,0,200));
      return false;
     }
   string ls="";
   if(!JStrStrict("licenseStatus",ls))
     {
      g_cloudProtocolError="MISSING_LICENSE_STATUS";
      g_cloudLastStatus="PROTOCOL_ERROR";
      Print("APEX CLOUD PROTOCOL ERROR | 200 without a string licenseStatus | last-good config retained");
      return false;
     }
   if(ls!="ACTIVE"){RecordDenial(ls);return false;}

   // APEX-AUDIT-016: reject a revision rollback BEFORE applying anything.
   double revd=0;
   long revision=g_cloudLastCommandRevision;
   if(JNumStrict("commandRevision",revd)) revision=(long)revd;
   else if(JHas("commandRevision"))
     {
      g_cloudProtocolError="COMMAND_REVISION_WRONG_TYPE";
      Print("APEX CLOUD PROTOCOL ERROR | commandRevision is not a number | last-good config retained");
      return false;
     }
   if(revision<g_cloudLastCommandRevision)
     {
      g_cloudProtocolError="REVISION_ROLLBACK_REJECTED";
      g_cloudLastStatus="STALE_REVISION_REJECTED";
      Print("APEX REVISION ROLLBACK REJECTED | server=",revision," applied=",g_cloudLastCommandRevision," | config NOT applied");
      return false;
     }

   // Stage -> validate -> atomic swap. A partially-bad payload can never half-overwrite C.
   g_cfgTypeErrors=0;g_cfgTypeErrorList="";
   Config staged=C;
   if(!ConfigFromParsed(staged))
     {
      g_cloudProtocolError="CONFIG_SCHEMA_MISMATCH";
      Print("APEX CLOUD PROTOCOL ERROR | config schema mismatch | last-good config retained");
      return false;
     }
   if(g_cfgTypeErrors>0)
     {
      g_cloudProtocolError="CONFIG_TYPE_ERRORS:"+g_cfgTypeErrorList;
      Print("APEX CLOUD CONFIG REJECTED | wrong-typed fields=",g_cfgTypeErrorList," | last-good config retained");
      return false;
     }
   // Cross-field sanity: an inconsistent ratchet would close instantly on arming.
   if(staged.profitRatchetEnabled&&staged.ratchetLockPct>staged.ratchetTriggerPct)
     {
      g_cloudProtocolError="RATCHET_LOCK_EXCEEDS_TRIGGER";
      Print("APEX CLOUD CONFIG REJECTED | ratchetLockPct>ratchetTriggerPct | last-good config retained");
      return false;
     }

   g_cloudProtocolError="";
   g_cloudExplicitDenied=false;g_cloudDeniedReason="";
   g_cloudEverValidated=true;g_cloudUsingCache=false;
   C=staged;
   C.revision=revision;
   C.configHash=ConfigHash(C);
   ReconcileLivePolicy();
   CloudSuccess();
   if(InpCloudDiagnostics)
      Print("APEX XAUCLOUD LINK OK | license=ACTIVE | rev=",revision," | hash=",C.configHash,
            " | armed=",C.armed?"true":"false");
   bool bumped=(revision>g_cloudLastCommandRevision);
   g_cloudLastCommandRevision=revision;
   SaveCloudCache();
   if(bumped) AckCommand(revision,C.armed?"ARMED":"DISARMED");
   return true;
  }

//====================== position helpers ==============================
bool IsOurPosition(ulong t)
  {
   if(t==0) return false;
   if(!PositionSelectByTicket(t)) return false;
   return PositionGetString(POSITION_SYMBOL)==_Symbol && PositionGetInteger(POSITION_MAGIC)==InpMagic;
  }
int CountPos()
  {
   int n=0;
   for(int i=PositionsTotal()-1;i>=0;i--)
     {ulong t=PositionGetTicket(i);
      if(t&&PositionGetString(POSITION_SYMBOL)==_Symbol&&PositionGetInteger(POSITION_MAGIC)==InpMagic)n++;}
   return n;
  }
double BasketVolume()
  {
   double v=0;
   for(int i=PositionsTotal()-1;i>=0;i--)
     {ulong t=PositionGetTicket(i);
      if(t&&PositionGetString(POSITION_SYMBOL)==_Symbol&&PositionGetInteger(POSITION_MAGIC)==InpMagic)
         v+=PositionGetDouble(POSITION_VOLUME);}
   return v;
  }
// APEX-AUDIT-018: floating P/L kept strictly separate from realised deal accounting.
double BasketProfitFloating()
  {
   double p=0;
   for(int i=PositionsTotal()-1;i>=0;i--)
     {ulong t=PositionGetTicket(i);
      if(t&&PositionGetString(POSITION_SYMBOL)==_Symbol&&PositionGetInteger(POSITION_MAGIC)==InpMagic)
         p+=PositionGetDouble(POSITION_PROFIT)+PositionGetDouble(POSITION_SWAP);}
   return p;
  }
// Realised P/L of this campaign, reconciled from the deal history (commissions, swaps
// and partial closes included) -- never mixed into the floating figure.
double CampaignRealised(double &commission,double &swap,int &deals)
  {
   commission=0;swap=0;deals=0;
   double profit=0;
   if(campStart<=0) return 0;
   if(!HistorySelect(campStart-60,TimeCurrent()+60)) return 0;
   int total=HistoryDealsTotal();
   for(int i=0;i<total;i++)
     {
      ulong d=HistoryDealGetTicket(i);
      if(d==0) continue;
      if(HistoryDealGetInteger(d,DEAL_MAGIC)!=InpMagic) continue;
      if(HistoryDealGetString(d,DEAL_SYMBOL)!=_Symbol) continue;
      long entry=HistoryDealGetInteger(d,DEAL_ENTRY);
      if(entry!=DEAL_ENTRY_OUT&&entry!=DEAL_ENTRY_OUT_BY&&entry!=DEAL_ENTRY_INOUT) continue;
      profit+=HistoryDealGetDouble(d,DEAL_PROFIT);
      commission+=HistoryDealGetDouble(d,DEAL_COMMISSION);
      swap+=HistoryDealGetDouble(d,DEAL_SWAP);
      deals++;
     }
   return profit+commission+swap;
  }
ulong FindOldestApexPosition()
  {
   ulong bestTicket=0;datetime bestTime=0;
   for(int i=PositionsTotal()-1;i>=0;i--)
     {
      ulong t=PositionGetTicket(i);
      if(!t||PositionGetString(POSITION_SYMBOL)!=_Symbol||PositionGetInteger(POSITION_MAGIC)!=InpMagic)continue;
      datetime ot=(datetime)PositionGetInteger(POSITION_TIME);
      if(bestTicket==0||ot<bestTime){bestTicket=t;bestTime=ot;}
     }
   return bestTicket;
  }
bool NewestMagicPosition(int &dir,double &price,int &count)
  {
   count=0;dir=0;price=0;datetime best=0;
   for(int i=PositionsTotal()-1;i>=0;i--)
     {
      ulong t=PositionGetTicket(i);
      if(!t||PositionGetString(POSITION_SYMBOL)!=_Symbol||PositionGetInteger(POSITION_MAGIC)!=InpMagic)continue;
      count++;
      datetime ot=(datetime)PositionGetInteger(POSITION_TIME);
      if(ot>=best){best=ot;dir=PositionGetInteger(POSITION_TYPE)==POSITION_TYPE_BUY?1:-1;price=PositionGetDouble(POSITION_PRICE_OPEN);}
     }
   return count>0;
  }
bool MasterPositionExists(){return masterTicket!=0 && IsOurPosition(masterTicket);}

//====================== campaign state persistence ====================
// APEX-AUDIT-011: versioned, checksummed, keyed by account+broker+symbol+magic, and
// carrying EVERYTHING the protection logic depends on -- including the original stop,
// the recovery latch, the earned floor, the closing intent and the consumed triggers.
void SaveState()
  {
   // v3.8.1 LIVE-READY: an observer/duplicate instance never owns campaign state.
   if(g_observerOnly&&!IsTester()) return;
   string j=StringFormat(
     "{\"schema\":%d,\"build\":\"%s\",\"ownerKey\":\"%s\",\"account\":%I64d,\"symbol\":\"%s\",\"magic\":%I64d,"
     "\"campState\":%d,\"campId\":\"%s\",\"campSig\":\"%s\",\"campDir\":%d,\"layers\":%d,"
     "\"cycleStart\":%.2f,\"targetEq\":%.2f,\"campStart\":%I64d,\"lastAdd\":%.5f,\"mfe\":%.2f,\"mae\":%.2f,"
     "\"peakProfitPct\":%.4f,\"earnedFloorPct\":%.4f,\"ratchetArmed\":%s,"
     "\"firstEntryPrice\":%.5f,\"firstSLPrice\":%.5f,\"firstInitialSLPrice\":%.5f,"
     "\"recoveryExitArmed\":%s,\"anchorsKnown\":%s,\"masterTicket\":%I64u,\"masterGuardStage\":%d,"
     "\"closingOutcome\":\"%s\",\"closingReason\":\"%s\",\"closingSince\":%I64d,\"closeAttempts\":%d,"
     "\"campInvalidLevel\":%.5f,\"campOriginHigh\":%.5f,\"campOriginLow\":%.5f,\"campOriginClose\":%.5f,\"campOriginBar\":%I64d,"
     "\"consumedTriggers\":%s,"
     "\"policy\":{\"accountProfile\":\"%s\",\"targetEq\":%.2f,\"profitRatchetEnabled\":%s,"
     "\"ratchetTriggerPct\":%.4f,\"ratchetLockPct\":%.4f,\"ratchetStepPct\":%.4f,\"ratchetLockStepPct\":%.4f,"
     "\"masterBreakEvenEnabled\":%s,\"masterBreakEvenTriggerPct\":%.4f,\"recoveryExitEnabled\":%s,"
     "\"recoveryExitArmPctOfSL\":%.4f,\"normalFixedSLGoldMove\":%.4f}}",
     APEX_STATE_SCHEMA,APEX_BUILD_ID,OwnerKey(),AccountInfoInteger(ACCOUNT_LOGIN),_Symbol,InpMagic,
     (int)campState,campId,campSig,campDir,layers,cycleStart,targetEq,(long)campStart,lastAdd,mfe,mae,
     peakProfitPct,earnedFloorPct,BoolJson(ratchetArmed),
     firstEntryPrice,firstSLPrice,firstInitialSLPrice,
     BoolJson(recoveryExitArmed),BoolJson(anchorsKnown),masterTicket,masterGuardStage,
     closingOutcome,closingReason,(long)closingSince,closeAttempts,
     campInvalidLevel,campOriginHigh,campOriginLow,campOriginClose,(long)campOriginBar,TriggersJson(),
     P.accountProfile,P.targetEq,BoolJson(P.profitRatchetEnabled),P.ratchetTriggerPct,P.ratchetLockPct,
     P.ratchetStepPct,P.ratchetLockStepPct,BoolJson(P.masterBreakEvenEnabled),P.masterBreakEvenTriggerPct,
     BoolJson(P.recoveryExitEnabled),P.recoveryExitArmPctOfSL,P.normalFixedSLGoldMove);
   if(!WriteFileAtomic(StateFile(),j))
      Print("APEX STATE WRITE FAILED | file=",StateFile()," | campaign state may not survive a restart");
  }
bool ApplyLegacySchemaGuard(int schema)
  {
   if(schema==3 && (campState==CAMP_ACTIVE||campState==CAMP_CLOSING))
     {
      anchorsKnown=false;
      Print("APEX LEGACY_CAMPAIGN_ORIGIN_UNKNOWN_NEW_EXPOSURE_BLOCKED | schema=3 active campaign has no origin/invalidation anchors | existing positions managed, new layers refused");
      return true;
     }
   return false;
  }
void ClearState(){if(g_observerOnly&&!IsTester())return;FileDelete(StateFile());}

// Returns 1 restored, 0 no state, -1 corrupt/foreign (explicitly distinguished).
int LoadState()
  {
   string payload;
   int rc=ReadFileChecked(StateFile(),payload);
   if(rc<=0) return rc;
   if(!JsonParseObject(payload)) return -1;
   double sch=0;
   if(!JNumStrict("schema",sch)||((int)sch!=APEX_STATE_SCHEMA&&(int)sch!=3)) return -1;
   string owner="";
   if(!JStrStrict("ownerKey",owner)||owner!=OwnerKey()) return -1;   // wrong account/broker/symbol/magic

   double v=0;
   campState = JNumStrict("campState",v)?(CampState)(int)v:CAMP_IDLE;
   campId    = JStrOr("campId","");
   campSig   = JStrOr("campSig","RECOVERED");
   campDir   = (int)JNumOr("campDir",0);
   layers    = (int)JNumOr("layers",0);
   cycleStart= JNumOr("cycleStart",0);
   targetEq  = JNumOr("targetEq",0);
   campStart = (datetime)(long)JNumOr("campStart",0);
   lastAdd   = JNumOr("lastAdd",0);
   mfe       = JNumOr("mfe",0);
   mae       = JNumOr("mae",0);
   peakProfitPct  = JNumOr("peakProfitPct",0);
   earnedFloorPct = JNumOr("earnedFloorPct",0);
   ratchetArmed   = JBoolOr("ratchetArmed",false);
   firstEntryPrice     = JNumOr("firstEntryPrice",0);
   firstSLPrice        = JNumOr("firstSLPrice",0);
   firstInitialSLPrice = JNumOr("firstInitialSLPrice",0);
   recoveryExitArmed   = JBoolOr("recoveryExitArmed",false);
   anchorsKnown        = JBoolOr("anchorsKnown",true);
   masterTicket        = (ulong)JNumOr("masterTicket",0);
   masterGuardStage    = (int)JNumOr("masterGuardStage",0);
   closingOutcome      = JStrOr("closingOutcome","");
   closingReason       = JStrOr("closingReason","");
   closingSince        = (datetime)(long)JNumOr("closingSince",0);
   closeAttempts       = (int)JNumOr("closeAttempts",0);
   campInvalidLevel    = JNumOr("campInvalidLevel",0);
   campOriginHigh      = JNumOr("campOriginHigh",0);
   campOriginLow       = JNumOr("campOriginLow",0);
   campOriginClose     = JNumOr("campOriginClose",0);
   campOriginBar       = (datetime)(long)JNumOr("campOriginBar",0);
   ApplyLegacySchemaGuard((int)sch);
   int ti=JIdx("consumedTriggers");
   if(ti>=0&&g_jtype[ti]=='a') TriggersFromJson(g_jval[ti]);
   int pi=JIdx("policy");
   if(pi>=0&&g_jtype[pi]=='o')
     {
      string pol=g_jval[pi];
      string keys[];string vals[];ushort types[];
      // parse the nested policy object into the shared table, then restore P
      int savedCount=g_jcount;
      ArrayResize(keys,savedCount);ArrayResize(vals,savedCount);ArrayResize(types,savedCount);
      for(int i=0;i<savedCount;i++){keys[i]=g_jkey[i];vals[i]=g_jval[i];types[i]=g_jtype[i];}
      if(JsonParseObject(pol))
        {
         P.accountProfile=JStrOr("accountProfile","NORMAL");
         P.targetEq=JNumOr("targetEq",targetEq);
         P.profitRatchetEnabled=JBoolOr("profitRatchetEnabled",C.profitRatchetEnabled);
         P.ratchetTriggerPct=JNumOr("ratchetTriggerPct",C.ratchetTriggerPct);
         P.ratchetLockPct=JNumOr("ratchetLockPct",C.ratchetLockPct);
         P.ratchetStepPct=JNumOr("ratchetStepPct",C.ratchetStepPct);
         P.ratchetLockStepPct=JNumOr("ratchetLockStepPct",C.ratchetLockStepPct);
         P.masterBreakEvenEnabled=JBoolOr("masterBreakEvenEnabled",C.masterBreakEvenEnabled);
         P.masterBreakEvenTriggerPct=JNumOr("masterBreakEvenTriggerPct",C.masterBreakEvenTriggerPct);
         P.recoveryExitEnabled=JBoolOr("recoveryExitEnabled",C.recoveryExitEnabled);
         P.recoveryExitArmPctOfSL=JNumOr("recoveryExitArmPctOfSL",C.recoveryExitArmPctOfSL);
         P.normalFixedSLGoldMove=JNumOr("normalFixedSLGoldMove",C.normalFixedSLGoldMove);
        }
      // restore the outer table so any later lookup still sees the state object
      g_jcount=savedCount;
      ArrayResize(g_jkey,savedCount);ArrayResize(g_jval,savedCount);ArrayResize(g_jtype,savedCount);
      for(int i=0;i<savedCount;i++){g_jkey[i]=keys[i];g_jval[i]=vals[i];g_jtype[i]=types[i];}
     }
   return 1;
  }

//====================== volume sizing (APEX-AUDIT-009) ================
// v3.7.1's NormVol() clamped UP to SYMBOL_VOLUME_MIN before the caller's "is the
// minimum affordable?" test ran, so that test was unreachable and Apex could submit a
// position whose margin exceeded the requested budget. Sizing now floors to the real
// step, never raises to the minimum implicitly, derives precision from the actual step
// (so .25 and .00125 steps work), and validates the FINAL volume with OrderCheck.
double VolStep()
  {
   double st=SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_STEP);
   if(st>0) return st;
   double mn=SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_MIN);
   return mn>0?mn:0.01;
  }
int VolDigits()
  {
   double st=VolStep();
   for(int d=0;d<=8;d++)
     {
      double f=MathPow(10.0,d);
      if(MathAbs(st*f-MathRound(st*f))<1e-9) return d;
     }
   return 8;
  }
// Floors v onto the broker's real volume grid. Never rounds up, never clamps to min.
double FloorToStep(double v)
  {
   double st=VolStep();
   if(st<=0) return 0;
   double n=MathFloor(v/st+1e-9)*st;
   if(n<0) n=0;
   return NormalizeDouble(n,VolDigits());
  }

// APEX-AUDIT-009 + POST-AUDIT-LIVE-001 (Exness XAUUSDm 200-lot "[No money]" rejections
// on demo 476885386 at 01:39, 05:27 and 06:34 on 2026-09-07).
//
// v3.7.1 did:
//     budget = free * pct/100
//     if(OrderCalcMargin(SYMBOL_VOLUME_MAX) <= budget) return SYMBOL_VOLUME_MAX;   // <-- defect
// On an account where the client-side margin model reports (near-)zero margin for gold,
// that shortcut is true for EVERY pct, so a NORMAL L1 "15% probe" and a L3+ "100%"
// request both collapse to the broker's symbol maximum -- 200.00 lots on XAUUSDm. The
// configured ladder could not influence the size at all.
//
// The fix keeps the DOCUMENTED rule ("a layer requests pct% of current capacity, sized
// with real broker margin maths, capped at what is free right now") and simply evaluates
// it in a domain where it does not degenerate:
//
//     capacityByMargin  = largest grid volume whose margin fits 100% of free margin
//     capacityByBroker  = largest of those that OrderCheck() accepts right now
//     byCapacityPct     = capacity * pct/100          (volume form of the rule)
//     byMarginBudget    = largest grid volume whose margin fits free * pct/100  (money form)
//     requested         = min(byCapacityPct, byMarginBudget)
//
// When margin is linear in volume -- i.e. every ordinary account, which is the case the
// specification was written for -- the two forms are ALGEBRAICALLY IDENTICAL, so nothing
// changes. They only diverge when margin is (near-)zero or volume-tiered, which is exactly
// the case that produced the 200-lot request. No cap, no new risk policy, no invented
// number: the same percentage, evaluated correctly.
struct SizingDecision
  {
   double pct,freeMargin,budget;
   double volMin,volMax,volStep;
   double marginAtVolMax,marginAtOneLot,marginAtFinal;
   double capacityByMargin,capacityByBroker,capacity;
   double byCapacityPct,byMarginBudget,requested,finalVolume;
   double trustedMarginPerLot,leverageMarginPerLot,initialMarginPerLot;
   // v3.8.2 owner-mandated sizing audit trail (see APEX SIZING telemetry contract).
   long   brokerReportedLeverage,configuredNormalReferenceLeverage,effectiveSizingLeverage;
   bool   brokerMarginModelTrusted;
   double moneyCapacity;
   string capacitySource;
   uint   checkRetcode;
   bool   marginBinding,usedMarginFallback;
   string blockReason,sizingModel;
  };

// v3.8.1 LIVE-READY: use the symbol's broker-supported filling policy instead of
// hard-coding IOC. RETURN is valid for non-MARKET execution when neither FOK nor IOC is
// advertised; MARKET execution must advertise FOK or IOC or new exposure is blocked.
bool ResolveFillingMode(ENUM_ORDER_TYPE_FILLING &mode)
  {
   long flags=SymbolInfoInteger(_Symbol,SYMBOL_FILLING_MODE);
   if((flags&SYMBOL_FILLING_FOK)==SYMBOL_FILLING_FOK){mode=ORDER_FILLING_FOK;return true;}
   if((flags&SYMBOL_FILLING_IOC)==SYMBOL_FILLING_IOC){mode=ORDER_FILLING_IOC;return true;}
   ENUM_SYMBOL_TRADE_EXECUTION ex=(ENUM_SYMBOL_TRADE_EXECUTION)SymbolInfoInteger(_Symbol,SYMBOL_TRADE_EXEMODE);
   if(ex!=SYMBOL_TRADE_EXECUTION_MARKET){mode=ORDER_FILLING_RETURN;return true;}
   return false;
  }

void ResetMarketClosedBackoff()
  {
   g_marketClosedRetryAt=0;
   g_marketClosedBackoffSec=0;
  }

void NoteMarketClosed(const string operation,uint retcode)
  {
   int next=(g_marketClosedBackoffSec<=0)?5:(g_marketClosedBackoffSec>=15?30:g_marketClosedBackoffSec*2);
   g_marketClosedBackoffSec=next;
   g_marketClosedRetryAt=TimeCurrent()+next;
   PrintFormat("APEX MARKET CLOSED | op=%s retcode=%u | preserving state; retry in %d sec",
               operation,retcode,next);
  }

bool MarketClosedBackoffActive()
  {
   if(g_marketClosedRetryAt<=0) return false;
   if(TimeCurrent()>=g_marketClosedRetryAt) return false;
   return true;
  }

bool BrokerAcceptsVolume(int dir,double vol,double price,double sl,uint &rc)
  {
   rc=0;
   if(vol<=0) return false;
   MqlTradeRequest rq; MqlTradeCheckResult cr;
   ZeroMemory(rq); ZeroMemory(cr);
   rq.action=TRADE_ACTION_DEAL;
   rq.symbol=_Symbol;
   rq.volume=vol;
   rq.type=dir>0?ORDER_TYPE_BUY:ORDER_TYPE_SELL;
   rq.price=price;
   rq.sl=sl;
   rq.magic=(ulong)InpMagic;
   rq.deviation=80;
   ENUM_ORDER_TYPE_FILLING filling;
   if(!ResolveFillingMode(filling)){rc=TRADE_RETCODE_INVALID_FILL;return false;}
   rq.type_filling=filling;
   bool ok=OrderCheck(rq,cr);
   rc=cr.retcode;
   if(ok) return true;
   return rc==TRADE_RETCODE_DONE||rc==TRADE_RETCODE_PLACED;
  }

// Largest grid volume in (0,hi] whose OrderCalcMargin fits `money`.
// ---- server-proven executable capacity (v3.8.2) ----------------------------
// The trade SERVER is the only authority on what is executable when the client margin
// model is degenerate. We remember the smallest volume it has rejected for NO_MONEY and
// the largest it has actually filled, so the next campaign does not start by believing
// SYMBOL_VOLUME_MAX again. Evidence only -- never a configured cap.
double g_serverRejectedVolume=0;   // smallest volume the server refused for size/money
double g_serverFilledVolume=0;     // largest volume the server actually filled
double g_serverEvidenceFreeMargin=0; // free margin when that rejection was observed

double ServerCapacityCeiling()
  {
   if(g_serverRejectedVolume<=0) return 0;
   // Only meaningful while free margin has not grown beyond the level at which the
   // rejection was observed; more money legitimately means more capacity.
   double now=AccountInfoDouble(ACCOUNT_MARGIN_FREE);
   if(g_serverEvidenceFreeMargin>0&&now>g_serverEvidenceFreeMargin*1.05) return 0;
   double ceiling=g_serverRejectedVolume-VolStep();
   if(g_serverFilledVolume>ceiling) ceiling=g_serverFilledVolume;
   return ceiling>0?ceiling:0;
  }

void NoteServerRejectedVolume(double vol)
  {
   if(vol<=0) return;
   if(g_serverRejectedVolume<=0||vol<g_serverRejectedVolume)
     {
      g_serverRejectedVolume=vol;
      g_serverEvidenceFreeMargin=AccountInfoDouble(ACCOUNT_MARGIN_FREE);
      PrintFormat("APEX SERVER CAPACITY EVIDENCE | rejected=%.4f freeMargin=%.2f -> ceiling=%.4f",
                  vol,g_serverEvidenceFreeMargin,ServerCapacityCeiling());
     }
  }

void NoteServerFilledVolume(double vol)
  {
   if(vol>g_serverFilledVolume) g_serverFilledVolume=vol;
  }

double LargestVolumeWithinMargin(int dir,double price,double money,double hi)
  {
   if(hi<=0||money<=0) return 0;
   ENUM_ORDER_TYPE t=dir>0?ORDER_TYPE_BUY:ORDER_TYPE_SELL;
   double m=0;
   if(OrderCalcMargin(t,_Symbol,hi,price,m)&&m<=money) return FloorToStep(hi);
   double lo=0,up=hi;
   for(int i=0;i<40;i++)
     {
      double mid=(lo+up)/2;
      if(!OrderCalcMargin(t,_Symbol,mid,price,m)||m>money) up=mid; else lo=mid;
     }
   return FloorToStep(lo);
  }

// Largest grid volume in (0,hi] that the broker's own preflight accepts.
double LargestVolumePassingCheck(int dir,double price,double sl,double hi)
  {
   if(hi<=0) return 0;
   uint rc=0;
   if(BrokerAcceptsVolume(dir,FloorToStep(hi),price,sl,rc)) return FloorToStep(hi);
   if(rc==TRADE_RETCODE_MARKET_CLOSED){NoteMarketClosed("ORDERCHECK",rc);return 0;}
   double lo=0,up=hi;
   for(int i=0;i<24;i++)
     {
      double mid=FloorToStep((lo+up)/2);
      if(mid<=0){lo=0;break;}
      if(BrokerAcceptsVolume(dir,mid,price,sl,rc)) lo=mid;
      else
        {
         if(rc==TRADE_RETCODE_MARKET_CLOSED){NoteMarketClosed("ORDERCHECK",rc);return 0;}
         up=mid;
        }
     }
   return FloorToStep(lo);
  }

// v3.8.2 CAPACITY-TRUTH -------------------------------------------------------
// NORMAL means a percentage of monetary margin capacity, never a percentage of the
// symbol's arbitrary volume maximum.  Some high/dynamic-leverage brokers can report
// near-zero OrderCalcMargin even though the trade server later rejects the volume with
// TRADE_RETCODE_NO_MONEY.  For NORMAL only we therefore require an independent positive
// margin basis.  For XAUUSD accounts denominated in the quote currency, the standard
// contract*price/leverage formula is a safe independent cross-check.  A broker-provided
// fixed initial margin (when already denominated in the account currency) is another.
// We use the LARGEST positive estimate so a broken low/zero estimate cannot inflate size.
// Notional value of one lot in the ACCOUNT currency, or 0 when that cannot be
// established safely (the contract*price formula is only valid while the account
// currency and the symbol profit currency are the same).
double NotionalPerLot(double price)
  {
   double contract=SymbolInfoDouble(_Symbol,SYMBOL_TRADE_CONTRACT_SIZE);
   string acct=AccountInfoString(ACCOUNT_CURRENCY);
   string profit=SymbolInfoString(_Symbol,SYMBOL_CURRENCY_PROFIT);
   if(contract<=0||price<=0||acct==""||profit==""||acct!=profit) return 0;
   return contract*price;
  }

// Margin per lot implied by an explicit leverage. Used both for the broker's own
// reported leverage and for the owner-configured NORMAL reference leverage.
double MarginPerLotAtLeverage(double price,long lev)
  {
   if(lev<=0) return 0;
   double notional=NotionalPerLot(price);
   if(notional<=0) return 0;
   return notional/(double)lev;
  }

double LeverageMarginPerLot(double price)
  {
   return MarginPerLotAtLeverage(price,AccountInfoInteger(ACCOUNT_LEVERAGE));
  }

double FixedInitialMarginPerLot()
  {
   double m=SymbolInfoDouble(_Symbol,SYMBOL_MARGIN_INITIAL);
   string acct=AccountInfoString(ACCOUNT_CURRENCY);
   string mc=SymbolInfoString(_Symbol,SYMBOL_CURRENCY_MARGIN);
   if(m<=0||acct==""||mc==""||acct!=mc) return 0;
   return m;
  }

double TrustedMarginPerLot(int dir,double price,double &calcM,double &levM,double &initM,bool &fallback)
  {
   ENUM_ORDER_TYPE t=dir>0?ORDER_TYPE_BUY:ORDER_TYPE_SELL;
   calcM=0;levM=LeverageMarginPerLot(price);initM=FixedInitialMarginPerLot();fallback=false;
   double tmp=0;
   if(OrderCalcMargin(t,_Symbol,1.0,price,tmp)&&MathIsValidNumber(tmp)&&tmp>0) calcM=tmp;
   double trusted=MathMax(calcM,MathMax(levM,initM));
   fallback=(trusted>calcM+1e-8);
   return trusted;
  }

SizingDecision ComputeVolume(int dir,double pct,double price,double sl)
  {
   SizingDecision d;
   d.pct=pct;d.blockReason="";d.checkRetcode=0;d.marginBinding=false;d.usedMarginFallback=false;
   d.capacityByMargin=0;d.capacityByBroker=0;d.capacity=0;
   d.byCapacityPct=0;d.byMarginBudget=0;d.requested=0;d.finalVolume=0;
   d.marginAtVolMax=0;d.marginAtOneLot=0;d.marginAtFinal=0;
   d.trustedMarginPerLot=0;d.leverageMarginPerLot=0;d.initialMarginPerLot=0;d.sizingModel="";
   d.brokerReportedLeverage=AccountInfoInteger(ACCOUNT_LEVERAGE);
   d.configuredNormalReferenceLeverage=C.normalReferenceLeverage;
   d.effectiveSizingLeverage=0;d.brokerMarginModelTrusted=false;
   d.moneyCapacity=0;d.capacitySource="";
   d.volMin=SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_MIN);
   d.volMax=SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_MAX);
   d.volStep=VolStep();
   d.freeMargin=AccountInfoDouble(ACCOUNT_MARGIN_FREE);
   if(d.freeMargin<=0){d.blockReason="NO_FREE_MARGIN";return d;}
   if(price<=0){d.blockReason="NO_QUOTE";return d;}

   double reserve=(C.marginReservePct>0)?d.freeMargin*clamp(C.marginReservePct,0,100)/100.0:0.0;
   double spendable=MathMax(0.0,d.freeMargin-reserve);
   d.budget=spendable*clamp(pct,.1,100)/100.0;
   if(d.budget<=0){d.blockReason="ZERO_BUDGET";return d;}

   double hi=d.volMax;
   if(C.maxBasketLots>0)
     {
      double room=C.maxBasketLots-BasketVolume();
      if(room<=0){d.blockReason="BASKET_LOT_CAP_REACHED";return d;}
      hi=MathMin(hi,room);
     }
   ENUM_ORDER_TYPE t=dir>0?ORDER_TYPE_BUY:ORDER_TYPE_SELL;
   if(!OrderCalcMargin(t,_Symbol,d.volMax,price,d.marginAtVolMax)) d.marginAtVolMax=-1;
   if(!OrderCalcMargin(t,_Symbol,1.0,price,d.marginAtOneLot)) d.marginAtOneLot=-1;

   // ================= NORMAL =================================================
   // 15/50/100 are percentages of the CURRENT, genuinely executable margin capacity,
   // recomputed from live free margin on every layer. They are never percentages of
   // the starting balance and never percentages of SYMBOL_VOLUME_MAX.
   //
   // Capacity basis, in order:
   //   A. the broker's own margin economics, when they are trustworthy;
   //   B. the owner-configured NORMAL reference leverage, when the broker/terminal
   //      reports a pathological model (e.g. 1:2000000000 with marginAt1Lot=0);
   //   C. otherwise refuse -- NORMAL_REFERENCE_LEVERAGE_REQUIRED. Never guess.
   //
   // This NEVER selects the profile. accountProfile alone decides NORMAL vs UNLIMITED.
   if(ExecutionProfile()=="NORMAL")
     {
      double calcM=0,levM=0,initM=0;bool fallback=false;
      double brokerMarginPerLot=TrustedMarginPerLot(dir,price,calcM,levM,initM,fallback);
      d.leverageMarginPerLot=levM;d.initialMarginPerLot=initM;d.usedMarginFallback=fallback;
      d.brokerReportedLeverage=AccountInfoInteger(ACCOUNT_LEVERAGE);
      d.configuredNormalReferenceLeverage=C.normalReferenceLeverage;

      // The broker margin model is trustworthy only while MONEY is what limits the
      // size. If it says the account can afford the broker's entire maximum order,
      // then the percentages would silently degrade into "% of SYMBOL_VOLUME_MAX" --
      // which is exactly the defect that sent 30 lots on a $1,000 account.
      double brokerCapacity=(brokerMarginPerLot>0)?spendable/brokerMarginPerLot:0;
      d.brokerMarginModelTrusted=(brokerMarginPerLot>0
                                  &&MathIsValidNumber(brokerMarginPerLot)
                                  &&d.volMax>0&&brokerCapacity<d.volMax);

      if(d.brokerMarginModelTrusted)
        {
         d.trustedMarginPerLot=brokerMarginPerLot;
         d.capacitySource="BROKER_MARGIN";
         d.sizingModel=fallback?"NORMAL_TRUSTED_MARGIN_FALLBACK":"NORMAL_ORDERCALC_MARGIN";
         double notional=NotionalPerLot(price);
         d.effectiveSizingLeverage=(notional>0)?(long)MathRound(notional/brokerMarginPerLot)
                                              :AccountInfoInteger(ACCOUNT_LEVERAGE);
        }
      else if(C.normalReferenceLeverage>0)
        {
         double refM=MarginPerLotAtLeverage(price,C.normalReferenceLeverage);
         if(refM<=0||!MathIsValidNumber(refM))
           {d.blockReason="NORMAL_REFERENCE_LEVERAGE_UNUSABLE_FOR_THIS_SYMBOL";return d;}
         d.trustedMarginPerLot=refM;
         d.capacitySource="NORMAL_REFERENCE_LEVERAGE";
         d.sizingModel="NORMAL_REFERENCE_LEVERAGE";
         d.effectiveSizingLeverage=C.normalReferenceLeverage;
        }
      else
        {
         // AUTO is only legal while the broker model is trustworthy. It is not.
         d.capacitySource="NONE";
         d.blockReason=StringFormat("NORMAL_REFERENCE_LEVERAGE_REQUIRED_BROKER_LEV_%I64d_MARGIN1LOT_%.6f",
                                    AccountInfoInteger(ACCOUNT_LEVERAGE),calcM);
         return d;
        }

      d.moneyCapacity=spendable/d.trustedMarginPerLot;
      // SYMBOL_VOLUME_MAX and the owner basket cap are technical ceilings that clamp the
      // result. They are never the denominator the percentage is taken from.
      d.capacity=FloorToStep(MathMin(hi,d.moneyCapacity));
      d.capacityByMargin=d.capacity;
      d.byCapacityPct=FloorToStep(d.capacity*clamp(pct,.1,100)/100.0);
      d.byMarginBudget=FloorToStep(MathMin(hi,d.budget/d.trustedMarginPerLot));
      d.requested=MathMin(d.byCapacityPct,d.byMarginBudget);
      d.marginBinding=true;

      double v=FloorToStep(d.requested);
      if(v<d.volMin)
        {
         double trustedMin=d.trustedMarginPerLot*d.volMin;
         if(trustedMin>d.budget+1e-8)
           {d.blockReason=StringFormat("MIN_LOT_TRUSTED_MARGIN_%.2f_EXCEEDS_BUDGET_%.2f",trustedMin,d.budget);return d;}
         if(C.maxBasketLots>0&&BasketVolume()+d.volMin>C.maxBasketLots){d.blockReason="BASKET_LOT_CAP_REACHED";return d;}
         v=NormalizeDouble(d.volMin,VolDigits());
        }
      if(v>hi) v=FloorToStep(hi);
      if(v<=0){d.blockReason="VOLUME_ROUNDS_TO_ZERO";return d;}

      // Broker preflight on the EXACT intended tier. A rejection here does NOT get
      // halved into a different effective percentage -- see the NORMAL branch of the
      // OpenLayer retry loop, which re-derives capacity and re-applies the SAME pct.
      if(!OrderCalcMargin(t,_Symbol,v,price,d.marginAtFinal)) d.marginAtFinal=-1;
      if(!BrokerAcceptsVolume(dir,v,price,sl,d.checkRetcode))
        {
         if(d.checkRetcode==TRADE_RETCODE_MARKET_CLOSED){NoteMarketClosed("ORDERCHECK",d.checkRetcode);d.blockReason="MARKET_CLOSED_BACKOFF";return d;}
         d.blockReason=StringFormat("NORMAL_ORDERCHECK_%d_REJECTED",d.checkRetcode);
         return d;
        }
      d.capacityByBroker=v; // only the exact intended tier was proven, not an invented max
      if(C.minMarginLevelPct>0&&d.marginAtFinal>0)
        {
         double eq=AccountInfoDouble(ACCOUNT_EQUITY);
         double used=AccountInfoDouble(ACCOUNT_MARGIN)+d.marginAtFinal;
         double lvl=used>0?(eq/used)*100.0:0;
         if(used>0&&lvl<C.minMarginLevelPct)
           {d.blockReason=StringFormat("MARGIN_LEVEL_%.1f_BELOW_%.1f",lvl,C.minMarginLevelPct);return d;}
        }
      d.finalVolume=v;
      return d;
     }

   // UNLIMITED: preserve the owner's aggressive semantics.  It may discover the largest
   // executable size by broker preflight / size-only step-down because 100% capacity is
   // exactly what this profile asks for.
   d.sizingModel="UNLIMITED_BROKER_CAPACITY";
   d.capacitySource="UNLIMITED_SERVER_CAPACITY";
   d.effectiveSizingLeverage=AccountInfoInteger(ACCOUNT_LEVERAGE);
   // v3.8.2: on a broker whose client margin model reports ~0 for gold, both
   // OrderCalcMargin and OrderCheck happily approve SYMBOL_VOLUME_MAX while the trade
   // server answers NO_MONEY. That is the "Apex believed 200 lots was executable" bug.
   // We therefore fold in what the SERVER has actually proven on this account+symbol:
   // any volume at or above a previously server-rejected size is not a real estimate.
   // This is evidence the broker already gave us -- it is not a risk cap, and it never
   // reduces a size the server has actually filled.
   double serverHi=hi;
   double learnedCeiling=ServerCapacityCeiling();
   if(learnedCeiling>0) serverHi=MathMin(serverHi,learnedCeiling);
   d.capacityByMargin=LargestVolumeWithinMargin(dir,price,spendable,serverHi);
   d.capacityByBroker=LargestVolumePassingCheck(dir,price,sl,d.capacityByMargin);
   if(MarketClosedBackoffActive()){d.blockReason="MARKET_CLOSED_BACKOFF";return d;}
   d.capacity=d.capacityByBroker;
   d.moneyCapacity=d.capacity;
   d.byCapacityPct=FloorToStep(d.capacity*clamp(pct,.1,100)/100.0);
   d.byMarginBudget=LargestVolumeWithinMargin(dir,price,d.budget,serverHi);
   d.requested=MathMin(d.byCapacityPct,d.byMarginBudget);
   d.marginBinding=(d.byMarginBudget<=d.byCapacityPct+1e-9);

   double v=FloorToStep(d.requested);
   if(v<d.volMin)
     {
      // APEX-AUDIT-009: the broker minimum is used ONLY when it independently fits the
      // budget. It is never rounded up to from an unaffordable request.
      double mmin=0;
      if(!OrderCalcMargin(t,_Symbol,d.volMin,price,mmin)||mmin>d.budget)
        {d.blockReason=StringFormat("MIN_LOT_MARGIN_%.2f_EXCEEDS_BUDGET_%.2f",mmin,d.budget);return d;}
      if(C.maxBasketLots>0&&BasketVolume()+d.volMin>C.maxBasketLots){d.blockReason="BASKET_LOT_CAP_REACHED";return d;}
      v=NormalizeDouble(d.volMin,VolDigits());
     }
   if(v>hi) v=FloorToStep(hi);
   if(v<=0){d.blockReason="VOLUME_ROUNDS_TO_ZERO";return d;}
   if(!OrderCalcMargin(t,_Symbol,v,price,d.marginAtFinal)) d.marginAtFinal=-1;
   if(!BrokerAcceptsVolume(dir,v,price,sl,d.checkRetcode))
     {
      double reduced=LargestVolumePassingCheck(dir,price,sl,v);
      if(reduced<d.volMin||reduced<=0)
        {d.blockReason=StringFormat("ORDERCHECK_%d_NO_EXECUTABLE_VOLUME",d.checkRetcode);return d;}
      v=reduced;
      if(!OrderCalcMargin(t,_Symbol,v,price,d.marginAtFinal)) d.marginAtFinal=-1;
     }
   // v3.8.2: minMarginLevelPct is an OWNER-CONFIGURED control that existed in v3.8.1 for
   // BOTH profiles.  The CapacityTruth draft moved it inside the NORMAL branch only, which
   // silently removed it from UNLIMITED.  Restored here; when the owner leaves it at 0 this
   // is a no-op, so UNLIMITED stays exactly as aggressive as configured.
   if(C.minMarginLevelPct>0&&d.marginAtFinal>0)
     {
      double eq=AccountInfoDouble(ACCOUNT_EQUITY);
      double used=AccountInfoDouble(ACCOUNT_MARGIN)+d.marginAtFinal;
      double lvl=used>0?(eq/used)*100.0:0;
      if(used>0&&lvl<C.minMarginLevelPct)
        {d.blockReason=StringFormat("MARGIN_LEVEL_%.1f_BELOW_%.1f",lvl,C.minMarginLevelPct);return d;}
     }
   d.finalVolume=v;
   return d;
  }

string SizingJson(const SizingDecision &d,int layerIndex)
  {
   return StringFormat(
     ",\"accountProfile\":\"%s\",\"layerIndex\":%d,\"marginPct\":%.4f,\"accountLeverage\":%I64d,"
     "\"freeMargin\":%.2f,\"marginLevel\":%.2f,\"budget\":%.2f,"
     "\"volMin\":%.4f,\"volMax\":%.4f,\"volStep\":%.5f,"
     "\"marginAtVolMax\":%.2f,\"marginAtOneLot\":%.2f,\"marginAtFinal\":%.2f,"
     "\"capacityByMargin\":%.4f,\"capacityByBroker\":%.4f,\"capacity\":%.4f,"
     "\"byCapacityPct\":%.4f,\"byMarginBudget\":%.4f,\"requested\":%.4f,\"finalVolume\":%.4f,"
     "\"trustedMarginPerLot\":%.4f,\"leverageMarginPerLot\":%.4f,\"initialMarginPerLot\":%.4f,"
     "\"brokerReportedLeverage\":%I64d,\"configuredNormalReferenceLeverage\":%I64d,"
     "\"effectiveSizingLeverage\":%I64d,\"brokerMarginModelTrusted\":%s,"
     "\"capacitySource\":\"%s\",\"moneyCapacity\":%.4f,"
     "\"sizingModel\":\"%s\",\"usedMarginFallback\":%s,\"marginBinding\":%s,"
     "\"orderCheckRetcode\":%d,\"sizingBlock\":\"%s\"",
     ExecutionProfile(),layerIndex,d.pct,AccountInfoInteger(ACCOUNT_LEVERAGE),
     d.freeMargin,AccountInfoDouble(ACCOUNT_MARGIN_LEVEL),d.budget,
     d.volMin,d.volMax,d.volStep,d.marginAtVolMax,d.marginAtOneLot,d.marginAtFinal,
     d.capacityByMargin,d.capacityByBroker,d.capacity,
     d.byCapacityPct,d.byMarginBudget,d.requested,d.finalVolume,
     d.trustedMarginPerLot,d.leverageMarginPerLot,d.initialMarginPerLot,
     d.brokerReportedLeverage,d.configuredNormalReferenceLeverage,
     d.effectiveSizingLeverage,BoolJson(d.brokerMarginModelTrusted),
     d.capacitySource,d.moneyCapacity,
     d.sizingModel,BoolJson(d.usedMarginFallback),
     BoolJson(d.marginBinding),d.checkRetcode,d.blockReason);
  }

// Also printed to the terminal Experts log: the live 200-lot incident could not be
// diagnosed from the log because every sizing figure only ever went to the cloud.
void PrintSizing(const SizingDecision &d,int layerIndex,int dir)
  {
   PrintFormat("APEX SIZING | profile=%s layer=L%d dir=%d pct=%.2f | leverage=1:%I64d freeMargin=%.2f budget=%.2f"
               " | volMin=%.4f volMax=%.4f step=%.5f | marginAt1Lot=%.2f marginAtVolMax=%.2f"
               " | capacityByMargin=%.4f capacityByBroker=%.4f | byCapacityPct=%.4f byMarginBudget=%.4f"
               " | requested=%.4f FINAL=%.4f marginAtFinal=%.2f"
               " | brokerLev=1:%I64d refLev=1:%I64d effLev=1:%I64d brokerMarginTrusted=%s"
               " | capacitySource=%s trustedMargin1Lot=%.2f moneyCapacity=%.4f model=%s orderCheck=%d block=%s",
               ExecutionProfile(),layerIndex,dir,d.pct,AccountInfoInteger(ACCOUNT_LEVERAGE),d.freeMargin,d.budget,
               d.volMin,d.volMax,d.volStep,d.marginAtOneLot,d.marginAtVolMax,
               d.capacityByMargin,d.capacityByBroker,d.byCapacityPct,d.byMarginBudget,
               d.requested,d.finalVolume,d.marginAtFinal,
               d.brokerReportedLeverage,d.configuredNormalReferenceLeverage,d.effectiveSizingLeverage,
               BoolJson(d.brokerMarginModelTrusted),
               d.capacitySource==""?"NONE":d.capacitySource,d.trustedMarginPerLot,d.moneyCapacity,
               d.sizingModel,d.checkRetcode,
               d.blockReason==""?"NONE":d.blockReason);
  }

//====================== broker execution (APEX-AUDIT-008) =============
// A CTrade Boolean means "the request was accepted for sending", not "a trade exists".
// v3.8.0 classifies the retcode, then reconciles against the actual deal and the actual
// position before ANY internal state (layers, master ticket, SL, lastAdd) advances.
ulong g_lastTxDeal=0; ulong g_lastTxOrder=0; ulong g_lastTxPosition=0;
double g_lastTxVolume=0,g_lastTxPrice=0; datetime g_lastTxTime=0;

void OnTradeTransaction(const MqlTradeTransaction &tx,const MqlTradeRequest &rq,const MqlTradeResult &rs)
  {
   if(tx.symbol!=_Symbol) return;
   if(tx.type==TRADE_TRANSACTION_DEAL_ADD)
     {
      if(HistoryDealSelect(tx.deal))
        {
         if(HistoryDealGetInteger(tx.deal,DEAL_MAGIC)!=InpMagic) return;
         g_lastTxDeal=tx.deal;
         g_lastTxOrder=(ulong)HistoryDealGetInteger(tx.deal,DEAL_ORDER);
         g_lastTxPosition=(ulong)HistoryDealGetInteger(tx.deal,DEAL_POSITION_ID);
         g_lastTxVolume=HistoryDealGetDouble(tx.deal,DEAL_VOLUME);
         g_lastTxPrice=HistoryDealGetDouble(tx.deal,DEAL_PRICE);
         g_lastTxTime=(datetime)HistoryDealGetInteger(tx.deal,DEAL_TIME);
        }
     }
  }

bool RetcodeIsAccepted(uint rc)
  {
   return rc==TRADE_RETCODE_DONE||rc==TRADE_RETCODE_DONE_PARTIAL||rc==TRADE_RETCODE_PLACED;
  }

// Reconciles one submitted market order against broker facts.
void ReconcileSubmission(double requested,int posBefore,double volBefore,ExecResult &e)
  {
   e.deal=trade.ResultDeal();
   e.order=trade.ResultOrder();
   e.filledVolume=trade.ResultVolume();
   e.fillPrice=trade.ResultPrice();

   // Give the terminal a bounded window to publish the deal/position (partial fills and
   // exchange-execution brokers report asynchronously).
   for(int i=0;i<20;i++)
     {
      if(e.deal==0&&g_lastTxDeal!=0&&g_lastTxTime>=TimeCurrent()-5) e.deal=g_lastTxDeal;
      if(e.deal!=0&&HistoryDealSelect(e.deal))
        {
         e.position=(ulong)HistoryDealGetInteger(e.deal,DEAL_POSITION_ID);
         double dv=HistoryDealGetDouble(e.deal,DEAL_VOLUME);
         if(dv>0) e.filledVolume=dv;
         double dp=HistoryDealGetDouble(e.deal,DEAL_PRICE);
         if(dp>0) e.fillPrice=dp;
         break;
        }
      if(CountPos()>posBefore||BasketVolume()>volBefore+1e-9) break;
      Sleep(50);
     }
   double volAfter=BasketVolume();
   int posAfter=CountPos();
   double delta=volAfter-volBefore;
   if(e.filledVolume<=0&&delta>1e-9) e.filledVolume=delta;

   if(e.filledVolume<=1e-9&&posAfter<=posBefore)
     {
      e.cls=EXEC_UNCONFIRMED;
      e.detail="NO_DEAL_NO_POSITION_DELTA";
      return;
     }
   if(e.filledVolume+1e-9<requested)
     {
      e.cls=EXEC_PARTIAL;
      e.detail=StringFormat("PARTIAL_%.4f_OF_%.4f",e.filledVolume,requested);
      return;
     }
   e.cls=EXEC_FILLED;
   e.detail="FILLED";
  }

ExecResult SubmitMarket(int dir,double vol,double sl,string comment)
  {
   ExecResult e;
   e.cls=EXEC_NONE;e.retcode=0;e.deal=0;e.order=0;e.position=0;
   e.requestedVolume=vol;e.filledVolume=0;e.fillPrice=0;e.mt5Error=0;e.detail="";
   int posBefore=CountPos();
   double volBefore=BasketVolume();
   g_lastTxDeal=0;
   trade.SetExpertMagicNumber(InpMagic);
   trade.SetDeviationInPoints(80);
   ENUM_ORDER_TYPE_FILLING filling;
   if(!ResolveFillingMode(filling))
     {e.cls=EXEC_REJECTED;e.retcode=TRADE_RETCODE_INVALID_FILL;e.detail="NO_SUPPORTED_FILLING_MODE";return e;}
   trade.SetTypeFilling(filling);
   ResetLastError();
   bool sent=dir>0?trade.Buy(vol,_Symbol,0,sl,0,comment):trade.Sell(vol,_Symbol,0,sl,0,comment);
   e.retcode=trade.ResultRetcode();
   e.mt5Error=GetLastError();
   if(e.retcode==TRADE_RETCODE_MARKET_CLOSED) NoteMarketClosed("MARKET_ORDER",e.retcode);
   else ResetMarketClosedBackoff();
   if(!sent&&!RetcodeIsAccepted(e.retcode))
     {
      e.cls=EXEC_REJECTED;
      e.detail=trade.ResultRetcodeDescription();
      // A rejection can still race a fill on some bridges; verify before believing it.
      Sleep(50);
      if(CountPos()>posBefore||BasketVolume()>volBefore+1e-9) ReconcileSubmission(vol,posBefore,volBefore,e);
      return e;
     }
   if(e.retcode==TRADE_RETCODE_PLACED)
     {
      ReconcileSubmission(vol,posBefore,volBefore,e);
      if(e.cls==EXEC_UNCONFIRMED){e.cls=EXEC_PENDING;e.detail="ORDER_PLACED_NOT_YET_FILLED";}
      return e;
     }
   ReconcileSubmission(vol,posBefore,volBefore,e);
   return e;
  }

// APEX-AUDIT-008: an SL is only "applied" once the broker's own position reports it.
bool SetMasterSL(double newSL,string reason)
  {
   if(masterTicket==0||!MasterPositionExists()) return false;
   if(MarketClosedBackoffActive()) return false;
   int digits=(int)SymbolInfoInteger(_Symbol,SYMBOL_DIGITS);
   newSL=NormalizeDouble(newSL,digits);
   double tol=MathMax(SymbolInfoDouble(_Symbol,SYMBOL_POINT),MathPow(10.0,-digits))*2.0;
   trade.SetExpertMagicNumber(InpMagic);
   ResetLastError();
   bool sent=trade.PositionModify(masterTicket,newSL,0);
   uint rc=trade.ResultRetcode();
   int err=GetLastError();
   if(rc==TRADE_RETCODE_MARKET_CLOSED) NoteMarketClosed("POSITION_MODIFY",rc);
   else if(sent) ResetMarketClosedBackoff();
   // Read the SL back from the live position. The request result is never enough.
   double applied=0;
   bool readOk=false;
   for(int i=0;i<10;i++)
     {
      if(PositionSelectByTicket(masterTicket))
        {applied=PositionGetDouble(POSITION_SL);readOk=true;
         if(MathAbs(applied-newSL)<=tol) break;}
      Sleep(30);
     }
   if(readOk&&MathAbs(applied-newSL)<=tol)
     {
      firstSLPrice=applied;
      SaveState();
      Emit("MASTER_SL_MOVED",StringFormat(",\"stage\":%d,\"requestedSL\":%.5f,\"appliedSL\":%.5f,\"retcode\":%d,\"reason\":\"%s\",\"verified\":true",
           masterGuardStage,newSL,applied,rc,reason));
      return true;
     }
   Emit("MASTER_SL_MOVE_FAIL",StringFormat(",\"stage\":%d,\"requestedSL\":%.5f,\"brokerSL\":%.5f,\"sent\":%s,\"retcode\":%d,\"error\":%d,\"reason\":\"%s\",\"verified\":false",
        masterGuardStage,newSL,applied,BoolJson(sent),rc,err,reason));
   return false;   // internal SL state is NOT advanced on an unverified modification
  }

//====================== market data ===================================
double ATR()
  {
   double x[];ArraySetAsSeries(x,true);
   if(CopyBuffer(hAtr,0,0,2,x)<2)return 0;
   return x[1];
  }
bool Rates(ENUM_TIMEFRAMES tf,int n,MqlRates &r[])
  {ArraySetAsSeries(r,true);return CopyRates(_Symbol,tf,0,n,r)>=n-2;}

//====================== setup lifecycle (APEX-AUDIT-003) ==============
void SetupReset(string reason)
  {
   if(S.state==SETUP_WATCHING||S.state==SETUP_CONFIRMED)
      Emit("SETUP_CANCELLED",StringFormat(",\"setupId\":\"%s\",\"setupDir\":%d,\"cancelReason\":\"%s\",\"extreme\":%.5f,\"ageSec\":%d",
           S.id,S.dir,reason,S.extreme,(int)(TimeCurrent()-S.armedAt)));
   S.state=SETUP_NONE;S.id="";S.dir=0;S.sig="";S.cancelReason=reason;
   S.armedAt=0;S.sweepBarTime=0;S.confirmedAt=0;S.triggerBarTime=0;
   S.extreme=0;S.prior=0;S.atr=0;S.triggerPrice=0;S.bosKind="";
   S.originHigh=0;S.originLow=0;S.originClose=0;S.originOpen=0;S.originBarTime=0;
   S.execHigh=0;S.execLow=0;
   S.dead=false;S.deadReason="";
  }
string NewSetupId()
  {
   return StringFormat("S%I64d-%08x",(long)TimeCurrent(),
      Fnv1a(g_instanceId+IntegerToString((int)GetTickCount())+IntegerToString(MathRand())));
  }
void ArmSetup(int dir,datetime sweepBar,double extreme,double prior,double atr,double impulseMult)
  {
   S.state=SETUP_WATCHING;
   S.id=NewSetupId();
   S.dir=dir;
   S.armedAt=TimeCurrent();
   S.sweepBarTime=sweepBar;
   S.extreme=extreme;S.prior=prior;S.atr=atr;
   S.confirmedAt=0;S.triggerBarTime=0;S.triggerPrice=0;S.bosKind="";S.cancelReason="";
   S.originHigh=0;S.originLow=0;S.originClose=0;S.originOpen=0;S.originBarTime=0;
   S.execHigh=0;S.execLow=0;
   S.dead=false;S.deadReason="";
   S.sig=dir<0?"SELL_UPSIDE_LIQUIDITY_EXHAUST":"BUY_DOWNSIDE_LIQUIDITY_EXHAUST";
   Emit("WATCH_ARMED",StringFormat(",\"setupId\":\"%s\",\"watchDir\":%d,\"impulseAtr\":%.3f,\"extreme\":%.5f,\"priorLevel\":%.5f,\"sweepBarTime\":%I64d",
        S.id,dir,impulseMult,extreme,prior,(long)sweepBar));
  }

//====================== entry-location / thesis-identity helpers ======
// MODEL C (kept): the executable region is the DISPLACEMENT ORIGIN, not the
// full confirmation candle. For a SELL that is the premium/upper half of the
// bar, tightened to the body origin (open) when the open sits in that half.
// Full-range (MODEL A) lets the dump-close count as an entry. Body-only
// (MODEL B) still includes the close of a bearish displacement. Replay in
// tests/native/main.cpp compares the three; MODEL C is the architecture.
void ComputeExecRegion(int dir,double barHigh,double barLow,double barOpen,double barClose,
                       double &execHigh,double &execLow)
  {
   if(barHigh<barLow){double t=barHigh;barHigh=barLow;barLow=t;}
   if(barHigh<=barLow){barHigh+=_Point;barLow-=_Point;}
   double mid=barLow+0.5*(barHigh-barLow);
   if(dir<0)
     {
      execHigh=barHigh;
      execLow=MathMax(mid,barOpen);
      if(execLow>=execHigh) execLow=mid;
      if(execLow>=execHigh) execLow=execHigh-_Point;
     }
   else
     {
      execLow=barLow;
      execHigh=MathMin(mid,barOpen);
      if(execHigh<=execLow) execHigh=mid;
      if(execHigh<=execLow) execHigh=execLow+_Point;
     }
  }
bool PriceInExecRegion(int dir,double bid,double ask,double execHigh,double execLow)
  {
   if(execHigh<=execLow) return false;
   if(dir<0) return (bid<=execHigh && bid>=execLow);
   return (ask>=execLow && ask<=execHigh);
  }

// Swing highs/lows with rolling-window fallback. Extracted so replay can
// compare this against a pure rolling window on the same tape.
void LiquidityRefs(MqlRates &m1[],int n,bool useSwing,double &ph,double &pl)
  {
   ph=-DBL_MAX;pl=DBL_MAX;
   int hi=MathMin(n-1,79);
   if(useSwing && n>12)
     {
      bool haveH=false,haveL=false;
      for(int i=10;i<hi;i++)
        {
         if(i-1<0||i+1>=n) continue;
         if(m1[i].high>m1[i-1].high&&m1[i].high>m1[i+1].high){ph=MathMax(ph,m1[i].high);haveH=true;}
         if(m1[i].low<m1[i-1].low&&m1[i].low<m1[i+1].low){pl=MathMin(pl,m1[i].low);haveL=true;}
        }
      if(haveH&&haveL) return;
     }
   ph=-DBL_MAX;pl=DBL_MAX;
   int start=useSwing?9:9;
   for(int i=start;i<=hi;i++){ph=MathMax(ph,m1[i].high);pl=MathMin(pl,m1[i].low);}
  }

void RememberDeadThesis()
  {
   g_deadThesisActive=true;
   g_deadThesisDir=S.dir;
   g_deadThesisExtreme=S.extreme;
   g_deadThesisPrior=S.prior;
   g_deadThesisSweep=S.sweepBarTime;
  }
void MaybeClearDeadThesis(int imp,double impulseMult,double needAtr)
  {
   // Opposite impulse of the original size = a new displacement cycle.
   if(!g_deadThesisActive) return;
   if(impulseMult<needAtr) return;
   if((-imp)!=g_deadThesisDir) g_deadThesisActive=false;
  }
bool DeadThesisBlocks(int setupDir,double newExtreme,double newPrior,double atr)
  {
   if(!g_deadThesisActive||setupDir!=g_deadThesisDir) return false;
   double tol=(atr>0?C.sweepAtr*atr:_Point);
   bool extending=(setupDir<0)?(newExtreme>=g_deadThesisExtreme):(newExtreme<=g_deadThesisExtreme);
   bool samePool=(setupDir<0)
      ?(newPrior>=g_deadThesisPrior-tol && newPrior<=g_deadThesisExtreme+tol)
      :(newPrior<=g_deadThesisPrior+tol && newPrior>=g_deadThesisExtreme-tol);
   return extending&&samePool;
  }

//====================== observation ===================================
// The detector itself is UNCHANGED from v3.7.1 (impulse -> sweep -> rejection -> BOS).
// What changed:
//   003  a new extreme beyond the watched one RE-ARMS a fresh setup instead of leaving
//        the dead one frozen until its timer runs out;
//   006  the BOS predicate is explicit and its kind is reported truthfully;
//   007  missing M3/M5 history is no longer a hard dependency when the filter is off.
Snap Observe()
  {
   Snap s;
   s.valid=false;s.dir=0;s.score=0;s.atr=ATR();s.price=0;s.extreme=0;
   s.impulseMult=0;s.sweepMult=0;s.wickRatio=0;s.swept=false;s.rejected=false;s.microBreak=false;
   s.m3Color=false;s.m5Color=false;s.m3Fresh=false;s.continuation=false;s.pullbackFail=false;
   s.sig="NONE";s.reason="";s.bosKind="NONE";s.triggerBarTime=0;s.triggerPrice=0;
   s.originHigh=0;s.originLow=0;s.originClose=0;s.originOpen=0;s.originBarTime=0;
   s.execHigh=0;s.execLow=0;s.inLocation=false;s.locationNow=false;
   if(s.atr<=0){s.reason="NO_ATR";return s;}

   MqlRates m1[],m3[],m5[];
   if(!Rates(PERIOD_M1,90,m1)){s.reason="NO_M1_HISTORY";return s;}
   // APEX-AUDIT-007: optional-timeframe history is now NON-FATAL. It is still requested
   // because the ranking score consumes the candle-colour context (intended behaviour),
   // but its absence can no longer disable the M1 scanner. It is only MANDATORY when the
   // corresponding filter is switched on.
   bool m3Available=Rates(PERIOD_M3,24,m3);
   bool m5Available=Rates(PERIOD_M5,18,m5);

   double move=m1[1].close-m1[8].close;
   int imp=move>=0?1:-1;
   s.impulseMult=MathAbs(move)/s.atr;
   int directional=0;
   for(int i=1;i<=7;i++)
      if((imp>0&&m1[i].close>m1[i].open)||(imp<0&&m1[i].close<m1[i].open))directional++;

   double ph=0,pl=0;
   LiquidityRefs(m1,ArraySize(m1),true,ph,pl);
   MaybeClearDeadThesis(imp,s.impulseMult,C.impulseAtr);

   // --- APEX-AUDIT-003: a watch whose premise the market has destroyed must die, and a
   // --- genuinely new sweep must be able to take its place immediately.
   if(S.state==SETUP_WATCHING||S.state==SETUP_CONFIRMED)
     {
      datetime ageFrom=(S.state==SETUP_CONFIRMED&&S.confirmedAt>0)?S.confirmedAt:S.armedAt;
      if(TimeCurrent()-ageFrom>C.watchExpiryMinutes*60)
        {S.state=SETUP_EXPIRED;SetupReset("EXPIRED");}
      else
        {
         // a later bar printing an extreme BEYOND the swept one means the rejection failed
         bool newExtreme=false;
         for(int i=1;i<=8;i++)
           {
            if(m1[i].time<=S.sweepBarTime)break;
            if(S.dir<0&&m1[i].high>S.extreme){newExtreme=true;break;}
            if(S.dir>0&&m1[i].low<S.extreme){newExtreme=true;break;}
           }
         if(newExtreme)
           {
            if(S.state==SETUP_CONFIRMED)
              {
               g_noRearmBeforeBar=m1[1].time;g_noRearmDir=S.dir;
               RememberDeadThesis();
               S.dead=true;S.deadReason="NEW_EXTREME_BEYOND_SWEPT_LEVEL";
               S.state=SETUP_INVALIDATED;SetupReset("NEW_EXTREME_BEYOND_SWEPT_LEVEL");
              }
            else
              {
               double updated=S.extreme;datetime updatedSweep=S.sweepBarTime;
               for(int i=1;i<=8;i++)
                 {
                  if(m1[i].time<=S.sweepBarTime)break;
                  if(S.dir<0&&m1[i].high>updated){updated=m1[i].high;updatedSweep=m1[i].time;}
                  if(S.dir>0&&m1[i].low<updated){updated=m1[i].low;updatedSweep=m1[i].time;}
                 }
               // Local BOS of the running high: prior becomes the high we just replaced.
               S.prior=S.extreme;
               S.extreme=updated;S.sweepBarTime=updatedSweep;
               Emit("WATCH_EXTREME_UPDATED",StringFormat(
                    ",\"setupId\":\"%s\",\"watchDir\":%d,\"extreme\":%.5f,\"sweepBarTime\":%I64d",
                    S.id,S.dir,S.extreme,(long)S.sweepBarTime));
              }
           }
        }
     }

   bool canArm=(S.state==SETUP_NONE);
   if(canArm&&g_noRearmDir!=0&&m1[1].time<=g_noRearmBeforeBar&&(-imp)==g_noRearmDir)
      canArm=false;
   if(canArm&&g_noRearmDir!=0&&m1[1].time>g_noRearmBeforeBar)
      g_noRearmDir=0;
   if(canArm&&s.impulseMult>=C.impulseAtr&&directional>=5)
     {
      double ex=imp>0?m1[1].high:m1[1].low;
      double priorRef=imp>0?ph:pl;
      bool swept=imp>0?ex>=ph+C.sweepAtr*s.atr:ex<=pl-C.sweepAtr*s.atr;
      if(swept&&!DeadThesisBlocks(-imp,ex,priorRef,s.atr))
         ArmSetup(-imp,m1[1].time,ex,priorRef,s.atr,s.impulseMult);
     }

   if(S.state!=SETUP_WATCHING&&S.state!=SETUP_CONFIRMED){s.reason="NO_ACTIVE_SETUP";return s;}

   s.dir=S.dir;s.sig=S.sig;s.extreme=S.extreme;s.swept=true;
   s.impulseMult=MathAbs(m1[1].close-m1[8].close)/s.atr;
   s.price=s.dir>0?SymbolInfoDouble(_Symbol,SYMBOL_ASK):SymbolInfoDouble(_Symbol,SYMBOL_BID);
   s.originHigh=S.originHigh;s.originLow=S.originLow;s.originClose=S.originClose;
   s.originBarTime=S.originBarTime;
   s.triggerBarTime=S.triggerBarTime;s.triggerPrice=S.triggerPrice;s.bosKind=S.bosKind;

   int rb=MathMax(1,MathMin(C.rejectionBars,8));
   bool rej=false;double bestW=0;
   for(int i=1;i<=rb;i++)
     {
      if(m1[i].time<=S.sweepBarTime)continue;
      double body=MathMax(_Point,MathAbs(m1[i].close-m1[i].open));
      double up=m1[i].high-MathMax(m1[i].open,m1[i].close);
      double lo=MathMin(m1[i].open,m1[i].close)-m1[i].low;
      if(s.dir<0)
        {bestW=MathMax(bestW,up/body);
         if(m1[i].high>=S.extreme-C.rejectionZoneAtr*s.atr&&m1[i].close<S.prior)rej=true;}
      else
        {bestW=MathMax(bestW,lo/body);
         if(m1[i].low<=S.extreme+C.rejectionZoneAtr*s.atr&&m1[i].close>S.prior)rej=true;}
     }

   // --- APEX-AUDIT-006: explicit, truthfully-named confirmation predicate.
   // BOS_V371_CLOSE_OR_WICK is byte-for-byte the v3.7.1 rule; nothing is removed by default.
   bool bos=false;string bosKind="NONE";
   if(m1[1].time>S.sweepBarTime)
     {
      bool closeBreak = s.dir<0 ? (m1[1].close<m1[2].low) : (m1[1].close>m1[2].high);
      bool wickConfirm= s.dir<0 ? (m1[1].low<m1[3].low  && m1[1].close<m1[2].open)
                                : (m1[1].high>m1[3].high&& m1[1].close>m1[2].open);
      if(closeBreak){bos=true;bosKind="CLOSE_BREAK_PRIOR_BAR_EXTREME";}
      else if(InpBosMode==BOS_V371_CLOSE_OR_WICK&&wickConfirm){bos=true;bosKind="WICK_BREACH_3BAR_PLUS_CLOSE_BEYOND_PRIOR_OPEN";}
     }
   s.rejected=rej;s.microBreak=bos;s.wickRatio=bestW;s.bosKind=bosKind;
   if(bos){s.triggerBarTime=m1[1].time;s.triggerPrice=m1[1].close;}

   if(m3Available)
     {
      s.m3Color=s.dir<0?(m3[1].close<m3[1].open&&m3[1].close<(m3[1].high+m3[1].low)/2)
                       :(m3[1].close>m3[1].open&&m3[1].close>(m3[1].high+m3[1].low)/2);
      s.m3Fresh=(m3[1].time>=S.sweepBarTime);
     }
   if(m5Available)
      s.m5Color=s.dir<0?m5[1].close<m5[1].open:m5[1].close>m5[1].open;

   // Ranking score. UNCALIBRATED and UNCHANGED numerically from v3.7.1. It is a ranking,
   // not a probability: with the mandatory gates satisfied the score already exceeds the
   // default entryScore threshold, so the threshold is informational at those defaults.
   // The redundancy is reported (scoreFloorGivenMandatory) rather than silently repaired
   // by inventing new weights -- calibration needs held-out labelled data we do not have.
   double score=APEX_SCORE_BASE
               +clamp(s.impulseMult/C.impulseAtr*15,0,18)
               +(s.rejected?24:0)+(s.microBreak?22:0)
               +(s.m3Color?8:0)+(s.m5Color?3:0)
               +clamp(bestW*2,0,5);
   s.score=clamp(score,0,100);

   bool m3Gate=(!C.requireM3Confirm)||(s.m3Color&&(!InpRequireFreshM3||s.m3Fresh));
   bool m5Gate=(!C.requireM5Context)||s.m5Color;
   if(C.requireM3Confirm&&!m3Available){s.reason="M3_HISTORY_UNAVAILABLE_BUT_REQUIRED";return s;}
   if(C.requireM5Context&&!m5Available){s.reason="M5_HISTORY_UNAVAILABLE_BUT_REQUIRED";return s;}

   double threshold=C.entryScore+(C.learningEnabled?C.learnEntryAdj:0);
   bool newlyConfirmed=s.rejected&&s.microBreak&&m3Gate&&m5Gate&&s.score>=threshold;
   if(S.state==SETUP_CONFIRMED)
     {
      double liveBid=SymbolInfoDouble(_Symbol,SYMBOL_BID);
      double liveAsk=SymbolInfoDouble(_Symbol,SYMBOL_ASK);
      bool reclaimed=(S.dir<0)?(liveAsk>=S.extreme):(liveBid<=S.extreme);
      if(reclaimed&&InpRejectReclaimedExtreme)
        {
         RememberDeadThesis();
         g_noRearmBeforeBar=m1[1].time;g_noRearmDir=S.dir;
         S.state=SETUP_INVALIDATED;SetupReset("RECLAIMED_INVALIDATION_LEVEL");
         s.valid=false;s.reason="SETUP_DEAD_RECLAIMED";s.inLocation=false;
         return s;
        }
      s.valid=true;
      s.triggerBarTime=S.triggerBarTime;
      s.triggerPrice=S.triggerPrice;
      s.bosKind=S.bosKind;
      s.originHigh=S.originHigh;s.originLow=S.originLow;s.originClose=S.originClose;
      s.originOpen=S.originOpen;s.originBarTime=S.originBarTime;
      s.execHigh=S.execHigh;s.execLow=S.execLow;
     }
   else
     {
      s.valid=newlyConfirmed;
      s.reason=s.valid?"SETUP_CONFIRMED_ORIGIN_STORED":"WATCHING_FOR_REJECTION_AND_BOS";
      if(s.valid)
        {
         S.state=SETUP_CONFIRMED;S.confirmedAt=TimeCurrent();
         S.triggerBarTime=s.triggerBarTime;S.triggerPrice=s.triggerPrice;S.bosKind=bosKind;
         S.originHigh=m1[1].high;S.originLow=m1[1].low;S.originClose=m1[1].close;S.originOpen=m1[1].open;
         S.originBarTime=m1[1].time;
         if(S.originHigh<S.originLow){double _t=S.originHigh;S.originHigh=S.originLow;S.originLow=_t;}
         if(S.originHigh==S.originLow){S.originHigh+=_Point;S.originLow-=_Point;}
         ComputeExecRegion(S.dir,S.originHigh,S.originLow,S.originOpen,S.originClose,S.execHigh,S.execLow);
         s.originHigh=S.originHigh;s.originLow=S.originLow;s.originClose=S.originClose;
         s.originOpen=S.originOpen;s.originBarTime=S.originBarTime;
         s.execHigh=S.execHigh;s.execLow=S.execLow;
         Emit("SETUP_LOCATED",StringFormat(
              ",\"setupId\":\"%s\",\"setupDir\":%d,\"originHigh\":%.5f,\"originLow\":%.5f,"
              "\"originClose\":%.5f,\"originOpen\":%.5f,\"execHigh\":%.5f,\"execLow\":%.5f,"
              "\"originBarTime\":%I64d,\"extreme\":%.5f,\"bosKind\":\"%s\"",
              S.id,S.dir,S.originHigh,S.originLow,S.originClose,S.originOpen,S.execHigh,S.execLow,
              (long)S.originBarTime,S.extreme,S.bosKind));
        }
     }
   if(S.execHigh>S.execLow)
     {
      double liveBid=SymbolInfoDouble(_Symbol,SYMBOL_BID);
      double liveAsk=SymbolInfoDouble(_Symbol,SYMBOL_ASK);
      s.inLocation=PriceInExecRegion(s.dir,liveBid,liveAsk,S.execHigh,S.execLow);
      s.locationNow=s.inLocation;
      s.execHigh=S.execHigh;s.execLow=S.execLow;
     }
   else s.inLocation=false;
   if(S.state==SETUP_CONFIRMED)
      s.reason=s.inLocation?"RETEST_EXECUTABLE":"WAITING_FOR_ENTRY_LOCATION";
   return s;
  }

// The minimum score a setup can have once every mandatory gate is satisfied -- reported
// so the dashboard can show honestly whether entryScore is actually binding.
double ScoreFloorGivenMandatory()
  {
   return APEX_SCORE_BASE+24+22+(C.requireM3Confirm?8:0)+(C.requireM5Context?3:0);
  }

//====================== final executable-price gate (APEX-AUDIT-001) ==
struct Gate
  {
   bool     ok;
   string   reason;
   double   bid,ask,price,extensionAtr;
   long     quoteAgeMs;
   bool     reclaimed,triggerStale,quoteStale,extended;
   bool     inLocation,leftLocation;
  };

// Run IMMEDIATELY before every submission, and again after anything that can block.
// "The setup happened" and "this is still an executable price" are separate questions.
bool FinalEntryGate(int dir,double invalidLevel,double refPrice,double atr,
                    datetime triggerBar,bool enforceReclaim,Gate &g,
                    double originHigh=0,double originLow=0)
  {
   g.ok=false;g.reason="";g.bid=0;g.ask=0;g.price=0;g.extensionAtr=0;g.quoteAgeMs=0;
   g.reclaimed=false;g.triggerStale=false;g.quoteStale=false;g.extended=false;
   g.inLocation=false;g.leftLocation=false;

   MqlTick tk;
   if(!SymbolInfoTick(_Symbol,tk)||tk.bid<=0||tk.ask<=0){g.reason="NO_FRESH_QUOTE";return false;}
   g.bid=tk.bid;g.ask=tk.ask;
   g.price=dir>0?tk.ask:tk.bid;
   g.quoteAgeMs=(long)TimeCurrent()*1000-(long)tk.time_msc;
   if(g.quoteAgeMs<0)g.quoteAgeMs=0;

   if(InpMaxQuoteAgeMs>0&&g.quoteAgeMs>InpMaxQuoteAgeMs)
     {g.quoteStale=true;g.reason=StringFormat("STALE_QUOTE_%I64dms",g.quoteAgeMs);return false;}

   // v3.8.3: a newer closed M1 than the origin/trigger bar is the RETEST.
   // triggerStale is measured for telemetry and NEVER blocks.
   if(triggerBar>0)
     {
      datetime lastClosed=iTime(_Symbol,PERIOD_M1,1);
      if(lastClosed!=triggerBar)
        {g.triggerStale=true;
         if(InpRequireFreshTrigger)
            g.reason=StringFormat("TRIGGER_BAR_NO_LONGER_LATEST_%I64d_vs_%I64d",(long)triggerBar,(long)lastClosed);
        }
     }

   // The setup's OWN rejected extreme is the invalidation level. No invented threshold.
   if(enforceReclaim&&InpRejectReclaimedExtreme&&invalidLevel>0)
     {
      bool reclaimed=(dir<0)?(g.ask>=invalidLevel):(g.bid<=invalidLevel);
      if(reclaimed)
        {g.reclaimed=true;
         g.reason=StringFormat("RECLAIMED_INVALIDATION_LEVEL_%.5f",invalidLevel);
         return false;}
     }

   // Executable region of THIS submission (first entry = displacement origin;
   // adds = that add family's own location). Empty 0/0 means "no location
   // constraint on this call" and is only legal for callers that already
   // enforced campaign invalidation some other way. Schema-3 campaigns never
   // reach here: ComputePreflight returns ANCHORS_UNRECONCILED.
   if(originHigh>originLow)
     {
      g.inLocation=(dir<0)?(g.bid<=originHigh&&g.bid>=originLow)
                          :(g.ask>=originLow&&g.ask<=originHigh);
      if(!g.inLocation)
        {g.leftLocation=true;
         g.reason=StringFormat("PRICE_LEFT_ORIGIN_BOX_%.5f_%.5f",originLow,originHigh);
         return false;}
     }
   else g.inLocation=true;

   if(atr>0&&refPrice>0)
     {
      double ext=(dir<0)?(refPrice-g.bid)/atr:(g.ask-refPrice)/atr;
      g.extensionAtr=ext;
      // OWNER DECISION REQUIRED: unvalidated numeric threshold. SHADOW by default --
      // it is measured and reported on every entry, and blocks nothing unless the
      // owner explicitly sets GATE_ENFORCE.
      if(ext>InpMaxEntryExtensionAtr)
        {
         g.extended=true;
         if(InpEntryExtensionMode==GATE_ENFORCE)
           {g.reason=StringFormat("EXTENDED_%.2fATR_BEYOND_TRIGGER",ext);return false;}
        }
     }
   g.ok=true;g.reason="OK";
   return true;
  }

//====================== preflight (APEX-AUDIT-014/027) ================
// Reports why NEW exposure is refused. Protection/closing of already-open positions is
// never gated by this -- an existing basket is always managed.
string ComputePreflight()
  {
   if(g_observerOnly) return "OBSERVER_ONLY_SECOND_INSTANCE";
   if(!(bool)TerminalInfoInteger(TERMINAL_CONNECTED)) return "TERMINAL_DISCONNECTED";
   if(!(bool)TerminalInfoInteger(TERMINAL_TRADE_ALLOWED)) return "TERMINAL_TRADE_DISABLED";
   if(!(bool)MQLInfoInteger(MQL_TRADE_ALLOWED)) return "EA_TRADE_DISABLED";
   if(!IsTester())
     {
      if(!(bool)AccountInfoInteger(ACCOUNT_TRADE_ALLOWED)) return "ACCOUNT_TRADE_DISABLED";
      if(!(bool)AccountInfoInteger(ACCOUNT_TRADE_EXPERT)) return "ACCOUNT_EXPERT_TRADING_DISABLED";
     }
   if(MarketClosedBackoffActive()) return "MARKET_CLOSED_BACKOFF";
   ENUM_ORDER_TYPE_FILLING filling;
   if(!ResolveFillingMode(filling)) return "NO_SUPPORTED_FILLING_MODE";
   ENUM_ACCOUNT_MARGIN_MODE mm=(ENUM_ACCOUNT_MARGIN_MODE)AccountInfoInteger(ACCOUNT_MARGIN_MODE);
   // Platform capability, not a risk policy: a netting account merges positions, so a
   // multi-layer basket, masterTicket and per-layer state cannot be represented at all.
   if(mm!=ACCOUNT_MARGIN_MODE_RETAIL_HEDGING&&!InpAllowNettingAccounts) return "UNSUPPORTED_ACCOUNT_MODE_NETTING";
   long tm=SymbolInfoInteger(_Symbol,SYMBOL_TRADE_MODE);
   if(tm==SYMBOL_TRADE_MODE_DISABLED||tm==SYMBOL_TRADE_MODE_CLOSEONLY) return "SYMBOL_TRADE_MODE_RESTRICTED";
   if(g_cloudExplicitDenied) return "LICENSE_DENIED";
   if(campState==CAMP_CLOSING) return "CAMPAIGN_CLOSING";
   if(campState!=CAMP_IDLE&&!anchorsKnown) return "ANCHORS_UNRECONCILED";
   return "";
  }

//====================== layer submission ==============================
double LayerMarginPct()
  {
   if(ExecutionProfile()=="NORMAL")
     {
      // APEX-AUDIT-012: these now come from C.* (dashboard), seeded from the Inputs.
      if(layers<=0) return MathMax(0.1,MathMin(100.0,C.normalL1MarginPct));
      if(layers==1) return MathMax(0.1,MathMin(100.0,C.normalL2MarginPct));
      return MathMax(0.1,MathMin(100.0,C.normalL3PlusMarginPct));
     }
   return MathMin(100.0,C.baseMarginPct*MathPow(C.layerMultiplier,layers));
  }

// A rejection that is purely about SIZE. Anything else stops the descent immediately.
bool IsSizeOnlyRejection(uint rc,int mt5err)
  {
   return rc==TRADE_RETCODE_NO_MONEY||rc==TRADE_RETCODE_INVALID_VOLUME||
          rc==TRADE_RETCODE_LIMIT_VOLUME||mt5err==134/*ERR_NOT_ENOUGH_MONEY*/;
  }

bool OpenLayer(int dir,double score,string why,double invalidLevel,double refPrice,
               double atr,datetime triggerBar,bool enforceReclaim,
               double originHigh=0,double originLow=0)
  {
   g_preflightBlock=ComputePreflight();
   if(g_preflightBlock!="")
     {Emit("ENTRY_BLOCKED",StringFormat(",\"reason\":\"%s\",\"stage\":\"PREFLIGHT\",\"why\":\"%s\"",g_preflightBlock,why));return false;}

   double pct=LayerMarginPct();
   int layerIndex=layers+1;
   bool firstNormal=(ExecutionProfile()=="NORMAL"&&layers==0);
   int digits=(int)SymbolInfoInteger(_Symbol,SYMBOL_DIGITS);

   // FINAL executable-price eligibility, immediately before sizing and submission.
   Gate g;
   ulong decidedAt=GetTickCount64();
   if(!FinalEntryGate(dir,invalidLevel,refPrice,atr,triggerBar,enforceReclaim,g,originHigh,originLow))
     {
      Emit("ENTRY_REJECTED_AT_GATE",StringFormat(
         ",\"reason\":\"%s\",\"bid\":%.5f,\"ask\":%.5f,\"invalidationLevel\":%.5f,\"referencePrice\":%.5f,"
         "\"extensionAtr\":%.3f,\"quoteAgeMs\":%I64d,\"why\":\"%s\",\"setupId\":\"%s\"",
         g.reason,g.bid,g.ask,invalidLevel,refPrice,g.extensionAtr,g.quoteAgeMs,why,S.id));
      return false;
     }
   double sl=0;
   if(firstNormal&&C.normalFixedSLGoldMove>0)
      sl=NormalizeDouble(dir>0?g.price-C.normalFixedSLGoldMove:g.price+C.normalFixedSLGoldMove,digits);

   SizingDecision d=ComputeVolume(dir,pct,g.price,sl);
   PrintSizing(d,layerIndex,dir);
   if(d.finalVolume<=0)
     {
      Emit("ADD_BLOCKED",StringFormat(",\"reason\":\"%s\",\"stage\":\"SIZING\",\"why\":\"%s\"%s",
           d.blockReason==""?"NO_EXECUTABLE_VOLUME":d.blockReason,why,SizingJson(d,layerIndex)));
      return false;
     }

   double vol=d.finalVolume;
   string com=StringFormat("APEX L%d %.0f",layerIndex,score);
   ExecResult e;
   int attempt=0;
   ulong submittedAt=0,settledAt=0;
   while(true)
     {
      // Re-validate the executable price before EVERY submission attempt.
      if(attempt>0&&!FinalEntryGate(dir,invalidLevel,refPrice,atr,triggerBar,enforceReclaim,g,originHigh,originLow))
        {
         Emit("ENTRY_REJECTED_AT_GATE",StringFormat(
            ",\"reason\":\"%s\",\"stage\":\"SIZING_RETRY\",\"attempt\":%d,\"why\":\"%s\",\"setupId\":\"%s\"",
            g.reason,attempt,why,S.id));
         return false;
        }
      if(attempt>0&&firstNormal&&C.normalFixedSLGoldMove>0)
         sl=NormalizeDouble(dir>0?g.price-C.normalFixedSLGoldMove:g.price+C.normalFixedSLGoldMove,digits);

      submittedAt=GetTickCount64();
      e=SubmitMarket(dir,vol,sl,com);
      settledAt=GetTickCount64();
      if(e.cls==EXEC_FILLED||e.cls==EXEC_PARTIAL){NoteServerFilledVolume(e.filledVolume>0?e.filledVolume:vol);break;}
      if(!IsSizeOnlyRejection(e.retcode,e.mt5Error)) break;

      // The server has just contradicted the client preflight. Record that as capacity
      // evidence for BOTH profiles before deciding how to retry.
      NoteServerRejectedVolume(vol);

      if(ExecutionProfile()=="NORMAL")
        {
         // OWNER RULE: the requested PERCENTAGE must survive recalculation. Never halve
         // a 15% request until something fills -- that silently turns 15% into ~100% of
         // real capacity. Re-derive the true executable capacity under the server's new
         // evidence, then re-apply the SAME percentage to it.
         Emit("SIZING_MODEL_REJECTED",StringFormat(
            ",\"attempt\":%d,\"rejectedVolume\":%.4f,\"retcode\":%d,\"mt5Error\":%d,\"why\":\"%s\"%s",
            attempt+1,vol,e.retcode,e.mt5Error,why,SizingJson(d,layerIndex)));
         if(attempt>=MathMax(1,InpMaxSizingAttempts)-1) break;
         // vol itself was refused, so genuine capacity is strictly below it.
         double trueCap=LargestVolumePassingCheck(dir,g.price,sl,FloorToStep(vol-d.volStep));
         if(trueCap<=0) trueCap=FloorToStep(vol-d.volStep);
         double reSized=FloorToStep(trueCap*clamp(pct,.1,100)/100.0);
         if(reSized<d.volMin||reSized<=0||reSized>=vol)
           {
            PrintFormat("APEX NORMAL SIZING ABORTED | %.2f%% of re-derived capacity %.4f is not executable",
                        pct,trueCap);
            break;
           }
         PrintFormat("APEX NORMAL CAPACITY RE-DERIVED | rejected=%.4f -> trueCapacity=%.4f -> %.2f%% = %.4f",
                     vol,trueCap,pct,reSized);
         Emit("SIZING_CAPACITY_REDERIVED",StringFormat(
            ",\"attempt\":%d,\"rejectedVolume\":%.4f,\"trueCapacity\":%.4f,\"marginPct\":%.2f,"
            "\"nextVolume\":%.4f,\"why\":\"%s\"",attempt+1,vol,trueCap,pct,reSized,why));
         vol=reSized;
         attempt++;
         continue;
        }
      if(attempt>=MathMax(1,InpMaxSizingAttempts)-1) break;
      double next=FloorToStep(vol*0.5);
      if(next<d.volMin||next<=0) break;
      Emit("SIZING_STEP_DOWN",StringFormat(
         ",\"attempt\":%d,\"rejectedVolume\":%.4f,\"retcode\":%d,\"mt5Error\":%d,\"nextVolume\":%.4f,\"why\":\"%s\"%s",
         attempt+1,vol,e.retcode,e.mt5Error,next,why,SizingJson(d,layerIndex)));
      PrintFormat("APEX SIZING STEP-DOWN | attempt=%d rejected=%.4f retcode=%d -> retry=%.4f",
                  attempt+1,vol,e.retcode,next);
      vol=next;
      attempt++;
     }

   string execExtra=StringFormat(
      ",\"requestedVolume\":%.4f,\"filledVolume\":%.4f,\"retcode\":%d,\"execClass\":\"%s\",\"deal\":%I64u,"
      "\"order\":%I64u,\"positionId\":%I64u,\"fillPrice\":%.5f,\"detail\":\"%s\",\"mt5Error\":%d,"
      "\"sizingAttempts\":%d,\"decisionQuoteBid\":%.5f,\"decisionQuoteAsk\":%.5f,\"extensionAtr\":%.3f,"
      "\"decisionToSubmitMs\":%I64u,\"submitToSettleMs\":%I64u,\"why\":\"%s\"%s",
      e.requestedVolume,e.filledVolume,e.retcode,
      (e.cls==EXEC_FILLED?"FILLED":e.cls==EXEC_PARTIAL?"PARTIAL":e.cls==EXEC_PENDING?"PENDING":
       e.cls==EXEC_REJECTED?"REJECTED":"UNCONFIRMED"),
      e.deal,e.order,e.position,e.fillPrice,e.detail,e.mt5Error,attempt+1,
      g.bid,g.ask,g.extensionAtr,submittedAt-decidedAt,settledAt-submittedAt,why,SizingJson(d,layerIndex));

   // APEX-AUDIT-008: internal state advances ONLY on a broker-confirmed fill. A rejected
   // order leaves layers, masterTicket, lastAdd and the campaign exactly as they were.
   if(e.cls!=EXEC_FILLED&&e.cls!=EXEC_PARTIAL)
     {
      Emit(e.cls==EXEC_REJECTED?"ORDER_REJECTED":"ORDER_UNCONFIRMED",execExtra);
      if(e.retcode==TRADE_RETCODE_MARKET_CLOSED)
         Print("APEX ENTRY PRESERVED | broker market closed; trigger/setup was NOT consumed");
      PrintFormat("APEX ORDER NOT FILLED | class=%s retcode=%d requested=%.4f attempts=%d | layers unchanged at %d",
                  e.cls==EXEC_REJECTED?"REJECTED":"UNCONFIRMED",e.retcode,e.requestedVolume,attempt+1,layers);
      return false;
     }

   layers++;
   lastAdd=(e.fillPrice>0?e.fillPrice:g.price);

   if(firstNormal)
     {
      firstEntryPrice=(e.fillPrice>0?e.fillPrice:g.price);
      ulong mt=(e.position!=0&&IsOurPosition(e.position))?e.position:FindOldestApexPosition();
      masterTicket=mt;
      masterGuardStage=0;
      recoveryExitArmed=false;
      double brokerSL=0;
      if(masterTicket!=0&&PositionSelectByTicket(masterTicket)) brokerSL=PositionGetDouble(POSITION_SL);
      if(sl>0&&MathAbs(brokerSL-sl)>MathMax(SymbolInfoDouble(_Symbol,SYMBOL_POINT),MathPow(10.0,-digits))*2.0)
        {
         SetMasterSL(sl,"INITIAL_FIXED_SL_REAPPLY");
         if(masterTicket!=0&&PositionSelectByTicket(masterTicket)) brokerSL=PositionGetDouble(POSITION_SL);
        }
      firstSLPrice=brokerSL;
      firstInitialSLPrice=brokerSL;
      anchorsKnown=true;
      Emit("FIRST_ENTRY_GUARD",StringFormat(
        ",\"entryPrice\":%.5f,\"requestedSL\":%.5f,\"appliedSL\":%.5f,\"slVerified\":%s,\"goldMove\":%.2f,\"masterTicket\":%I64u",
        firstEntryPrice,sl,brokerSL,BoolJson(sl<=0||MathAbs(brokerSL-sl)<=0.001),C.normalFixedSLGoldMove,masterTicket));
     }
   SaveState();
   Emit("LAYER_OPEN",StringFormat(",\"layer\":%d,\"score\":%.2f,\"price\":%.5f,\"sl\":%.5f,"
        "\"basketVolume\":%.4f,\"setupId\":\"%s\"%s",
        layers,score,lastAdd,sl,BasketVolume(),S.id,execExtra));
   return true;
  }

//====================== closing (APEX-AUDIT-010) ======================
// A failed close can NEVER end a campaign. The campaign enters a persistent CLOSING
// state that keeps its identity, anchors, protections and exit intent, prohibits every
// addition and every new campaign, survives restart, and only finalises when the broker
// confirms zero owned positions.
bool AttemptClosePass()
  {
   if(MarketClosedBackoffActive()) return CountPos()==0;
   trade.SetExpertMagicNumber(InpMagic);
   ENUM_ORDER_TYPE_FILLING filling;
   if(ResolveFillingMode(filling)) trade.SetTypeFilling(filling);
   for(int pass=0;pass<6;pass++)
     {
      bool any=false;
      for(int i=PositionsTotal()-1;i>=0;i--)
        {
         ulong t=PositionGetTicket(i);
         if(t&&PositionGetString(POSITION_SYMBOL)==_Symbol&&PositionGetInteger(POSITION_MAGIC)==InpMagic)
           {
            any=true;
            bool sent=trade.PositionClose(t);
            uint rc=trade.ResultRetcode();
            if(rc==TRADE_RETCODE_MARKET_CLOSED)
              {NoteMarketClosed("POSITION_CLOSE",rc);return false;}
            if(sent) ResetMarketClosedBackoff();
           }
        }
      if(!any)break;
      Sleep(100);
     }
   return CountPos()==0;
  }

void FinalizeClose()
  {
   double comm=0,swp=0;int deals=0;
   double realised=CampaignRealised(comm,swp,deals);
   Emit("CAMPAIGN_END",StringFormat(
     ",\"outcome\":\"%s\",\"reason\":\"%s\",\"mfe\":%.2f,\"mae\":%.2f,\"durationSec\":%d,"
     "\"realisedNet\":%.2f,\"realisedCommission\":%.2f,\"realisedSwap\":%.2f,\"closingDeals\":%d,"
     "\"earnedFloorPct\":%.4f,\"closeAttempts\":%d,\"finalBalance\":%.2f",
     closingOutcome,closingReason,mfe,mae,(int)(TimeCurrent()-campStart),
     realised,comm,swp,deals,earnedFloorPct,closeAttempts,AccountInfoDouble(ACCOUNT_BALANCE)));
   campState=CAMP_IDLE;campDir=0;layers=0;lastAdd=0;peakProfitPct=0;earnedFloorPct=0;ratchetArmed=false;
   firstEntryPrice=0;firstSLPrice=0;firstInitialSLPrice=0;recoveryExitArmed=false;anchorsKnown=true;
   masterTicket=0;masterGuardStage=0;lastEnd=TimeCurrent();campId="";campSig="";
   campInvalidLevel=0;campOriginHigh=0;campOriginLow=0;campOriginClose=0;campOriginBar=0;
   closingOutcome="";closingReason="";closingSince=0;closeAttempts=0;
   ClearTriggers();
   SetupReset("CAMPAIGN_ENDED");
   ClearState();
  }

datetime g_lastCloseWarn=0;
void ServiceClosing()
  {
   // A MARKET_CLOSED holdoff is not a close attempt; keep the persistent CLOSING state
   // without hammering the broker or inflating closeAttempts.
   if(MarketClosedBackoffActive()) return;
   closeAttempts++;
   bool done=AttemptClosePass();
   int remaining=CountPos();
   if(done&&remaining==0){FinalizeClose();return;}
   SaveState();                       // closing intent must survive a restart mid-retry
   if(TimeCurrent()-g_lastCloseWarn>=15)
     {
      g_lastCloseWarn=TimeCurrent();
      int elapsed=(int)(TimeCurrent()-closingSince);
      Emit(elapsed>=InpCloseStallWarnSeconds?"CLOSE_STALLED":"CLOSE_RETRY",
           StringFormat(",\"outcome\":\"%s\",\"reason\":\"%s\",\"remainingPositions\":%d,\"attempts\":%d,"
                        "\"elapsedSec\":%d,\"lastRetcode\":%d",
                        closingOutcome,closingReason,remaining,closeAttempts,elapsed,trade.ResultRetcode()));
     }
  }

// First exit reason wins; a later condition can never overwrite the recorded intent.
void RequestClose(string outcome,string reason)
  {
   if(campState==CAMP_CLOSING){ServiceClosing();return;}
   campState=CAMP_CLOSING;
   closingOutcome=outcome;closingReason=reason;closingSince=TimeCurrent();closeAttempts=0;
   SaveState();
   Emit("CLOSING_REQUESTED",StringFormat(",\"outcome\":\"%s\",\"reason\":\"%s\",\"positions\":%d,\"floating\":%.2f",
        outcome,reason,CountPos(),BasketProfitFloating()));
   ServiceClosing();
  }

//====================== campaign start ================================
string NewCampaignId()
  {
   return StringFormat("%I64d-%I64d-%08x",AccountInfoInteger(ACCOUNT_LOGIN),(long)TimeCurrent(),
      Fnv1a(g_instanceId+IntegerToString((int)GetTickCount())+IntegerToString(MathRand())+_Symbol));
  }

void Start(Snap &s)
  {
   // Provisional identity; the campaign only becomes ACTIVE once a fill is confirmed.
   campDir=s.dir;layers=0;
   cycleStart=AccountInfoDouble(ACCOUNT_BALANCE);
   targetEq=C.targetMode=="EQUITY"
            ?C.targetEquity
            :(C.accountProfile=="NORMAL"
              ?(C.normalTargetProfitPct>0?cycleStart*(1.0+C.normalTargetProfitPct/100.0):0.0)
              :cycleStart*C.targetMultiplier);
   peakProfitPct=0;earnedFloorPct=0;ratchetArmed=false;
   firstEntryPrice=0;firstSLPrice=0;firstInitialSLPrice=0;recoveryExitArmed=false;anchorsKnown=true;
   masterTicket=0;masterGuardStage=0;campStart=TimeCurrent();
   campId=NewCampaignId();campSig=s.sig;mfe=0;mae=0;
   ClearTriggers();
   SnapshotPolicy();

   // APEX-AUDIT-002/008: submit FIRST, then report. v3.7.1 emitted CAMPAIGN_START (a
   // blocking WebRequest) before the order existed, and reported a campaign that the
   // broker might have rejected.
   campInvalidLevel=S.extreme;
   campOriginHigh=S.originHigh;campOriginLow=S.originLow;campOriginClose=S.originClose;
   campOriginBar=S.originBarTime;
   double refPx=(S.originClose>0?S.originClose:S.triggerPrice);
   double locH=(S.execHigh>S.execLow?S.execHigh:S.originHigh);
   double locL=(S.execHigh>S.execLow?S.execLow:S.originLow);
   if(!OpenLayer(campDir,s.score,"PROBE_CONFIRMED",S.extreme,refPx,s.atr,S.triggerBarTime,true,
                 locH,locL))
     {
      campState=CAMP_IDLE;campId="";campSig="";campDir=0;
      campInvalidLevel=0;campOriginHigh=0;campOriginLow=0;campOriginClose=0;campOriginBar=0;
      ClearState();
      return;
     }
   campState=CAMP_ACTIVE;
   S.state=SETUP_CONSUMED;
   SaveState();
   Emit("CAMPAIGN_START",StringFormat(
     ",\"score\":%.2f,\"scoreFloorGivenMandatory\":%.2f,\"scoreCalibration\":\"UNCALIBRATED_RANKING\","
     "\"targetEquity\":%.2f,\"cycleStart\":%.2f,\"entryPrice\":%.5f,\"impulseMult\":%.3f,\"wickRatio\":%.3f,"
     "\"m3Color\":%s,\"m3Fresh\":%s,\"m5Color\":%s,\"atr\":%.5f,\"setupId\":\"%s\",\"bosKind\":\"%s\","
     "\"sweepExtreme\":%.5f,\"triggerPrice\":%.5f,\"triggerBarTime\":%I64d,\"setupAgeSec\":%d",
     s.score,ScoreFloorGivenMandatory(),targetEq,cycleStart,firstEntryPrice,s.impulseMult,s.wickRatio,
     BoolJson(s.m3Color),BoolJson(s.m3Fresh),BoolJson(s.m5Color),s.atr,S.id,S.bosKind,
     S.extreme,S.triggerPrice,(long)S.triggerBarTime,(int)(TimeCurrent()-S.armedAt)));
   SetupReset("CONSUMED_BY_CAMPAIGN");
  }

//====================== add candidates (APEX-AUDIT-004/005) ===========
// Three explicitly separated families, each with its OWN mandatory condition. v3.7.1
// let an INVALID opposite/same-direction reversal watch authorise an add through
// `s.microBreak`, and skipped the continuation families entirely whenever a watch
// happened to point the campaign's way. Both are fixed; no legitimate add is removed --
// the continuation families are now evaluated in cases where they previously could not be.
AddCandidate BuildAddCandidate()
  {
   AddCandidate a;
   a.addEligible=false;a.family="NONE";a.score=0;a.atr=ATR();a.reason="NO_NEW_CONFIRMATION";
   a.triggerId="";a.triggerBarTime=0;a.dir=campDir;a.execHigh=0;a.execLow=0;a.triggerPrice=0;
   if(a.atr<=0){a.reason="NO_ATR";return a;}

   MqlRates m1[];
   if(!Rates(PERIOD_M1,30,m1)){a.reason="NO_M1_HISTORY";return a;}
   datetime bar=m1[1].time;
   a.triggerBarTime=bar;

   // Family 1 -- REVERSAL: only a genuinely CONFIRMED same-direction setup counts.
   Snap rev=Observe();
   if(rev.valid&&rev.dir==campDir&&S.state==SETUP_CONFIRMED&&rev.inLocation)
     {
      a.family="REVERSAL";
      a.score=rev.score;
      a.reason="CONFIRMED_REVERSAL_IN_CAMPAIGN_DIRECTION";
      a.triggerId=StringFormat("REV|%s|%I64d",S.id,(long)S.triggerBarTime);
      a.triggerBarTime=S.triggerBarTime;
      a.execHigh=S.execHigh;a.execLow=S.execLow;a.triggerPrice=S.triggerPrice;
      a.addEligible=true;
      return a;
     }

   // Families 2/3 -- CONTINUATION and FAILED_PULLBACK. Mandatory structure per family,
   // never inferred from a direction match or from an invalid reversal candidate.
   bool cont = campDir<0 ? (m1[1].close<m1[2].low  && m1[2].close<m1[3].low)
                         : (m1[1].close>m1[2].high && m1[2].close>m1[3].high);
   bool pf   = campDir<0 ? (m1[2].close>m1[2].open && m1[1].close<m1[2].low)
                         : (m1[2].close<m1[2].open && m1[1].close>m1[2].high);
   if(!cont&&!pf) return a;

   // Optional, owner-enabled M3 colour filter for continuation adds (default off = v3.7.1).
   if(InpAddRequireM3)
     {
      MqlRates m3[];
      if(!Rates(PERIOD_M3,8,m3)){a.reason="M3_HISTORY_UNAVAILABLE_BUT_REQUIRED";return a;}
      bool m3ok=campDir<0?(m3[1].close<m3[1].open):(m3[1].close>m3[1].open);
      if(!m3ok){a.reason="ADD_M3_FILTER_REJECTED";return a;}
     }

   a.family=cont?"CONTINUATION":"FAILED_PULLBACK";
   a.score=60+(cont?20:0)+(pf?15:0);        // unchanged from v3.7.1
   a.reason=cont?"CONTINUATION_BREAK":"FAILED_PULLBACK";
   a.triggerId=StringFormat("%s|%s|%I64d",a.family,campId,(long)bar);
   // Continuation / failed-pullback fire AT the break, not on a retest of
   // the first campaign candle. The trigger bar itself is this add's location.
   a.execHigh=MathMax(m1[1].high,m1[1].low);
   a.execLow=MathMin(m1[1].high,m1[1].low);
   if(a.execHigh<=a.execLow){a.execHigh+=_Point;a.execLow-=_Point;}
   a.triggerPrice=m1[1].close;
   a.addEligible=true;
   return a;
  }

//====================== basket management =============================
void Manage()
  {
   ulong nowMs=GetTickCount64();
   if(g_lastManageTickMs>0)
     {
      ulong gap=nowMs-g_lastManageTickMs;
      if(gap>g_maxRiskLoopGapMs) g_maxRiskLoopGapMs=gap;
     }
   g_lastManageTickMs=nowMs;

   int n=CountPos();

   // CLOSING outranks everything. No adds, no new campaigns, no premature end.
   if(campState==CAMP_CLOSING)
     {
      if(n==0){FinalizeClose();return;}
      ServiceClosing();
      return;
     }
   if(campState==CAMP_IDLE) return;

   if(ExecutionProfile()=="NORMAL"&&masterTicket>0&&!MasterPositionExists())
     {
      if(n>0){RequestClose("MASTER_LEG_CLOSED","MASTER_FIRST_TRADE_GONE_CLOSE_WHOLE_BASKET");return;}
      closingOutcome="MASTER_LEG_CLOSED";closingReason="MASTER_FIRST_TRADE_GONE_CLOSE_WHOLE_BASKET";
      closingSince=TimeCurrent();campState=CAMP_CLOSING;FinalizeClose();
      return;
     }
   if(n==0)
     {
      closingOutcome="POSITIONS_GONE";closingReason="BROKER_CLOSE_OR_MARGIN_STOP_OUT";
      closingSince=TimeCurrent();campState=CAMP_CLOSING;FinalizeClose();
      return;
     }

   double p=BasketProfitFloating(),campEq=cycleStart+p;
   mfe=MathMax(mfe,p);mae=MathMin(mae,p);
   double profitPct=cycleStart>0?(p/cycleStart)*100.0:0;
   peakProfitPct=MathMax(peakProfitPct,profitPct);

   // --- RECOVERY-TO-ENTRY EXIT (unchanged rule; now uses the PERSISTED original stop
   // --- and the campaign policy snapshot).
   if(ExecutionProfile()=="NORMAL"&&P.recoveryExitEnabled&&masterTicket>0&&
      firstEntryPrice>0&&firstInitialSLPrice>0)
     {
      double originalSLDist=MathAbs(firstEntryPrice-firstInitialSLPrice);
      if(originalSLDist>0)
        {
         double masterPx=campDir>0?SymbolInfoDouble(_Symbol,SYMBOL_BID):SymbolInfoDouble(_Symbol,SYMBOL_ASK);
         double adverseDist=campDir>0?MathMax(0.0,firstEntryPrice-masterPx):MathMax(0.0,masterPx-firstEntryPrice);
         double adversePctOfSL=(adverseDist/originalSLDist)*100.0;
         if(!recoveryExitArmed&&adversePctOfSL>=MathMax(0.0,P.recoveryExitArmPctOfSL))
           {
            recoveryExitArmed=true;SaveState();
            Emit("RECOVERY_EXIT_ARMED",StringFormat(",\"adversePctOfSL\":%.2f,\"armPctOfSL\":%.2f,\"entryPrice\":%.5f,\"initialSLPrice\":%.5f",
                 adversePctOfSL,P.recoveryExitArmPctOfSL,firstEntryPrice,firstInitialSLPrice));
           }
         bool recoveredToEntry=recoveryExitArmed&&(campDir>0?masterPx>=firstEntryPrice:masterPx<=firstEntryPrice);
         if(recoveredToEntry)
           {
            Emit("RECOVERY_TO_ENTRY_EXIT",StringFormat(",\"entryPrice\":%.5f,\"recoveryPrice\":%.5f,\"armPctOfSL\":%.2f",
                 firstEntryPrice,masterPx,P.recoveryExitArmPctOfSL));
            RequestClose("RECOVERY_TO_ENTRY_EXIT","DEEP_ADVERSE_MOVE_RECOVERED_TO_MASTER_ENTRY");
            return;
           }
        }
     }

   // --- MASTER BREAK-EVEN (unchanged rule; the SL only counts once the broker confirms it).
   if(ExecutionProfile()=="NORMAL"&&P.masterBreakEvenEnabled&&masterTicket>0&&
      firstEntryPrice>0&&cycleStart>0)
     {
      double campaignProfitPct=(p/cycleStart)*100.0;
      bool beAlreadyActive=(campDir>0?firstSLPrice>=firstEntryPrice:firstSLPrice<=firstEntryPrice)&&firstSLPrice>0;
      if(campaignProfitPct>=P.masterBreakEvenTriggerPct&&!beAlreadyActive)
        {
         if(SetMasterSL(firstEntryPrice,"CAMPAIGN_PROFIT_REACHED_BE_TRIGGER"))
            Emit("MASTER_BE_ARMED",StringFormat(",\"campaignProfitPct\":%.2f,\"triggerPct\":%.2f,\"entryPrice\":%.5f,\"masterTicket\":%I64u",
                 campaignProfitPct,P.masterBreakEvenTriggerPct,firstEntryPrice,masterTicket));
        }
     }

   // --- MASTER FIXED SL GUARD (unchanged rule).
   if(ExecutionProfile()=="NORMAL"&&masterTicket>0&&firstEntryPrice>0&&firstSLPrice>0)
     {
      double guardPx=campDir>0?SymbolInfoDouble(_Symbol,SYMBOL_BID):SymbolInfoDouble(_Symbol,SYMBOL_ASK);
      if(campDir>0?guardPx<=firstSLPrice:guardPx>=firstSLPrice)
        {RequestClose("MASTER_SL_BASKET_EXIT","MASTER_FIXED_SL_HIT");return;}
     }

   // --- PROFIT RATCHET. APEX-AUDIT-013: the earned floor is MONOTONIC and persisted.
   // A settings change (or a restart) can raise it, never lower it.
   if(ExecutionProfile()=="NORMAL"&&P.profitRatchetEnabled&&cycleStart>0&&
      P.ratchetTriggerPct>0&&P.ratchetLockPct>=0&&P.ratchetStepPct>0&&P.ratchetLockStepPct>=0)
     {
      double peakPct=(mfe/cycleStart)*100.0;
      if(peakPct>=P.ratchetTriggerPct)
        {
         int steps=(int)MathFloor((peakPct-P.ratchetTriggerPct)/P.ratchetStepPct);
         double newlyEarned=MathMax(0.0,P.ratchetLockPct+(double)steps*P.ratchetLockStepPct);
         if(!ratchetArmed||newlyEarned>earnedFloorPct)
           {
            double prev=earnedFloorPct;
            earnedFloorPct=MathMax(earnedFloorPct,newlyEarned);
            ratchetArmed=true;
            SaveState();
            Emit("PROFIT_FLOOR_EARNED",StringFormat(",\"peakPct\":%.2f,\"previousFloorPct\":%.2f,\"earnedFloorPct\":%.2f,\"steps\":%d",
                 peakPct,prev,earnedFloorPct,steps));
           }
        }
      if(ratchetArmed&&earnedFloorPct>0)
        {
         double protectedProfit=cycleStart*(earnedFloorPct/100.0);
         if(p<=protectedProfit)
           {
            Emit("PROFIT_RATCHET_EXIT",StringFormat(",\"peakProfit\":%.2f,\"protectedProfit\":%.2f,\"earnedFloorPct\":%.2f,\"currentProfit\":%.2f",
                 mfe,protectedProfit,earnedFloorPct,p));
            RequestClose("PROFIT_FLOOR_HIT","EARNED_PERCENT_PROFIT_RATCHET");
            return;
           }
        }
     }

   // --- HARD BASKET TARGET (unchanged rule; campaign-scoped equity).
   if(targetEq>0&&campEq>=targetEq)
     {RequestClose("TARGET_HIT","NORMAL_BASKET_TARGET");return;}

   SaveState();

   // --- ADDITIONS -------------------------------------------------------------
   if(!C.armed) return;
   if(C.maxLayers>0&&layers>=C.maxLayers) return;
   if(p<=0) return;                             // never add into a losing basket
   g_preflightBlock=ComputePreflight();
   if(g_preflightBlock!="") return;

   AddCandidate a=BuildAddCandidate();
   if(!a.addEligible) return;

   double threshold=C.addScore+(C.learningEnabled?C.learnAddAdj:0);
   if(a.score<threshold) return;

   double cur=campDir>0?SymbolInfoDouble(_Symbol,SYMBOL_BID):SymbolInfoDouble(_Symbol,SYMBOL_ASK);
   bool spaced=lastAdd>0&&(campDir>0?cur>=lastAdd+a.atr*C.addSpacingAtr:cur<=lastAdd-a.atr*C.addSpacingAtr);
   if(!spaced) return;

   // APEX-AUDIT-004: one add per distinct confirmed trigger. Raising InpMaxAddsPerTrigger
   // is the only way to get deliberate batching; the timer firing again never is.
   int used=TriggerUseCount(a.triggerId);
   if(used>=MathMax(1,InpMaxAddsPerTrigger))
     {
      Emit("ADD_BLOCKED",StringFormat(",\"reason\":\"TRIGGER_ALREADY_CONSUMED\",\"triggerId\":\"%s\",\"uses\":%d,\"family\":\"%s\"",
           a.triggerId,used,a.family));
      return;
     }

   bool enforceReclaim=true;
   double invalidLevel=(campInvalidLevel>0?campInvalidLevel:S.extreme);
   double refPrice=(a.triggerPrice>0?a.triggerPrice:(campOriginClose>0?campOriginClose:S.triggerPrice));
   datetime trigBar=a.triggerBarTime;
   // THIS add's own location. Campaign origin is thesis invalidation (reclaim),
   // not the required entry box.
   double addOH=a.execHigh;
   double addOL=a.execLow;

   if(OpenLayer(campDir,a.score,a.reason,invalidLevel,refPrice,a.atr,trigBar,enforceReclaim,addOH,addOL))
     {
      ConsumeTrigger(a.triggerId);
      SaveState();
      Emit("ADD_TRIGGER_CONSUMED",StringFormat(",\"triggerId\":\"%s\",\"family\":\"%s\",\"score\":%.2f",
           a.triggerId,a.family,a.score));
      if(a.family=="REVERSAL"){S.state=SETUP_CONSUMED;SetupReset("CONSUMED_BY_ADD");}
     }
  }

//====================== restart reconciliation (APEX-AUDIT-011) =======
// Restored state is never trusted on its own: every anchor is checked against the
// broker's actual positions, and anything that cannot be reconciled is marked UNKNOWN,
// which blocks further exposure while protection and closing continue normally.
void ReconcileAgainstBroker()
  {
   int n=CountPos();

   if(campState==CAMP_CLOSING)
     {
      if(n==0){FinalizeClose();return;}
      Emit("CAMPAIGN_RECOVERED",StringFormat(",\"source\":\"STATE_FILE\",\"campaignState\":\"CLOSING\",\"outcome\":\"%s\",\"reason\":\"%s\",\"positions\":%d",
           closingOutcome,closingReason,n));
      return;                                  // stays CLOSING until zero positions
     }

   if(n==0)
     {
      if(campState==CAMP_ACTIVE)
        {
         closingOutcome="POSITIONS_GONE";closingReason="NO_POSITIONS_AT_RESTART";
         closingSince=TimeCurrent();campState=CAMP_CLOSING;
         FinalizeClose();
        }
      else ClearState();
      return;
     }

   int nDir,nCount;double nPrice;
   NewestMagicPosition(nDir,nPrice,nCount);

   if(campState==CAMP_ACTIVE&&campId!="")
     {
      if(campDir!=0&&campDir!=nDir)
        {  // state and broker disagree on direction: trust the broker, mark anchors unknown
         campDir=nDir;anchorsKnown=false;
        }
      layers=(int)MathMax(nCount,layers);
      if(masterTicket!=0&&!IsOurPosition(masterTicket)) masterTicket=0;
      if(masterTicket==0) masterTicket=FindOldestApexPosition();
      // Rebuild the entry/stop anchors from the real master position where possible.
      if(masterTicket!=0&&PositionSelectByTicket(masterTicket))
        {
         double openPx=PositionGetDouble(POSITION_PRICE_OPEN);
         double brokerSL=PositionGetDouble(POSITION_SL);
         if(firstEntryPrice<=0) firstEntryPrice=openPx;
         firstSLPrice=brokerSL;                       // the broker is authoritative
         if(firstInitialSLPrice<=0&&brokerSL>0) firstInitialSLPrice=brokerSL;
        }
      if(cycleStart<=0){cycleStart=AccountInfoDouble(ACCOUNT_BALANCE);anchorsKnown=false;}
      if(lastAdd<=0) lastAdd=nPrice;
      Emit("CAMPAIGN_RECOVERED",StringFormat(
        ",\"source\":\"STATE_FILE\",\"layers\":%d,\"positions\":%d,\"anchorsKnown\":%s,"
        "\"firstEntryPrice\":%.5f,\"firstSLPrice\":%.5f,\"firstInitialSLPrice\":%.5f,"
        "\"earnedFloorPct\":%.4f,\"recoveryExitArmed\":%s,\"masterTicket\":%I64u",
        layers,nCount,BoolJson(anchorsKnown),firstEntryPrice,firstSLPrice,firstInitialSLPrice,
        earnedFloorPct,BoolJson(recoveryExitArmed),masterTicket));
      SaveState();
      return;
     }

   // Positions exist but there is no usable state file: adopt them under PROTECTIVE
   // management only. Unknown historical anchors are explicit and block new exposure.
   campState=CAMP_ACTIVE;
   campDir=nDir;layers=nCount;
   cycleStart=AccountInfoDouble(ACCOUNT_BALANCE);
   targetEq=C.targetMode=="EQUITY"
            ?C.targetEquity
            :(C.accountProfile=="NORMAL"
              ?(C.normalTargetProfitPct>0?cycleStart*(1.0+C.normalTargetProfitPct/100.0):0.0)
              :cycleStart*C.targetMultiplier);
   peakProfitPct=0;earnedFloorPct=0;ratchetArmed=false;
   masterTicket=FindOldestApexPosition();masterGuardStage=0;
   firstEntryPrice=0;firstSLPrice=0;firstInitialSLPrice=0;recoveryExitArmed=false;
   if(masterTicket!=0&&PositionSelectByTicket(masterTicket))
     {
      firstEntryPrice=PositionGetDouble(POSITION_PRICE_OPEN);
      firstSLPrice=PositionGetDouble(POSITION_SL);
      firstInitialSLPrice=firstSLPrice;        // may be 0 -> recovery exit stays inactive
     }
   anchorsKnown=false;                          // cycleStart / original SL are NOT the real ones
   campStart=TimeCurrent();campId=NewCampaignId();campSig="RECOVERED_NO_STATE";
   lastAdd=nPrice;mfe=0;mae=0;
   ClearTriggers();SnapshotPolicy();SaveState();
   Emit("CAMPAIGN_RECOVERED",StringFormat(
     ",\"source\":\"POSITION_SCAN_ONLY\",\"layers\":%d,\"anchorsKnown\":false,"
     "\"warning\":\"CYCLE_START_AND_ORIGINAL_SL_UNKNOWN_NEW_EXPOSURE_BLOCKED\","
     "\"firstEntryPrice\":%.5f,\"firstSLPrice\":%.5f,\"masterTicket\":%I64u",
     layers,firstEntryPrice,firstSLPrice,masterTicket));
  }

//====================== lifecycle =====================================
int OnInit()
  {
   MathSrand((int)GetTickCount());
   g_instanceId=StringFormat("%I64d.%d.%08x",AccountInfoInteger(ACCOUNT_LOGIN),
                             (int)ChartID(),Fnv1a(_Symbol+IntegerToString(MathRand())+IntegerToString((int)GetTickCount())));
   Defaults();
   SnapshotPolicy();
   SetupReset("INIT");
   ArrayResize(g_eventQ,APEX_EVENTQ_MAX);

   if(IsTester()) C.armed=true;
   else
     {
      // no cache yet -> Defaults() stand until the first successful poll
      LoadCloudCache();
     }
   C.configHash=ConfigHash(C);

   if(StringFind(_Symbol,"XAU")<0)
     {Print("APEX INIT FAILED | symbol ",_Symbol," is not a XAU instrument");return INIT_FAILED;}
   hAtr=iATR(_Symbol,PERIOD_M1,14);
   if(hAtr==INVALID_HANDLE){Print("APEX INIT FAILED | ATR handle");return INIT_FAILED;}

   if(!IsTester())
     {
      g_observerOnly=!AcquireOrRefreshLease();
      if(g_observerOnly)
         Print("APEX OBSERVER MODE | another Apex instance already manages account+symbol+magic ",OwnerKey(),
               " | this instance will NOT submit or close orders");
     }

   int sr=LoadState();
   if(sr<0)
     {
      Print("APEX STATE FILE CORRUPT OR FOREIGN | file=",StateFile()," | falling back to broker position scan");
      campState=CAMP_IDLE;campId="";
     }
   // Restore the durable telemetry outbox BEFORE broker reconciliation can emit any
   // recovery/closure event; otherwise a restart could overwrite older pending events.
   if(!IsTester()) LoadEventQueue();
   if(!IsTester()&&!g_observerOnly) ReconcileAgainstBroker();

   g_preflightBlock=ComputePreflight();
   EventSetMillisecondTimer(MathMax(100,InpScanMilliseconds));
   if(!IsTester()) CloudSync();

   Print("APEX_READY ",APEX_VERSION,
      " | build=",APEX_BUILD_ID,
      " | mode=",IsTester()?"TESTER":(AccountInfoInteger(ACCOUNT_TRADE_MODE)==ACCOUNT_TRADE_MODE_DEMO?"DEMO":"LIVE"),
      " | cloud=",InpCloudURL,
      " | cached=",g_cloudUsingCache?"true":"false",
      " | armed=",C.armed?"true":"false",
      " | rev=",g_cloudLastCommandRevision,
      " | configHash=",C.configHash,
      " | campaignState=",(campState==CAMP_CLOSING?"CLOSING":campState==CAMP_ACTIVE?"ACTIVE":"IDLE"),
      " | observerOnly=",g_observerOnly?"true":"false",
      " | profile=",ExecutionProfile(),
      " | accountTradeAllowed=",(bool)AccountInfoInteger(ACCOUNT_TRADE_ALLOWED)?"true":"false",
      " | accountExpertAllowed=",(bool)AccountInfoInteger(ACCOUNT_TRADE_EXPERT)?"true":"false",
      " | preflight=",(g_preflightBlock==""?"OK":g_preflightBlock),
      " | entry=origin-retest");
   return INIT_SUCCEEDED;
  }

void OnDeinit(const int r)
  {
   EventKillTimer();
   if(hAtr!=INVALID_HANDLE) IndicatorRelease(hAtr);
   if(!IsTester())
     {
      if(!g_observerOnly) SaveState();
      PersistEventQueue();
      ReleaseLease();
     }
  }

void OnTick(){}

// APEX-AUDIT-002: risk first, telemetry second, cloud last. No network call sits between
// the entry decision and the order, and the executable-price gate re-runs immediately
// before submission regardless of what blocked beforehand.
void OnTimer()
  {
   datetime now=TimeCurrent();

   if(!IsTester())
     {
      bool held=AcquireOrRefreshLease();
      if(!held&&!g_observerOnly)
        {g_observerOnly=true;Print("APEX LOST INSTANCE LEASE | switching to observer-only");}
      else if(held&&g_observerOnly)
        {
         g_observerOnly=false;
         Print("APEX ACQUIRED INSTANCE LEASE | reloading broker/state before resuming management");
         int rr=LoadState();
         if(rr<=0){campState=CAMP_IDLE;campId="";}
         ReconcileAgainstBroker();
        }
     }

   // 1. PROTECTION / CLOSING first, always.
   if(!g_observerOnly)
     {
      if(campState==CAMP_IDLE&&CountPos()>0) ReconcileAgainstBroker();
      Manage();
     }

   // 2. Telemetry: at most one queued request per tick, never in a decision path.
   FlushEventQueue();

   // 3. Cloud config/licence sync, after risk has already been serviced this tick.
   if(now-lastCfg>=InpConfigPollSeconds){CloudSync();lastCfg=now;}

   if(g_observerOnly) return;
   if(campState!=CAMP_IDLE) return;                // adds are handled inside Manage()
   if(!C.armed) return;
   if(lastEnd>0&&now-lastEnd<C.cooldownMinutes*60) return;
   g_preflightBlock=ComputePreflight();
   if(g_preflightBlock!="") return;

   Snap s=Observe();
   if(s.valid&&s.inLocation) Start(s);
  }
