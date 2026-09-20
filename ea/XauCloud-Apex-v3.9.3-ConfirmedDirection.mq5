//+------------------------------------------------------------------+
//|  XauCloud Apex v3.9.3 "ConfirmedDirection"                              |
//|                                                                   |
//|  EXECUTION BASE = v3.8.8. Basket handling, sizing, cloud link,     |
//|  recovery, ratchet, SL/BE, broker preflight and restart hardening  |
//|  are preserved. v3.9.x replaces ONLY the opportunity engine with  |
//|  BREAKOUT + TREND CONTINUATION with closed-bar confirmation entry. |
//|                                                                   |
//|  Existing v3.8.8 sizing remains unchanged:                         |
//|    L1  = 15% of SIMULATED 1:200 capacity                          |
//|    L2  = 50% of SIMULATED 1:200 capacity (re-derived fresh)       |
//|    L3  = 100% of actual UNLIMITED executable capacity             |
//|    L4+ = 100% of actual UNLIMITED executable capacity (profit-fed)|
//|  NORMAL sizing is byte-for-byte the v3.8.2 engine and ladder.     |
//+------------------------------------------------------------------+
#property copyright "XauCloud Apex"
#property version   "3.930"
#property strict
#property description "XauCloud Apex v3.9.3 ConfirmedDirection"

#include <Trade/Trade.mqh>
CTrade trade;

#define APEX_VERSION       "XauCloud-Apex_v3.9.3-ConfirmedDirection"
#define APEX_BUILD_ID      "3.9.3"
#define APEX_MAGIC         8620260903
#define APEX_STATE_SCHEMA  4
#define APEX_CONFIG_SCHEMA 2
#define APEX_SCORE_BASE    25.0    // constant, non-discriminating ranking offset -- see APEX-AUDIT-006
#define APEX_MAX_TRIGGERS  32
#define APEX_EVENTQ_MAX    2048

// v3.8.8 UNLIMITED layer state machine (owner rule, see PlanLayerSizing):
//   L1  -> SIMULATED 1:200 capacity x 15%
//   L2  -> SIMULATED 1:200 capacity x 50%   (re-derived fresh, never the L1 figure)
//   L3  -> UNLIMITED executable capacity x 100%
//   L4+ -> UNLIMITED executable capacity x 100%   (profit-fed, until the campaign ends)
#define APEX_SIM_LEVERAGE        200
#define APEX_UNL_L1_SIM200_PCT   15.0
#define APEX_UNL_L2_SIM200_PCT   50.0
#define APEX_UNL_L3PLUS_PCT      100.0

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
input int    InpCloudTickBudgetMs=1200;                // max WebRequest time this timer tick; Manage() always runs first
input bool   InpCloudDiagnostics=true;
input int    InpScanMilliseconds=250;
input bool   InpRequireRemoteArm=true;
input long   InpMagic=APEX_MAGIC;

// --- v3.9 Breakout + Trend signal brain. These are analysis thresholds, not win-rate claims.
// --- Pressure is a broker-feed proxy from ticks/candles; XAUUSD has no single centralized order book.
input int    InpBreakoutLookbackBars=20;
input int    InpBreakoutMinTouches=2;
input double InpBreakoutBufferAtr=0.04;
input double InpBreakoutArmDistanceAtr=0.45;
input double InpBreakoutMaxExtensionAtr=0.50;
input double InpBreakoutPressureMin=62.0;
input double InpTrendPressureMin=58.0;
input double InpTrendSlopeMinAtr=0.75;
input int    InpTrendPullbackBars=5;
input double InpTrendMaxPullbackAtr=1.60;
input double InpIgnitionBodyAtr=0.18;
input double InpIgnitionCloseLocation=0.68;

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
input bool   InpRequireFreshTrigger=true;     // The confirming bar must still be the latest closed M1 bar at submission

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
   int      breakoutLookbackBars,breakoutMinTouches,trendPullbackBars;
   double   breakoutBufferAtr,breakoutArmDistanceAtr,breakoutMaxExtensionAtr;
   double   breakoutPressureMin,trendPressureMin,trendSlopeMinAtr,trendMaxPullbackAtr;
   double   ignitionBodyAtr,ignitionCloseLocation;
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
enum CampState { CAMP_IDLE=0, CAMP_ACTIVE=1, CAMP_CLOSING=2, CAMP_SUBMITTING=3 };
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
   string setupFamily,regime,triggerKind;
   double buyPressure,sellPressure,activePressure,trendStrength,candleQuality;
   double breakoutLevel,compressionScore,pullbackQuality;
   bool contextOk,ignition,liveTrigger;
   int directionBias,directionTier,m5Structure,m15Structure,m5Bos,m15Bos;
   int structuralBias,freshDirection,freshDirectionTier,m5Flow,m15Flow,m30Flow;
   double directionScoreGap,pressureGap,m5FlowStrength,m15FlowStrength,m30FlowStrength;
   string directionReason,freshDirectionReason;
  };

struct AddCandidate
  {
   bool     addEligible;
   string   family;
   double   score,atr;
   string   reason,triggerId;
   datetime triggerBarTime;
   int      dir;
  };

struct DirectionAuthority
  {
   int dir;               // FINAL tactical permission: -1 SELL, +1 BUY, 0 WAIT
   int tier;              // 3 STRONG, 2 CONFIRMED, 1 WEAK, 0 NONE
   int structuralDir,structuralTier;
   int freshDir,freshTier,m5Flow,m15Flow,m30Flow;
   int m5Seq,m15Seq,m5Bos,m15Bos;
   bool transition;
   double bullScore,bearScore,scoreGap,pressureGap;
   double m5FlowStrength,m15FlowStrength,m30FlowStrength;
   double m5SwingHigh,m5SwingLow,m15SwingHigh,m15SwingLow;
   string reason,freshReason;
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

// Cross-terminal manager lease (XauCloud config envelope). GlobalVariable remains
// the same-terminal duplicate-chart fence. Cloud lease is the account fence.
bool     g_cloudLeaseSupported=false;
bool     g_cloudLeaseConfirmed=false;
string   g_cloudManagerId="";
datetime g_cloudLeaseUntil=0;
long     g_cloudLeaseGeneration=0;

// Broker submission fence: PLACED != rejected. A late fill must attach here.
struct PendingSubmit
  {
   bool     active;
   bool     isFirstEntry;
   ulong    order;
   int      dir;
   double   requestedVolume,sl,score,invalidLevel,refPrice,atr;
   string   why,setupId,family,triggerId;
   datetime submittedAt,triggerBar;
   bool     enforceReclaim;
  };
PendingSubmit g_pending;
bool BodyLooksLikeJsonObject(const string resp);
bool IsXauCloudDenialEnvelope(bool parsedOk,const string licenseStatus,const string error,const string reason,bool hasOk,bool okValue);
int  ClassifyBrokerSubmit(uint rc,bool hasFill);
bool ManagerAllowsNewExposure(const string myId,const string cloudManagerId,datetime leaseUntil,datetime now,bool cloudLeaseSupported,bool weWereConfirmedManager);
bool SetupSnapshotValidToRestore(int state,int dir,datetime confirmedAt,datetime armedAt,datetime now,int watchExpiryMinutes,double extreme,bool marketReclaimed);
void ReconcilePending();
void ClearPending(string reason);
void PromotePendingFill();
void ApplyCloudManagerLease(const string mid,datetime until,long generation);
string CampStateName();

// --- risk-loop instrumentation (APEX-AUDIT-002) ---
ulong    g_lastManageTickMs=0;
ulong    g_maxRiskLoopGapMs=0;
ulong    g_lastNetworkMs=0;

double   g_lastTickMid=0;
long     g_tickUp=0,g_tickDown=0;
datetime g_tickWindowStart=0;

// --- v3.8.1 LIVE-READY operational state -----------------------------
// A broker/session MARKET_CLOSED response is not a strategy rejection. Keep the
// setup/campaign intact, stop hammering the trade server every 250ms, then retry.
datetime g_marketClosedRetryAt=0;
int      g_marketClosedBackoffSec=0;

bool IsTester(){return (bool)MQLInfoInteger(MQL_TESTER);}
double clamp(double x,double a,double b){return MathMax(a,MathMin(b,x));}
string BoolJson(bool v){return v?"true":"false";}
string NormalizeLicense(string s){s=trim(s);StringToUpper(s);StringReplace(s," ","");return s;}
string CampStateName()
  {
   if(campState==CAMP_CLOSING) return "CLOSING";
   if(campState==CAMP_SUBMITTING) return "SUBMITTING";
   if(campState==CAMP_ACTIVE) return "ACTIVE";
   return "IDLE";
  }

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
     layers,CampStateName(),CountPos(),BasketVolume(),
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
   C.breakoutLookbackBars=InpBreakoutLookbackBars;C.breakoutMinTouches=InpBreakoutMinTouches;
   C.breakoutBufferAtr=InpBreakoutBufferAtr;C.breakoutArmDistanceAtr=InpBreakoutArmDistanceAtr;
   C.breakoutMaxExtensionAtr=InpBreakoutMaxExtensionAtr;C.breakoutPressureMin=InpBreakoutPressureMin;
   C.trendPressureMin=InpTrendPressureMin;C.trendSlopeMinAtr=InpTrendSlopeMinAtr;
   C.trendPullbackBars=InpTrendPullbackBars;C.trendMaxPullbackAtr=InpTrendMaxPullbackAtr;
   C.ignitionBodyAtr=InpIgnitionBodyAtr;C.ignitionCloseLocation=InpIgnitionCloseLocation;
   C.requireM5Context=false;C.learningEnabled=true;C.learnEntryAdj=0;C.learnAddAdj=0;
   C.revision=0;C.configHash="";
  }

string ConfigCanonical(const Config &x)
  {
   string legacy=StringFormat(
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
   return legacy+StringFormat("|%d|%d|%.6f|%.6f|%.6f|%.6f|%.6f|%.6f|%d|%.6f|%.6f|%.6f",
      x.breakoutLookbackBars,x.breakoutMinTouches,x.breakoutBufferAtr,x.breakoutArmDistanceAtr,
      x.breakoutMaxExtensionAtr,x.breakoutPressureMin,x.trendPressureMin,x.trendSlopeMinAtr,
      x.trendPullbackBars,x.trendMaxPullbackAtr,x.ignitionBodyAtr,x.ignitionCloseLocation);
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
     "\"breakoutLookbackBars\":%d,\"breakoutMinTouches\":%d,\"breakoutBufferAtr\":%.6f,"
     "\"breakoutArmDistanceAtr\":%.6f,\"breakoutMaxExtensionAtr\":%.6f,\"breakoutPressureMin\":%.6f,"
     "\"trendPressureMin\":%.6f,\"trendSlopeMinAtr\":%.6f,\"trendPullbackBars\":%d,"
     "\"trendMaxPullbackAtr\":%.6f,\"ignitionBodyAtr\":%.6f,\"ignitionCloseLocation\":%.6f,"
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
     x.breakoutLookbackBars,x.breakoutMinTouches,x.breakoutBufferAtr,x.breakoutArmDistanceAtr,
     x.breakoutMaxExtensionAtr,x.breakoutPressureMin,x.trendPressureMin,x.trendSlopeMinAtr,
     x.trendPullbackBars,x.trendMaxPullbackAtr,x.ignitionBodyAtr,x.ignitionCloseLocation,
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
   out.breakoutLookbackBars=(int)CfgNum("breakoutLookbackBars",(double)out.breakoutLookbackBars);
   out.breakoutMinTouches=(int)CfgNum("breakoutMinTouches",(double)out.breakoutMinTouches);
   out.breakoutBufferAtr=CfgNum("breakoutBufferAtr",out.breakoutBufferAtr);
   out.breakoutArmDistanceAtr=CfgNum("breakoutArmDistanceAtr",out.breakoutArmDistanceAtr);
   out.breakoutMaxExtensionAtr=CfgNum("breakoutMaxExtensionAtr",out.breakoutMaxExtensionAtr);
   out.breakoutPressureMin=CfgNum("breakoutPressureMin",out.breakoutPressureMin);
   out.trendPressureMin=CfgNum("trendPressureMin",out.trendPressureMin);
   out.trendSlopeMinAtr=CfgNum("trendSlopeMinAtr",out.trendSlopeMinAtr);
   out.trendPullbackBars=(int)CfgNum("trendPullbackBars",(double)out.trendPullbackBars);
   out.trendMaxPullbackAtr=CfgNum("trendMaxPullbackAtr",out.trendMaxPullbackAtr);
   out.ignitionBodyAtr=CfgNum("ignitionBodyAtr",out.ignitionBodyAtr);
   out.ignitionCloseLocation=CfgNum("ignitionCloseLocation",out.ignitionCloseLocation);
   out.breakoutLookbackBars=MathMax(8,MathMin(60,out.breakoutLookbackBars));
   out.breakoutMinTouches=MathMax(1,MathMin(6,out.breakoutMinTouches));
   out.trendPullbackBars=MathMax(2,MathMin(12,out.trendPullbackBars));
   out.breakoutPressureMin=clamp(out.breakoutPressureMin,50,95);
   out.trendPressureMin=clamp(out.trendPressureMin,50,95);
   out.ignitionCloseLocation=clamp(out.ignitionCloseLocation,.50,.98);
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
   if(!BodyLooksLikeJsonObject(resp))
     {
      Print("APEX CLOUD EDGE DENIAL | http=",code," | body is not a XauCloud JSON envelope | last-good config retained | TRANSPORT_OR_WAF");
      return false;
     }
   if(!JsonParseObject(resp))
     {
      Print("APEX CLOUD EDGE DENIAL | http=",code," | JSON object did not parse | last-good config retained");
      return false;
     }
   string ls="",err="",rsn="";
   bool okVal=true; bool hasOk=JBoolStrict("ok",okVal);
   JStrStrict("licenseStatus",ls);
   JStrStrict("error",err);
   JStrStrict("reason",rsn);
   if(!IsXauCloudDenialEnvelope(true,ls,err,rsn,hasOk,okVal))
     {
      Print("APEX CLOUD PROTOCOL/EDGE 401/403 | not an authenticated license envelope | last-good config retained | body=",StringSubstr(resp,0,180));
      return false;
     }
   if(ls!="" && ls!="ACTIVE") reason=ls;
   else if(err!="") reason=err;
   else if(rsn!="") reason=rsn;
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
   ulong cloudTickStart=GetTickCount64();
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
      "\"instance_id\":\"%s\",\"lease_generation\":%I64d,\"lease_until\":%I64d,\"want_manager\":true,"
      "\"magic\":%I64d,\"ea_active\":true,\"bot_state\":\"APEX\"}",
      license,AccountInfoInteger(ACCOUNT_LOGIN),AccountInfoString(ACCOUNT_SERVER),_Symbol,(int)_Period,
      APEX_VERSION,APEX_BUILD_ID,AccountInfoDouble(ACCOUNT_BALANCE),AccountInfoDouble(ACCOUNT_EQUITY),
      AccountInfoDouble(ACCOUNT_MARGIN_FREE),AccountInfoDouble(ACCOUNT_MARGIN_LEVEL),CountPos(),BasketVolume(),
      BoolJson(campState!=CAMP_IDLE),CampStateName(),
      layers,campId,g_cloudLastCommandRevision,C.configHash,BoolJson(g_observerOnly),g_preflightBlock,
      (g_observerOnly?"OBSERVER_ONLY":g_preflightBlock!=""?g_preflightBlock:C.armed?"SCANNING":"DISARMED"),
      BoolJson((bool)TerminalInfoInteger(TERMINAL_TRADE_ALLOWED)),BoolJson((bool)MQLInfoInteger(MQL_TRADE_ALLOWED)),
      BoolJson((bool)TerminalInfoInteger(TERMINAL_CONNECTED)),
      BoolJson(AccountInfoInteger(ACCOUNT_LOGIN)>0),(int)SymbolInfoInteger(_Symbol,SYMBOL_TRADE_MODE),
      ExecutionProfile(),AccountInfoInteger(ACCOUNT_LEVERAGE),C.normalReferenceLeverage,
      HeartbeatMarginAtOneLot(),g_instanceId,g_cloudLeaseGeneration,(long)g_cloudLeaseUntil,InpMagic);

   string r;int code=0,err=0;
   if(!Http("POST","/api/cloud/monitor/heartbeat",b,r,code,err))
     {
      string reason;
      // APEX-AUDIT-015: heartbeat denial is handled EXACTLY like config denial.
      if(IsAuthenticatedDenial(code,r,reason)){RecordDenial(reason);return false;}
      CloudFailure("HEARTBEAT",code,err,r);
      return false;                    // transport failure never alters C.armed
     }

   int budget=MathMax(400,InpCloudTickBudgetMs);
   if((int)(GetTickCount64()-cloudTickStart)>=budget)
     {
      Print("APEX CLOUD BUDGET | skipped config poll this tick after heartbeat | usedMs=",(int)(GetTickCount64()-cloudTickStart)," budgetMs=",budget);
      g_cloudLastStatus="HEARTBEAT_OK_CONFIG_DEFERRED";
      return true;
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

   string mid=""; JStrStrict("managerInstanceId",mid);
   if(mid=="") JStrStrict("manager_instance_id",mid);
   double untilD=0,genD=0;
   datetime until=0; long gen=0;
   if(JNumStrict("managerLeaseUntil",untilD)||JNumStrict("manager_lease_until",untilD)) until=(datetime)(long)untilD;
   if(JNumStrict("managerGeneration",genD)||JNumStrict("manager_generation",genD)) gen=(long)genD;
   ApplyCloudManagerLease(mid,until,gen);

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
     // v3.8.7: server-proven capacity evidence. Without this the ceiling died with the
     // terminal and the next session repeated the same oversized discovery submission.
     // ownerKey already scopes this file to account+broker+symbol+magic.
     "\"srvRejectedVol\":%.4f,\"srvFilledVol\":%.4f,\"srvEvidenceFreeMargin\":%.2f,"
     "\"consumedTriggers\":%s,"
     "\"setup\":{\"state\":%d,\"id\":\"%s\",\"sig\":\"%s\",\"dir\":%d,"
     "\"armedAt\":%I64d,\"sweepBarTime\":%I64d,\"confirmedAt\":%I64d,\"triggerBarTime\":%I64d,"
     "\"extreme\":%.5f,\"prior\":%.5f,\"atr\":%.5f,\"triggerPrice\":%.5f,\"bosKind\":\"%s\"},"
     "\"pending\":{\"active\":%s,\"isFirstEntry\":%s,\"order\":%I64u,\"dir\":%d,\"requestedVolume\":%.4f,"
     "\"sl\":%.5f,\"score\":%.2f,\"invalidLevel\":%.5f,\"refPrice\":%.5f,\"atr\":%.5f,"
     "\"why\":\"%s\",\"setupId\":\"%s\",\"family\":\"%s\",\"triggerId\":\"%s\","
     "\"submittedAt\":%I64d,\"triggerBar\":%I64d,\"enforceReclaim\":%s},"
     "\"cloudLease\":{\"supported\":%s,\"confirmed\":%s,\"managerId\":\"%s\",\"until\":%I64d,\"generation\":%I64d},"
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
     g_serverRejectedVolume,g_serverFilledVolume,g_serverEvidenceFreeMargin,TriggersJson(),
     (int)S.state,S.id,S.sig,S.dir,(long)S.armedAt,(long)S.sweepBarTime,(long)S.confirmedAt,(long)S.triggerBarTime,
     S.extreme,S.prior,S.atr,S.triggerPrice,S.bosKind,
     BoolJson(g_pending.active),BoolJson(g_pending.isFirstEntry),g_pending.order,g_pending.dir,g_pending.requestedVolume,
     g_pending.sl,g_pending.score,g_pending.invalidLevel,g_pending.refPrice,g_pending.atr,
     g_pending.why,g_pending.setupId,g_pending.family,g_pending.triggerId,
     (long)g_pending.submittedAt,(long)g_pending.triggerBar,BoolJson(g_pending.enforceReclaim),
     BoolJson(g_cloudLeaseSupported),BoolJson(g_cloudLeaseConfirmed),g_cloudManagerId,(long)g_cloudLeaseUntil,g_cloudLeaseGeneration,
     P.accountProfile,P.targetEq,BoolJson(P.profitRatchetEnabled),P.ratchetTriggerPct,P.ratchetLockPct,
     P.ratchetStepPct,P.ratchetLockStepPct,BoolJson(P.masterBreakEvenEnabled),P.masterBreakEvenTriggerPct,
     BoolJson(P.recoveryExitEnabled),P.recoveryExitArmPctOfSL,P.normalFixedSLGoldMove);
   if(!WriteFileAtomic(StateFile(),j))
      Print("APEX STATE WRITE FAILED | file=",StateFile()," | campaign state may not survive a restart");
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
   if(!JNumStrict("schema",sch)||((int)sch!=APEX_STATE_SCHEMA&&(int)sch!=3&&(int)sch!=5)) return -1;
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
   // v3.8.7: restore server-proven capacity evidence. Absent in pre-3.8.7 state files,
   // which correctly yields 0 -- "no evidence", never an invented historical capacity.
   g_serverRejectedVolume    = JNumOr("srvRejectedVol",0);
   g_serverFilledVolume      = JNumOr("srvFilledVol",0);
   g_serverEvidenceFreeMargin= JNumOr("srvEvidenceFreeMargin",0);
   int ti=JIdx("consumedTriggers");
   if(ti>=0&&g_jtype[ti]=='a') TriggersFromJson(g_jval[ti]);
   int si=JIdx("setup"), pdi=JIdx("pending"), li=JIdx("cloudLease");
   string setupBlob=(si>=0&&g_jtype[si]=='o')?g_jval[si]:"";
   string pendBlob=(pdi>=0&&g_jtype[pdi]=='o')?g_jval[pdi]:"";
   string leaseBlob=(li>=0&&g_jtype[li]=='o')?g_jval[li]:"";
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

   if(leaseBlob!="" && JsonParseObject(leaseBlob))
     {
      g_cloudLeaseSupported=JBoolOr("supported",false);
      g_cloudLeaseConfirmed=JBoolOr("confirmed",false);
      g_cloudManagerId=JStrOr("managerId","");
      g_cloudLeaseUntil=(datetime)(long)JNumOr("until",0);
      g_cloudLeaseGeneration=(long)JNumOr("generation",0);
     }
   if(pendBlob!="" && JsonParseObject(pendBlob))
     {
      g_pending.active=JBoolOr("active",false);
      g_pending.isFirstEntry=JBoolOr("isFirstEntry",false);
      g_pending.order=(ulong)JNumOr("order",0);
      g_pending.dir=(int)JNumOr("dir",0);
      g_pending.requestedVolume=JNumOr("requestedVolume",0);
      g_pending.sl=JNumOr("sl",0);
      g_pending.score=JNumOr("score",0);
      g_pending.invalidLevel=JNumOr("invalidLevel",0);
      g_pending.refPrice=JNumOr("refPrice",0);
      g_pending.atr=JNumOr("atr",0);
      g_pending.why=JStrOr("why","");
      g_pending.setupId=JStrOr("setupId","");
      g_pending.family=JStrOr("family","");
      g_pending.triggerId=JStrOr("triggerId","");
      g_pending.submittedAt=(datetime)(long)JNumOr("submittedAt",0);
      g_pending.triggerBar=(datetime)(long)JNumOr("triggerBar",0);
      g_pending.enforceReclaim=JBoolOr("enforceReclaim",true);
     }
   if(setupBlob!="" && JsonParseObject(setupBlob) && campState==CAMP_IDLE)
     {
      int st=(int)JNumOr("state",0);
      int dir=(int)JNumOr("dir",0);
      datetime armed=(datetime)(long)JNumOr("armedAt",0);
      datetime confirmed=(datetime)(long)JNumOr("confirmedAt",0);
      double extreme=JNumOr("extreme",0);
      double liveBid=SymbolInfoDouble(_Symbol,SYMBOL_BID);
      double liveAsk=SymbolInfoDouble(_Symbol,SYMBOL_ASK);
      bool reclaimed=(dir<0)?(liveAsk>=extreme):(liveBid<=extreme);
      if(SetupSnapshotValidToRestore(st,dir,confirmed,armed,TimeCurrent(),C.watchExpiryMinutes,extreme,reclaimed&&InpRejectReclaimedExtreme))
        {
         S.state=(SetupState)st;
         S.id=JStrOr("id","");
         S.sig=JStrOr("sig","");
         S.dir=dir;
         S.armedAt=armed;
         S.sweepBarTime=(datetime)(long)JNumOr("sweepBarTime",0);
         S.confirmedAt=confirmed;
         S.triggerBarTime=(datetime)(long)JNumOr("triggerBarTime",0);
         S.extreme=extreme;
         S.prior=JNumOr("prior",0);
         S.atr=JNumOr("atr",0);
         S.triggerPrice=JNumOr("triggerPrice",0);
         S.bosKind=JStrOr("bosKind","");
         Print("APEX SETUP RESTORED | state=",st," | id=",S.id," | dir=",dir);
        }
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
   // v3.8.8 UNLIMITED layer state machine (see PlanLayerSizing). Zero outside the
   // SIMULATED_1_200 engine, except sizingMode / targetVolume / volumeLimitRoom.
   string sizingMode;
   long   simulatedLeverage;
   double simFreeMargin,simUsedMargin,simMarginPerLot,simFormulaMarginPerLot,simBrokerMarginPerLot;
   double simMarginRate,simMoneyCapacity,targetVolume,volumeLimitRoom;
  };

// v3.8.8: WHICH capacity engine sizes the next layer, and at what percentage. Derived
// only from the profile and the BROKER-CONFIRMED filled layer count -- never from
// attempted orders, never from a retry counter.
struct LayerSizingPlan
  {
   string profile;           // normalised ExecutionProfile()
   int    filledLayers;      // layers already filled in this campaign
   int    layerIndex;        // the layer being prepared (filledLayers+1)
   string mode;              // NORMAL | SIMULATED_1_200 | UNLIMITED | UNLIMITED_PROFIT_FED
   double pct;               // percentage of that mode's capacity
   long   simulatedLeverage; // 200 in SIMULATED_1_200, otherwise 0
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

void InitSizingV388(SizingDecision &d)
  {
   d.sizingMode="";d.simulatedLeverage=0;
   d.simFreeMargin=0;d.simUsedMargin=0;d.simMarginPerLot=0;d.simFormulaMarginPerLot=0;
   d.simBrokerMarginPerLot=0;d.simMarginRate=0;d.simMoneyCapacity=0;d.targetVolume=0;
   d.volumeLimitRoom=-1;
  }

// SYMBOL_VOLUME_LIMIT = the maximum AGGREGATE volume of open positions plus pending
// orders in ONE direction for this symbol (0 = the broker sets no limit). Returns the
// remaining room in that direction, or -1 when the broker publishes no limit.
double VolumeLimitRoom(int dir)
  {
   double lim=SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_LIMIT);
   if(lim<=0) return -1;
   double used=0;
   for(int i=PositionsTotal()-1;i>=0;i--)
     {
      ulong t=PositionGetTicket(i);
      if(t==0||PositionGetString(POSITION_SYMBOL)!=_Symbol) continue;
      bool buy=(PositionGetInteger(POSITION_TYPE)==POSITION_TYPE_BUY);
      if(buy==(dir>0)) used+=PositionGetDouble(POSITION_VOLUME);
     }
   for(int i=OrdersTotal()-1;i>=0;i--)
     {
      ulong t=OrderGetTicket(i);
      if(t==0||OrderGetString(ORDER_SYMBOL)!=_Symbol) continue;
      long ot=OrderGetInteger(ORDER_TYPE);
      bool buy=(ot==ORDER_TYPE_BUY||ot==ORDER_TYPE_BUY_LIMIT||ot==ORDER_TYPE_BUY_STOP||ot==ORDER_TYPE_BUY_STOP_LIMIT);
      bool sell=(ot==ORDER_TYPE_SELL||ot==ORDER_TYPE_SELL_LIMIT||ot==ORDER_TYPE_SELL_STOP||ot==ORDER_TYPE_SELL_STOP_LIMIT);
      if((dir>0&&buy)||(dir<0&&sell)) used+=OrderGetDouble(ORDER_VOLUME_CURRENT);
     }
   return MathMax(0.0,lim-used);
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
   InitSizingV388(d);
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
   // v3.8.8: SYMBOL_VOLUME_LIMIT is a broker execution rule (aggregate one-direction
   // exposure). It bounds what is executable; it is not a percentage denominator.
   d.volumeLimitRoom=VolumeLimitRoom(dir);
   if(d.volumeLimitRoom>=0)
     {
      if(d.volumeLimitRoom<=0){d.blockReason="SYMBOL_VOLUME_LIMIT_REACHED";return d;}
      hi=MathMin(hi,d.volumeLimitRoom);
     }
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

//====================== SIMULATED 1:200 capacity engine (v3.8.8) =====
// Used ONLY for UNLIMITED L1 (15%) and L2 (50%). NORMAL never enters it and UNLIMITED
// L3+ never enters it. It answers exactly one question: "what is the largest volume THIS
// account could execute right now if its leverage were 1:200?"
//
// Why not OrderCalcMargin directly: it prices margin at the account's REAL leverage
// (1:2,000,000,000 on the Exness unlimited account, where it reports 0.00/lot), and MQL5
// has no API that prices an alternate leverage. Scaling it by realLeverage/200 is not
// safe either -- 0 x anything is 0, and brokers that apply a fixed/stricter margin to
// gold do not scale with account leverage at all. So the 1:200 margin is built from the
// symbol's own contract specification ("1:200" = margin is 1/200 of notional):
//
//   notional/lot  = contract * price                     (account ccy == profit ccy)
//                 = price * TICK_VALUE / TICK_SIZE        (otherwise: the broker's own
//                                                          profit->account conversion)
//   rate          = SymbolInfoMarginRate(initial, BUY|SELL) when the calc mode scales
//                   with account leverage (FOREX, CFDLEVERAGE); 1.0 otherwise, because in
//                   every other mode the broker rate already embeds the broker leverage
//   formula/lot   = notional * rate / 200
//   margin200/lot = MAX(formula/lot, OrderCalcMargin(1 lot))  -- a 1:200 account is never
//                   charged LESS than this broker really charges this account
//
//   usedAt200     = SUM over every open position on this symbol (any magic) of
//                   volume * margin200/lot at that side's current price (BUY ask, SELL bid)
//                 + margin of positions on OTHER symbols, which cannot be re-priced
//                   (ACCOUNT_MARGIN minus this symbol's actual OrderCalcMargin)
//   free200       = MIN(ACCOUNT_MARGIN_FREE, ACCOUNT_EQUITY - usedAt200)
//   money200      = (free200 - owner reserve) / margin200/lot
//   capacity200   = the largest broker-grid volume <= MIN(money200, SYMBOL_VOLUME_MAX,
//                   SYMBOL_VOLUME_LIMIT room, owner basket cap, server-proven ceiling,
//                   retry ceiling) whose REAL margin fits ACCOUNT_MARGIN_FREE and which
//                   OrderCheck() accepts
//   target        = capacity200 * pct/100
//   final         = target floored to SYMBOL_VOLUME_STEP; the minimum lot only if it fits
//                   the 1:200 budget; re-validated with OrderCalcMargin + final OrderCheck.
double SimNotionalPerLot(double price)
  {
   double n=NotionalPerLot(price);
   if(n>0) return n;
   double tv=SymbolInfoDouble(_Symbol,SYMBOL_TRADE_TICK_VALUE);
   double ts=SymbolInfoDouble(_Symbol,SYMBOL_TRADE_TICK_SIZE);
   if(price<=0||tv<=0||ts<=0||!MathIsValidNumber(tv)||!MathIsValidNumber(ts)) return 0;
   return price*tv/ts;
  }

// Margin ONE lot needs at leverage `lev` on this account; 0 = cannot be established.
double SimMarginPerLot(int dir,double price,long lev,double &formulaM,double &brokerM,double &rate)
  {
   formulaM=0;brokerM=0;rate=1.0;
   if(lev<=0||price<=0) return 0;
   double notional=SimNotionalPerLot(price);
   if(notional<=0) return 0;
   ENUM_ORDER_TYPE t=dir>0?ORDER_TYPE_BUY:ORDER_TYPE_SELL;
   ENUM_SYMBOL_CALC_MODE cm=(ENUM_SYMBOL_CALC_MODE)SymbolInfoInteger(_Symbol,SYMBOL_TRADE_CALC_MODE);
   if(cm==SYMBOL_CALC_MODE_FOREX||cm==SYMBOL_CALC_MODE_CFDLEVERAGE)
     {
      double init=0,maint=0;
      if(SymbolInfoMarginRate(_Symbol,t,init,maint)&&MathIsValidNumber(init)&&init>0) rate=init;
     }
   formulaM=notional*rate/(double)lev;
   double m=0;
   if(OrderCalcMargin(t,_Symbol,1.0,price,m)&&MathIsValidNumber(m)&&m>0) brokerM=m;
   return MathMax(formulaM,brokerM);
  }

// The account's CURRENT exposure re-priced at leverage `lev`. -1 = an open position on
// this symbol cannot be priced, which refuses sizing rather than under-counting it.
double SimUsedMarginAtLeverage(long lev)
  {
   double symActual=0,symSim=0;
   double ask=SymbolInfoDouble(_Symbol,SYMBOL_ASK),bid=SymbolInfoDouble(_Symbol,SYMBOL_BID);
   for(int i=PositionsTotal()-1;i>=0;i--)
     {
      ulong t=PositionGetTicket(i);
      if(t==0||PositionGetString(POSITION_SYMBOL)!=_Symbol) continue;
      double v=PositionGetDouble(POSITION_VOLUME);
      if(v<=0) continue;
      int pdir=(PositionGetInteger(POSITION_TYPE)==POSITION_TYPE_BUY)?1:-1;
      double px=pdir>0?ask:bid;
      double fm=0,bm=0,rt=0;
      double per=SimMarginPerLot(pdir,px,lev,fm,bm,rt);
      if(per<=0) return -1;
      symSim+=v*per;
      double a=0;
      if(OrderCalcMargin(pdir>0?ORDER_TYPE_BUY:ORDER_TYPE_SELL,_Symbol,v,px,a)&&MathIsValidNumber(a)&&a>0) symActual+=a;
     }
   double other=MathMax(0.0,AccountInfoDouble(ACCOUNT_MARGIN)-symActual);
   return other+symSim;
  }

// execCeiling > 0 bounds capacity by volume the SERVER has just refused (retry path).
SizingDecision ComputeSimulated1200Volume(int dir,double pct,double price,double sl,double execCeiling)
  {
   SizingDecision d;
   d.pct=pct;d.blockReason="";d.checkRetcode=0;d.marginBinding=false;d.usedMarginFallback=false;
   d.capacityByMargin=0;d.capacityByBroker=0;d.capacity=0;
   d.byCapacityPct=0;d.byMarginBudget=0;d.requested=0;d.finalVolume=0;d.budget=0;
   d.marginAtVolMax=0;d.marginAtOneLot=0;d.marginAtFinal=0;
   d.trustedMarginPerLot=0;d.leverageMarginPerLot=0;d.initialMarginPerLot=0;
   d.brokerReportedLeverage=AccountInfoInteger(ACCOUNT_LEVERAGE);
   d.configuredNormalReferenceLeverage=0;     // NORMAL's reference leverage is never consulted
   d.brokerMarginModelTrusted=false;d.moneyCapacity=0;
   InitSizingV388(d);
   d.sizingModel="UNLIMITED_SIMULATED_1_200";
   d.capacitySource="SIMULATED_1_200_MARGIN";
   d.sizingMode="SIMULATED_1_200";
   d.simulatedLeverage=APEX_SIM_LEVERAGE;
   d.effectiveSizingLeverage=APEX_SIM_LEVERAGE;
   d.volMin=SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_MIN);
   d.volMax=SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_MAX);
   d.volStep=VolStep();
   d.freeMargin=AccountInfoDouble(ACCOUNT_MARGIN_FREE);
   if(d.freeMargin<=0){d.blockReason="NO_FREE_MARGIN";return d;}
   if(price<=0){d.blockReason="NO_QUOTE";return d;}
   ENUM_ORDER_TYPE t=dir>0?ORDER_TYPE_BUY:ORDER_TYPE_SELL;
   if(!OrderCalcMargin(t,_Symbol,d.volMax,price,d.marginAtVolMax)) d.marginAtVolMax=-1;
   if(!OrderCalcMargin(t,_Symbol,1.0,price,d.marginAtOneLot)) d.marginAtOneLot=-1;

   // 1. what ONE lot costs at 1:200 on this account
   d.simMarginPerLot=SimMarginPerLot(dir,price,APEX_SIM_LEVERAGE,
                                     d.simFormulaMarginPerLot,d.simBrokerMarginPerLot,d.simMarginRate);
   if(d.simMarginPerLot<=0||!MathIsValidNumber(d.simMarginPerLot))
     {d.blockReason="SIMULATED_1_200_MARGIN_UNAVAILABLE";return d;}
   d.trustedMarginPerLot=d.simMarginPerLot;
   d.leverageMarginPerLot=d.simFormulaMarginPerLot;

   // 2. the account's existing exposure re-priced at 1:200
   d.simUsedMargin=SimUsedMarginAtLeverage(APEX_SIM_LEVERAGE);
   if(d.simUsedMargin<0){d.blockReason="SIMULATED_1_200_EXPOSURE_UNPRICEABLE";return d;}
   d.simFreeMargin=MathMin(d.freeMargin,AccountInfoDouble(ACCOUNT_EQUITY)-d.simUsedMargin);
   if(d.simFreeMargin<=0)
     {d.blockReason=StringFormat("SIMULATED_1_200_NO_FREE_MARGIN_%.2f",d.simFreeMargin);return d;}
   double reservePct=(C.marginReservePct>0)?clamp(C.marginReservePct,0,100):0.0;
   double spendable=MathMax(0.0,d.simFreeMargin*(1.0-reservePct/100.0));
   double realSpendable=MathMax(0.0,d.freeMargin*(1.0-reservePct/100.0));
   d.budget=spendable*clamp(pct,.1,100)/100.0;
   if(d.budget<=0){d.blockReason="ZERO_BUDGET";return d;}

   // 3. technical / execution ceilings -- they clamp, they are never the denominator
   double hi=d.volMax;
   if(C.maxBasketLots>0)
     {
      double room=C.maxBasketLots-BasketVolume();
      if(room<=0){d.blockReason="BASKET_LOT_CAP_REACHED";return d;}
      hi=MathMin(hi,room);
     }
   d.volumeLimitRoom=VolumeLimitRoom(dir);
   if(d.volumeLimitRoom>=0)
     {
      if(d.volumeLimitRoom<=0){d.blockReason="SYMBOL_VOLUME_LIMIT_REACHED";return d;}
      hi=MathMin(hi,d.volumeLimitRoom);
     }
   double learnedCeiling=ServerCapacityCeiling();
   if(learnedCeiling>0) hi=MathMin(hi,learnedCeiling);
   if(execCeiling>0) hi=MathMin(hi,execCeiling);

   // 4. 1:200 capacity, then proven executable on the REAL account
   d.simMoneyCapacity=spendable/d.simMarginPerLot;
   d.moneyCapacity=d.simMoneyCapacity;
   double bound=FloorToStep(MathMin(hi,d.simMoneyCapacity));
   d.capacityByMargin=LargestVolumeWithinMargin(dir,price,realSpendable,bound);
   d.capacityByBroker=LargestVolumePassingCheck(dir,price,sl,d.capacityByMargin);
   if(MarketClosedBackoffActive()){d.blockReason="MARKET_CLOSED_BACKOFF";return d;}
   d.capacity=d.capacityByBroker;
   if(d.capacity<=0){d.blockReason="SIMULATED_1_200_CAPACITY_ZERO";return d;}

   // 5. the layer's percentage of THAT capacity (volume and money forms, as NORMAL)
   d.targetVolume=d.capacity*clamp(pct,.1,100)/100.0;
   d.byCapacityPct=FloorToStep(d.targetVolume);
   d.byMarginBudget=FloorToStep(MathMin(hi,d.budget/d.simMarginPerLot));
   d.requested=MathMin(d.byCapacityPct,d.byMarginBudget);
   d.marginBinding=(d.byMarginBudget<=d.byCapacityPct+1e-9);

   double v=FloorToStep(d.requested);
   if(v<d.volMin)
     {
      // APEX-AUDIT-009: never rounded UP to the broker minimum unless the minimum lot
      // independently fits the 1:200 budget and is itself executable.
      double simMin=d.simMarginPerLot*d.volMin;
      if(simMin>d.budget+1e-8)
        {d.blockReason=StringFormat("MIN_LOT_SIMULATED_1_200_MARGIN_%.2f_EXCEEDS_BUDGET_%.2f",simMin,d.budget);return d;}
      if(d.volMin>d.capacity+1e-9){d.blockReason="MIN_LOT_EXCEEDS_SIMULATED_1_200_CAPACITY";return d;}
      v=NormalizeDouble(d.volMin,VolDigits());
     }
   if(v>hi) v=FloorToStep(hi);
   if(v<=0){d.blockReason="VOLUME_ROUNDS_TO_ZERO";return d;}

   // 6. real-margin validation and a final broker preflight on the EXACT volume
   if(!OrderCalcMargin(t,_Symbol,v,price,d.marginAtFinal)) d.marginAtFinal=-1;
   if(d.marginAtFinal>realSpendable+1e-8)
     {d.blockReason=StringFormat("REAL_MARGIN_%.2f_EXCEEDS_FREE_%.2f",d.marginAtFinal,realSpendable);return d;}
   if(!BrokerAcceptsVolume(dir,v,price,sl,d.checkRetcode))
     {
      if(d.checkRetcode==TRADE_RETCODE_MARKET_CLOSED){NoteMarketClosed("ORDERCHECK",d.checkRetcode);d.blockReason="MARKET_CLOSED_BACKOFF";return d;}
      d.blockReason=StringFormat("SIMULATED_1_200_ORDERCHECK_%d_REJECTED",d.checkRetcode);
      return d;
     }
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
     BoolJson(d.marginBinding),d.checkRetcode,d.blockReason)
   +StringFormat(
     ",\"sizingMode\":\"%s\",\"simulatedLeverage\":%I64d,\"simFreeMargin\":%.2f,\"simUsedMargin\":%.2f,"
     "\"simMarginPerLot\":%.4f,\"simFormulaMarginPerLot\":%.4f,\"simBrokerMarginPerLot\":%.4f,"
     "\"simMarginRate\":%.6f,\"simMoneyCapacity\":%.4f,\"targetVolume\":%.4f,\"volumeLimitRoom\":%.4f",
     d.sizingMode,d.simulatedLeverage,d.simFreeMargin,d.simUsedMargin,
     d.simMarginPerLot,d.simFormulaMarginPerLot,d.simBrokerMarginPerLot,
     d.simMarginRate,d.simMoneyCapacity,d.targetVolume,d.volumeLimitRoom);
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

// v3.8.8: NORMAL keeps its exact v3.8.2 log line. The UNLIMITED state machine prints the
// owner-mandated headline, then the full audit trail on a DETAIL line.
void PrintLayerSizing(const LayerSizingPlan &plan,const SizingDecision &d,int dir)
  {
   if(plan.mode=="NORMAL"){PrintSizing(d,plan.layerIndex,dir);return;}
   PrintFormat("APEX SIZING | profile=%s layer=%d mode=%s capacity=%.2f percentage=%.0f%% target=%.2f final=%.2f",
               plan.profile,plan.layerIndex,plan.mode,d.capacity,plan.pct,d.targetVolume,d.finalVolume);
   PrintFormat("APEX SIZING DETAIL | layer=%d dir=%d mode=%s simulatedLeverage=%s brokerLeverage=1:%I64d"
               " freeMargin=%.2f equity=%.2f | sim1200 marginPerLot=%.2f (formula=%.2f broker=%.2f rate=%.4f)"
               " usedMargin=%.2f freeMargin=%.2f moneyCapacity=%.4f | capacityByMargin=%.4f"
               " capacityByBroker=%.4f capacity=%.4f volumeLimitRoom=%.4f | requested=%.4f normalized=%.4f"
               " FINAL=%.4f volMin=%.4f volMax=%.4f step=%.5f marginAtFinal=%.2f | orderCheck=%d block=%s model=%s",
               plan.layerIndex,dir,plan.mode,
               plan.simulatedLeverage>0?StringFormat("1:%I64d",plan.simulatedLeverage):"NONE",
               AccountInfoInteger(ACCOUNT_LEVERAGE),d.freeMargin,AccountInfoDouble(ACCOUNT_EQUITY),
               d.simMarginPerLot,d.simFormulaMarginPerLot,d.simBrokerMarginPerLot,d.simMarginRate,
               d.simUsedMargin,d.simFreeMargin,d.simMoneyCapacity,d.capacityByMargin,
               d.capacityByBroker,d.capacity,d.volumeLimitRoom,d.targetVolume,d.requested,
               d.finalVolume,d.volMin,d.volMax,d.volStep,d.marginAtFinal,d.checkRetcode,
               d.blockReason==""?"NONE":d.blockReason,d.sizingModel);
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
   // SETUP-TELEMETRY-001: terminal setup transitions must be observable BEFORE
   // the setup slot is cleared. v3.8.6 previously changed the state to EXPIRED /
   // INVALIDATED and then called SetupReset(), whose old WATCHING/CONFIRMED-only
   // logger silently dropped the reason.
   if(S.id!="")
     {
      string eventType="SETUP_CANCELLED";
      string terminalState="CANCELLED";
      if(S.state==SETUP_EXPIRED||reason=="EXPIRED")
        {eventType="SETUP_EXPIRED";terminalState="EXPIRED";}
      else if(S.state==SETUP_INVALIDATED||reason=="NEW_EXTREME_BEYOND_SWEPT_LEVEL")
        {eventType="SETUP_INVALIDATED";terminalState="INVALIDATED";}
      else if(S.state==SETUP_CONSUMED||StringFind(reason,"CONSUMED_BY_CAMPAIGN")==0)
        {eventType="SETUP_CONSUMED";terminalState="CONSUMED";}
      int ageSec=S.armedAt>0?(int)MathMax(0,(double)(TimeCurrent()-S.armedAt)):0;
      Emit(eventType,StringFormat(
           ",\"setupId\":\"%s\",\"setupDir\":%d,\"setupState\":\"%s\",\"cancelReason\":\"%s\",\"extreme\":%.5f,\"ageSec\":%d",
           S.id,S.dir,terminalState,reason,S.extreme,ageSec));
      Print("APEX SETUP TERMINAL | id=",S.id," | dir=",S.dir>0?"BUY":"SELL",
            " | state=",terminalState," | reason=",reason," | ageSec=",ageSec);
     }
   S.state=SETUP_NONE;S.id="";S.dir=0;S.sig="";S.cancelReason=reason;
   S.armedAt=0;S.sweepBarTime=0;S.confirmedAt=0;S.triggerBarTime=0;
   S.extreme=0;S.prior=0;S.atr=0;S.triggerPrice=0;S.bosKind="";
  }
string NewSetupId()
  {
   return StringFormat("S%I64d-%08x",(long)TimeCurrent(),
      Fnv1a(g_instanceId+IntegerToString((int)GetTickCount())+IntegerToString(MathRand())));
  }
void ArmSetup(int dir,datetime anchorBar,double invalidLevel,double referenceLevel,double atr,
              double strength,string sig,string family)
  {
   S.state=SETUP_WATCHING;S.id=NewSetupId();S.dir=dir;S.armedAt=TimeCurrent();S.sweepBarTime=anchorBar;
   S.extreme=invalidLevel;S.prior=referenceLevel;S.atr=atr;S.confirmedAt=0;S.triggerBarTime=0;S.triggerPrice=0;
   S.bosKind="";S.cancelReason="";S.sig=sig;
   Emit("WATCH_ARMED",StringFormat(
      ",\"setupId\":\"%s\",\"watchDir\":%d,\"setupFamily\":\"%s\",\"regime\":\"%s\","
      "\"strength\":%.2f,\"invalidationLevel\":%.5f,\"referenceLevel\":%.5f,\"anchorBarTime\":%I64d",
      S.id,dir,family,sig,strength,invalidLevel,referenceLevel,(long)anchorBar));
  }
string SetupStateText()
  {
   if(S.state==SETUP_WATCHING)return "WATCHING";if(S.state==SETUP_CONFIRMED)return "CONFIRMED";
   if(S.state==SETUP_INVALIDATED)return "INVALIDATED";if(S.state==SETUP_EXPIRED)return "EXPIRED";
   if(S.state==SETUP_CONSUMED)return "CONSUMED";return "NONE";
  }
string FamilyFromSig(string sig)
  {if(StringFind(sig,"BREAKOUT_")==0)return "BREAKOUT";if(StringFind(sig,"TREND_")==0)return "TREND_CONTINUATION";return "UNKNOWN";}
void UpdateTickPressure()
  {
   MqlTick tk;if(!SymbolInfoTick(_Symbol,tk)||tk.bid<=0||tk.ask<=0)return;datetime now=TimeCurrent();
   if(g_tickWindowStart==0||now-g_tickWindowStart>=60){g_tickWindowStart=now;g_tickUp=0;g_tickDown=0;g_lastTickMid=0;}
   double mid=(tk.bid+tk.ask)*.5;if(g_lastTickMid>0){if(mid>g_lastTickMid)g_tickUp++;else if(mid<g_lastTickMid)g_tickDown++;}g_lastTickMid=mid;
  }
double AverageRange(MqlRates &r[],int start,int count)
  {int n=ArraySize(r);if(n<=start||count<=0)return 0;int e=MathMin(n,start+count);double sum=0;int used=0;for(int i=start;i<e;i++){double x=r[i].high-r[i].low;if(x>0){sum+=x;used++;}}return used>0?sum/used:0;}
double DirectionalCandleQuality(MqlRates &b,int dir,double atr)
  {
   double range=MathMax(_Point,b.high-b.low),body=dir>0?b.close-b.open:b.open-b.close;if(body<=0)return 0;
   double efficiency=clamp(body/range,0,1),closeLoc=dir>0?(b.close-b.low)/range:(b.high-b.close)/range,bodyAtr=atr>0?body/atr:0;
   return clamp(efficiency*45.0+clamp(closeLoc,0,1)*35.0+clamp(bodyAtr/.55,0,1)*20.0,0,100);
  }
void CalculatePressure(MqlRates &m1[],double atr,double &buy,double &sell,double &velocity)
  {
   buy=50;sell=50;velocity=0;if(atr<=0||ArraySize(m1)<10)return;double br=1,sr=1;int n=MathMin(8,ArraySize(m1)-1);
   for(int i=1;i<=n;i++){
      double range=MathMax(_Point,m1[i].high-m1[i].low),body=MathAbs(m1[i].close-m1[i].open),eff=clamp(body/range,0,1);
      double volWeight=1.0+clamp((double)m1[i].tick_volume/MathMax(1.0,(double)m1[n].tick_volume),0,3)*.20;
      if(m1[i].close>m1[i].open){br+=(1+2*eff)*volWeight;br+=clamp((m1[i].close-m1[i].low)/range,0,1)*.70;}
      else if(m1[i].close<m1[i].open){sr+=(1+2*eff)*volWeight;sr+=clamp((m1[i].high-m1[i].close)/range,0,1)*.70;}
   }
   double net=(m1[1].close-m1[n].open)/atr;if(net>0)br+=clamp(net,0,3)*1.5;else sr+=clamp(-net,0,3)*1.5;
   double live=(m1[0].close-m1[0].open)/atr;int age=(int)MathMax(1.0,(double)(TimeCurrent()-m1[0].time));velocity=MathAbs(live)*60.0/(double)age;
   if(live>0)br+=clamp(live,0,1.5)*2.0+clamp(velocity,0,3)*.6;else if(live<0)sr+=clamp(-live,0,1.5)*2.0+clamp(velocity,0,3)*.6;
   long ticks=g_tickUp+g_tickDown;if(ticks>=8){double upShare=(double)g_tickUp/(double)ticks;br+=upShare*4.0;sr+=(1.0-upShare)*4.0;}
   double total=MathMax(.0001,br+sr);buy=100*br/total;sell=100*sr/total;
  }
bool IsConfirmedSwingHigh(MqlRates &r[],int i,int wing)
  {
   if(i-wing<1||i+wing>=ArraySize(r))return false;
   double h=r[i].high;
   for(int k=1;k<=wing;k++)if(h<=r[i-k].high||h<=r[i+k].high)return false;
   return true;
  }
bool IsConfirmedSwingLow(MqlRates &r[],int i,int wing)
  {
   if(i-wing<1||i+wing>=ArraySize(r))return false;
   double l=r[i].low;
   for(int k=1;k<=wing;k++)if(l>=r[i-k].low||l>=r[i+k].low)return false;
   return true;
  }
int SwingSequenceDir(MqlRates &r[],int lookback,double atr,double &recentHigh,double &olderHigh,double &recentLow,double &olderLow,string &why)
  {
   recentHigh=olderHigh=recentLow=olderLow=0;why="INSUFFICIENT_SWINGS";
   int n=ArraySize(r),wing=2,maxI=MathMin(n-wing-1,MathMax(10,lookback));int hc=0,lc=0;
   for(int i=wing+1;i<=maxI&&(hc<2||lc<2);i++)
     {
      if(hc<2&&IsConfirmedSwingHigh(r,i,wing)){if(hc==0)recentHigh=r[i].high;else olderHigh=r[i].high;hc++;}
      if(lc<2&&IsConfirmedSwingLow(r,i,wing)){if(lc==0)recentLow=r[i].low;else olderLow=r[i].low;lc++;}
     }
   if(hc<2||lc<2)return 0;
   double tol=MathMax(_Point*5.0,atr*.02);
   bool bull=recentHigh>olderHigh+tol&&recentLow>olderLow+tol;
   bool bear=recentHigh<olderHigh-tol&&recentLow<olderLow-tol;
   if(bull){why="HH_HL";return 1;}if(bear){why="LH_LL";return -1;}
   why="MIXED_SWINGS";return 0;
  }
int StructureBreakDir(MqlRates &r[],double swingHigh,double swingLow,double atr)
  {
   if(ArraySize(r)<3||atr<=0)return 0;double b=MathMax(_Point*5.0,atr*.025),c=r[1].close;
   if(swingHigh>0&&c>swingHigh+b)return 1;
   if(swingLow>0&&c<swingLow-b)return -1;
   return 0;
  }
double ClosedEMA(MqlRates &r[],int period,int startShift)
  {
   int n=ArraySize(r);if(period<2||startShift<1||n<=startShift+period+4)return 0;
   int oldest=MathMin(n-1,startShift+period*2);double ema=r[oldest].close;double k=2.0/(period+1.0);
   for(int i=oldest-1;i>=startShift;i--)ema=r[i].close*k+ema*(1.0-k);
   return ema;
  }
int FreshFlowDir(MqlRates &r[],double &strength,string &why)
  {
   strength=0;why="FLOW_NEUTRAL";if(ArraySize(r)<30)return 0;
   double ar=MathMax(_Point,AverageRange(r,1,14));
   double fast=ClosedEMA(r,8,1),slow=ClosedEMA(r,21,1),fastPrev=ClosedEMA(r,8,2);
   if(fast<=0||slow<=0||fastPrev<=0)return 0;
   double gap=(fast-slow)/ar,slope=(fast-fastPrev)/ar,move4=(r[1].close-r[5].close)/ar,move8=(r[1].close-r[9].close)/ar;
   int bull=0,bear=0;for(int i=1;i<=5;i++){if(r[i].close>r[i].open)bull++;else if(r[i].close<r[i].open)bear++;}
   double bullPts=0,bearPts=0;
   if(gap>.05)bullPts+=2;else if(gap<-.05)bearPts+=2;
   if(slope>.015)bullPts+=1.5;else if(slope<-.015)bearPts+=1.5;
   if(move4>.18)bullPts+=1.5;else if(move4<-.18)bearPts+=1.5;
   if(move8>.35)bullPts+=1.5;else if(move8<-.35)bearPts+=1.5;
   if(r[1].close>fast)bullPts+=1;else if(r[1].close<fast)bearPts+=1;
   if(bull>=3)bullPts+=1;else if(bear>=3)bearPts+=1;
   double edge=bullPts-bearPts;strength=clamp(MathAbs(edge)*14.0,0,100);
   if(edge>=3.0){why=StringFormat("FLOW_BUY gap=%.2f slope=%.2f m4=%.2f m8=%.2f bodies=%d/%d",gap,slope,move4,move8,bull,bear);return 1;}
   if(edge<=-3.0){why=StringFormat("FLOW_SELL gap=%.2f slope=%.2f m4=%.2f m8=%.2f bodies=%d/%d",gap,slope,move4,move8,bull,bear);return -1;}
   why=StringFormat("FLOW_NEUTRAL gap=%.2f slope=%.2f m4=%.2f m8=%.2f bodies=%d/%d",gap,slope,move4,move8,bull,bear);return 0;
  }
void ResolveFreshConsensus(MqlRates &m5[],MqlRates &m15[],MqlRates &m30[],DirectionAuthority &d)
  {
   string w5="",w15="",w30="";d.m5Flow=FreshFlowDir(m5,d.m5FlowStrength,w5);d.m15Flow=FreshFlowDir(m15,d.m15FlowStrength,w15);d.m30Flow=FreshFlowDir(m30,d.m30FlowStrength,w30);
   d.freshDir=0;d.freshTier=0;
   // Entry timing must not fight the immediate M5 flow. M15 is the tactical anchor;
   // M30 is context. This specifically blocks dead-cat M1/M5 bounces inside a sell move.
   if(d.m5Flow!=0&&d.m15Flow!=0&&d.m5Flow==d.m15Flow)
     {
      if(d.m30Flow==0||d.m30Flow==d.m5Flow){d.freshDir=d.m5Flow;d.freshTier=(d.m30Flow==d.m5Flow?3:2);}
     }
   else if(d.m5Flow==0&&d.m15Flow!=0&&d.m30Flow==d.m15Flow)
     {d.freshDir=d.m15Flow;d.freshTier=2;}
   d.freshReason=StringFormat("M5=%d(%.0f) M15=%d(%.0f) M30=%d(%.0f)",d.m5Flow,d.m5FlowStrength,d.m15Flow,d.m15FlowStrength,d.m30Flow,d.m30FlowStrength);
  }
DirectionAuthority EvaluateDirectionAuthority(MqlRates &m5[],MqlRates &m15[],MqlRates &m30[],double atr,double buyPressure,double sellPressure)
  {
   DirectionAuthority d;d.dir=0;d.tier=0;d.structuralDir=0;d.structuralTier=0;d.freshDir=0;d.freshTier=0;d.m5Flow=d.m15Flow=d.m30Flow=0;
   d.m5Seq=0;d.m15Seq=0;d.m5Bos=0;d.m15Bos=0;d.transition=false;d.bullScore=0;d.bearScore=0;d.scoreGap=0;d.pressureGap=buyPressure-sellPressure;
   d.m5FlowStrength=d.m15FlowStrength=d.m30FlowStrength=0;d.reason="NO_DIRECTION_EDGE";d.freshReason="NO_FRESH_FLOW";
   d.m5SwingHigh=d.m5SwingLow=d.m15SwingHigh=d.m15SwingLow=0;
   double oH=0,oL=0;string w5="",w15="";double atr5=MathMax(_Point,AverageRange(m5,1,14)),atr15=MathMax(_Point,AverageRange(m15,1,14));
   d.m5Seq=SwingSequenceDir(m5,38,atr5,d.m5SwingHigh,oH,d.m5SwingLow,oL,w5);
   d.m15Seq=SwingSequenceDir(m15,30,atr15,d.m15SwingHigh,oH,d.m15SwingLow,oL,w15);
   d.m5Bos=StructureBreakDir(m5,d.m5SwingHigh,d.m5SwingLow,atr5);d.m15Bos=StructureBreakDir(m15,d.m15SwingHigh,d.m15SwingLow,atr15);
   if(d.m5Seq>0)d.bullScore+=28;else if(d.m5Seq<0)d.bearScore+=28;if(d.m15Seq>0)d.bullScore+=32;else if(d.m15Seq<0)d.bearScore+=32;
   if(d.m5Bos>0)d.bullScore+=24;else if(d.m5Bos<0)d.bearScore+=24;if(d.m15Bos>0)d.bullScore+=26;else if(d.m15Bos<0)d.bearScore+=26;
   if(d.pressureGap>0)d.bullScore+=MathMin(18.0,d.pressureGap*.60);else d.bearScore+=MathMin(18.0,-d.pressureGap*.60);
   d.scoreGap=d.bullScore-d.bearScore;
   bool seqConflict=d.m5Seq!=0&&d.m15Seq!=0&&d.m5Seq!=d.m15Seq;
   bool m5AgainstM15=d.m15Seq!=0&&d.m5Bos!=0&&d.m5Bos!=d.m15Seq,m15AgainstM5=d.m5Seq!=0&&d.m15Bos!=0&&d.m15Bos!=d.m5Seq;
   bool m5Choch=d.m5Seq!=0&&d.m5Bos!=0&&d.m5Bos!=d.m5Seq,m15Choch=d.m15Seq!=0&&d.m15Bos!=0&&d.m15Bos!=d.m15Seq;
   bool structuralTransition=seqConflict||m5AgainstM15||m15AgainstM5||m5Choch||m15Choch;
   if(!structuralTransition)
     {
      if(d.scoreGap>=35&&d.bullScore>=55){d.structuralDir=1;d.structuralTier=3;}
      else if(d.scoreGap>=20&&d.bullScore>=42){d.structuralDir=1;d.structuralTier=2;}
      else if(d.scoreGap<=-35&&d.bearScore>=55){d.structuralDir=-1;d.structuralTier=3;}
      else if(d.scoreGap<=-20&&d.bearScore>=42){d.structuralDir=-1;d.structuralTier=2;}
     }
   ResolveFreshConsensus(m5,m15,m30,d);
   bool freshPressureOk=d.freshDir>0?d.pressureGap>=4.0:d.freshDir<0?d.pressureGap<=-4.0:false;
   bool freshBos=d.freshDir>0?(d.m5Bos>0||d.m15Bos>0):d.freshDir<0?(d.m5Bos<0||d.m15Bos<0):false;
   if(d.freshDir==0||d.freshTier<2||!freshPressureOk)
     {d.transition=true;d.reason=StringFormat("FRESH_DIRECTION_WAIT struct=%d fresh=%d pressureGap=%.1f %s",d.structuralDir,d.freshDir,d.pressureGap,d.freshReason);return d;}
   if(d.structuralDir==d.freshDir&&d.structuralTier>=2)
     {d.dir=d.freshDir;d.tier=MathMax(2,MathMin(3,d.structuralTier));d.transition=false;d.reason=StringFormat("ALIGNED_%s structTier=%d freshTier=%d %s",d.dir>0?"BUY":"SELL",d.structuralTier,d.freshTier,d.freshReason);return d;}
   if(d.structuralDir==0&&!structuralTransition&&d.freshTier>=3)
     {d.dir=d.freshDir;d.tier=2;d.transition=false;d.reason=StringFormat("FULL_FRESH_%s_WITH_NEUTRAL_STRUCTURE %s",d.dir>0?"BUY":"SELL",d.freshReason);return d;}
   // Fresh reversal is allowed only after the market has actually broken structure in
   // the fresh direction. Until then Apex waits instead of trading the stale old trend.
   if(freshBos&&d.freshTier>=3)
     {d.dir=d.freshDir;d.tier=2;d.transition=false;d.reason=StringFormat("FRESH_REVERSAL_CONFIRMED_%s BOS=%d/%d %s",d.dir>0?"BUY":"SELL",d.m5Bos,d.m15Bos,d.freshReason);return d;}
   d.transition=true;d.reason=StringFormat("SLOW_FRESH_CONFLICT_WAIT struct=%d fresh=%d BOS=%d/%d %s",d.structuralDir,d.freshDir,d.m5Bos,d.m15Bos,d.freshReason);return d;
  }
bool DirectionPermits(const DirectionAuthority &d,int dir,bool breakout)
  {
   if(dir==0||d.transition||d.dir!=dir||d.tier<2)return false;
   if(d.freshDir!=dir||d.freshTier<2)return false;
   // Breakout entries need current pressure in the same direction too. Trend entries
   // already require fresh-flow alignment above and their own pressure/ignition gate.
   if(breakout){if(dir>0&&d.pressureGap<8.0)return false;if(dir<0&&d.pressureGap>-8.0)return false;}
   return true;
  }
bool StructuralBreakoutContext(MqlRates &m1[],MqlRates &m5[],MqlRates &m15[],int dir,double atr,double price,double &level,int &touches,double &compression,double &extensionAtr)
  {
   if(ArraySize(m1)<24||ArraySize(m5)<16||ArraySize(m15)<12||atr<=0)return false;
   double rh=0,oh=0,rl=0,ol=0;string why="";
   double atr5=MathMax(_Point,AverageRange(m5,1,14)),atr15=MathMax(_Point,AverageRange(m15,1,14));
   SwingSequenceDir(m5,38,atr5,rh,oh,rl,ol,why);
   double h15=0,l15=0;SwingSequenceDir(m15,30,atr15,h15,oh,l15,ol,why);
   level=dir>0?rh:rl;
   if(level<=0)
     {
      level=dir>0?-DBL_MAX:DBL_MAX;
      for(int i=3;i<=12;i++)level=dir>0?MathMax(level,m5[i].high):MathMin(level,m5[i].low);
     }
   // If a nearby M15 structural level sits immediately beyond the M5 level, treat them as
   // one breakout barrier instead of buying directly into resistance / selling into support.
   double higher=dir>0?h15:l15;
   if(higher>0)
     {
      double ahead=dir>0?(higher-level):(level-higher);
      if(ahead>=0&&ahead<=atr*.40)level=higher;
     }
   double tol=MathMax(_Point*10.0,atr*.10);touches=0;int last=-99;
   int look=MathMax(8,MathMin(C.breakoutLookbackBars,60));
   for(int i=2;i<=look+1&&i<ArraySize(m1);i++)
     {
      double v=dir>0?m1[i].high:m1[i].low;
      if(MathAbs(v-level)<=tol&&MathAbs(i-last)>=2){touches++;last=i;}
     }
   int comp=0,total=0;for(int i=2;i<=6&&i+3<ArraySize(m1);i++){total++;if(dir>0&&m1[i].low>m1[i+3].low)comp++;if(dir<0&&m1[i].high<m1[i+3].high)comp++;}
   compression=total>0?100.0*(double)comp/(double)total:0;
   extensionAtr=dir>0?(price-level)/atr:(level-price)/atr;double distanceAtr=dir>0?(level-price)/atr:(price-level)/atr;
   return touches>=C.breakoutMinTouches&&distanceAtr<=C.breakoutArmDistanceAtr&&extensionAtr<=C.breakoutMaxExtensionAtr;
  }
bool ProfessionalTrendPullback(MqlRates &m1[],MqlRates &m5[],int dir,double atr,const DirectionAuthority &d,double &invalidLevel,double &quality)
  {
   if(d.dir!=dir||d.tier<2||d.transition)return false;
   int pb=MathMax(3,MathMin(C.trendPullbackBars,12));if(ArraySize(m1)<pb+8||ArraySize(m5)<10||atr<=0)return false;
   int opposing=0;double oppBody=0;invalidLevel=dir>0?DBL_MAX:-DBL_MAX;
   // Bar 1 is reserved for the NEW closed confirmation candle. The pullback
   // itself must already exist on bars 2..pb+1.
   for(int i=2;i<=pb+1;i++)
     {
      double body=MathAbs(m1[i].close-m1[i].open);
      bool opp=dir>0?m1[i].close<m1[i].open:m1[i].close>m1[i].open;
      if(opp){opposing++;oppBody+=body;}
      if(dir>0)invalidLevel=MathMin(invalidLevel,m1[i].low);else invalidLevel=MathMax(invalidLevel,m1[i].high);
     }
   if(opposing<2)return false;
   double anchor=dir>0?-DBL_MAX:DBL_MAX;for(int i=pb+2;i<=pb+5;i++)anchor=dir>0?MathMax(anchor,m1[i].high):MathMin(anchor,m1[i].low);
   double depth=dir>0?(anchor-invalidLevel)/atr:(invalidLevel-anchor)/atr;if(depth<.10||depth>C.trendMaxPullbackAtr)return false;
   double avgOpp=oppBody/MathMax(1,opposing);if(avgOpp>atr*.45)return false;
   double structLow=d.m5SwingLow,structHigh=d.m5SwingHigh;
   if(dir>0&&structLow>0&&invalidLevel<=structLow-atr*.05)return false;
   if(dir<0&&structHigh>0&&invalidLevel>=structHigh+atr*.05)return false;
   quality=clamp(100.0*(1.0-depth/MathMax(.01,C.trendMaxPullbackAtr)) + MathMin(15.0,(double)opposing*3.0),0,100);
   invalidLevel+=dir>0?(-atr*.04):(atr*.04);return true;
  }

bool ClosedConfirmationPattern(MqlRates &m1[],int dir,double atr,double activePressure,double oppositePressure,double pressureMin,double &quality,string &kind)
  {
   quality=0;kind="NONE";if(ArraySize(m1)<5||atr<=0)return false;
   MqlRates c=m1[1];
   double range=MathMax(_Point,c.high-c.low),body=dir>0?c.close-c.open:c.open-c.close;if(body<=0)return false;
   double closeLoc=dir>0?(c.close-c.low)/range:(c.high-c.close)/range,bodyAtr=body/atr;
   double badWick=dir>0?(c.high-c.close)/range:(c.close-c.low)/range;
   bool closeBreak=dir>0?c.close>m1[2].high:c.close<m1[2].low;
   bool engulf=dir>0?(m1[2].close<m1[2].open&&c.close>m1[2].open&&c.open<=m1[2].close):(m1[2].close>m1[2].open&&c.close<m1[2].open&&c.open>=m1[2].close);
   bool reclaim=dir>0?(m1[2].low<m1[3].low&&c.close>m1[2].high):(m1[2].high>m1[3].high&&c.close<m1[2].low);
   if(!(closeBreak||engulf||reclaim))return false;
   if(bodyAtr<C.ignitionBodyAtr||closeLoc<C.ignitionCloseLocation||badWick>.30)return false;
   if(activePressure<pressureMin||activePressure-oppositePressure<10.0)return false;
   quality=DirectionalCandleQuality(c,dir,atr);
   kind=closeBreak?"CLOSED_M1_STRUCTURE_BREAK":engulf?"CLOSED_M1_ENGULF_CONFIRM":"CLOSED_M1_RECLAIM_CONFIRM";
   return quality>=60;
  }

bool BreakoutClosedConfirmed(MqlRates &m1[],int dir,double level,double atr,double bufferAtr)
  {
   if(ArraySize(m1)<4||atr<=0||level<=0)return false;
   double buf=bufferAtr*atr;
   bool beyond=dir>0?m1[1].close>=level+buf:m1[1].close<=level-buf;
   if(!beyond)return false;
   bool freshBreak=dir>0?m1[2].close<level+buf:m1[2].close>level-buf;
   bool retestHold=dir>0?(m1[2].low<=level+atr*.10&&m1[1].close>m1[2].close):(m1[2].high>=level-atr*.10&&m1[1].close<m1[2].close);
   return freshBreak||retestHold;
  }

string SetupWaitReason(const Snap &s,double threshold)
  {
   if(s.reason=="DIRECTION_AUTHORITY_NOT_ALIGNED")return "DIRECTION_AUTHORITY";
   if(StringFind(s.directionReason,"TRANSITION")==0)return "DIRECTION_TRANSITION";
   if(!s.contextOk)return "CONTEXT";
   if(!s.ignition)return "CLOSED_CONFIRMATION";
   if(s.score<threshold)return "SCORE";
   return "READY";
  }
void EmitSetupTelemetry(const Snap &s,double threshold)
  {
   if(S.id=="")return;string waitReason=SetupWaitReason(s,threshold);datetime closedBar=iTime(_Symbol,PERIOD_M1,1);
   string fp=StringFormat("%s|%I64d|%s|%s|%d|%d|%d",S.id,(long)closedBar,SetupStateText(),waitReason,(int)(s.score/5),(int)(s.activePressure/5),(int)(s.candleQuality/5));static string last="";if(fp==last)return;last=fp;
   Emit("SETUP_SCORE",StringFormat(
      ",\"setupId\":\"%s\",\"setupDir\":%d,\"setupState\":\"%s\",\"setupFamily\":\"%s\",\"regime\":\"%s\",\"score\":%.2f,\"requiredScore\":%.2f,"
      "\"buyPressure\":%.2f,\"sellPressure\":%.2f,\"activePressure\":%.2f,\"trendStrength\":%.2f,\"candleQuality\":%.2f,\"compressionScore\":%.2f,\"pullbackQuality\":%.2f,"
      "\"contextOk\":%s,\"ignition\":%s,\"liveTrigger\":%s,\"waitReason\":\"%s\",\"triggerKind\":\"%s\",\"breakoutLevel\":%.5f,\"invalidationLevel\":%.5f,\"triggerPrice\":%.5f,\"triggerBarTime\":%I64d,"
      "\"directionBias\":%d,\"directionTier\":%d,\"structuralBias\":%d,\"freshDirection\":%d,\"freshDirectionTier\":%d,"
      "\"m5Flow\":%d,\"m15Flow\":%d,\"m30Flow\":%d,\"m5FlowStrength\":%.2f,\"m15FlowStrength\":%.2f,\"m30FlowStrength\":%.2f,"
      "\"m5Structure\":%d,\"m15Structure\":%d,\"m5Bos\":%d,\"m15Bos\":%d,\"directionScoreGap\":%.2f,\"pressureGap\":%.2f,\"directionReason\":\"%s\",\"freshDirectionReason\":\"%s\"",
      S.id,S.dir,SetupStateText(),s.setupFamily,s.regime,s.score,threshold,s.buyPressure,s.sellPressure,s.activePressure,s.trendStrength,s.candleQuality,s.compressionScore,s.pullbackQuality,
      BoolJson(s.contextOk),BoolJson(s.ignition),BoolJson(s.liveTrigger),waitReason,s.triggerKind,s.breakoutLevel,S.extreme,s.triggerPrice,(long)s.triggerBarTime,
      s.directionBias,s.directionTier,s.structuralBias,s.freshDirection,s.freshDirectionTier,s.m5Flow,s.m15Flow,s.m30Flow,s.m5FlowStrength,s.m15FlowStrength,s.m30FlowStrength,
      s.m5Structure,s.m15Structure,s.m5Bos,s.m15Bos,s.directionScoreGap,s.pressureGap,s.directionReason,s.freshDirectionReason));
  }
Snap Observe()
  {
   Snap s;s.valid=false;s.dir=0;s.score=0;s.atr=ATR();s.price=0;s.extreme=0;s.impulseMult=0;s.sweepMult=0;s.wickRatio=0;s.swept=false;s.rejected=false;s.microBreak=false;
   s.m3Color=false;s.m5Color=false;s.m3Fresh=false;s.continuation=false;s.pullbackFail=false;s.sig="NONE";s.reason="";s.bosKind="NONE";s.triggerBarTime=0;s.triggerPrice=0;
   s.setupFamily="NONE";s.regime="UNKNOWN";s.triggerKind="NONE";s.buyPressure=50;s.sellPressure=50;s.activePressure=50;s.trendStrength=0;s.candleQuality=0;s.breakoutLevel=0;s.compressionScore=0;s.pullbackQuality=0;s.contextOk=false;s.ignition=false;s.liveTrigger=false;
   s.directionBias=0;s.directionTier=0;s.m5Structure=0;s.m15Structure=0;s.m5Bos=0;s.m15Bos=0;s.structuralBias=0;s.freshDirection=0;s.freshDirectionTier=0;s.m5Flow=0;s.m15Flow=0;s.m30Flow=0;s.directionScoreGap=0;s.pressureGap=0;s.m5FlowStrength=0;s.m15FlowStrength=0;s.m30FlowStrength=0;s.directionReason="";s.freshDirectionReason="";
   if(s.atr<=0){s.reason="NO_ATR";return s;}MqlRates m1[],m5[],m15[],m30[];if(!Rates(PERIOD_M1,90,m1)){s.reason="NO_M1_HISTORY";return s;}if(!Rates(PERIOD_M5,60,m5)||!Rates(PERIOD_M15,50,m15)||!Rates(PERIOD_M30,50,m30)){s.reason="NO_CONTEXT_HISTORY";return s;}
   MqlTick tk;if(!SymbolInfoTick(_Symbol,tk)||tk.bid<=0||tk.ask<=0){s.reason="NO_FRESH_QUOTE";return s;}double velocity=0;CalculatePressure(m1,s.atr,s.buyPressure,s.sellPressure,velocity);
   DirectionAuthority da=EvaluateDirectionAuthority(m5,m15,m30,s.atr,s.buyPressure,s.sellPressure);
   s.directionBias=da.dir;s.directionTier=da.tier;s.structuralBias=da.structuralDir;s.freshDirection=da.freshDir;s.freshDirectionTier=da.freshTier;s.m5Flow=da.m5Flow;s.m15Flow=da.m15Flow;s.m30Flow=da.m30Flow;s.m5Structure=da.m5Seq;s.m15Structure=da.m15Seq;s.m5Bos=da.m5Bos;s.m15Bos=da.m15Bos;s.directionScoreGap=da.scoreGap;s.pressureGap=da.pressureGap;s.m5FlowStrength=da.m5FlowStrength;s.m15FlowStrength=da.m15FlowStrength;s.m30FlowStrength=da.m30FlowStrength;s.directionReason=da.reason;s.freshDirectionReason=da.freshReason;

   if(S.state==SETUP_WATCHING||S.state==SETUP_CONFIRMED)
     {
      if(TimeCurrent()-S.armedAt>C.watchExpiryMinutes*60){S.state=SETUP_EXPIRED;SetupReset("EXPIRED");}
      else
        {
         bool bad=S.dir>0?(tk.bid<=S.extreme):(tk.ask>=S.extreme);
         bool directionFlipped=(da.dir!=0&&da.tier>=2&&da.dir!=S.dir)||(da.freshDir!=0&&da.freshTier>=2&&da.freshDir!=S.dir);
         if(directionFlipped){S.state=SETUP_INVALIDATED;SetupReset("DIRECTION_AUTHORITY_FLIPPED");}
         else if(bad){S.state=SETUP_INVALIDATED;SetupReset("THESIS_INVALIDATION_LEVEL_BREACHED");}
        }
     }

   double upLevel=0,dnLevel=0,upComp=0,dnComp=0,upExt=0,dnExt=0;int upTouches=0,dnTouches=0;
   bool upCtx=StructuralBreakoutContext(m1,m5,m15,1,s.atr,tk.ask,upLevel,upTouches,upComp,upExt);
   bool dnCtx=StructuralBreakoutContext(m1,m5,m15,-1,s.atr,tk.bid,dnLevel,dnTouches,dnComp,dnExt);
   bool upAllowed=DirectionPermits(da,1,true),dnAllowed=DirectionPermits(da,-1,true);
   int trendDir=(da.tier>=2&&!da.transition)?da.dir:0;double trendInvalid=0,pbQ=0;
   bool trendCtx=trendDir!=0&&ProfessionalTrendPullback(m1,m5,trendDir,s.atr,da,trendInvalid,pbQ);

   if(S.state==SETUP_NONE)
     {
      // Detection only. Entry is impossible on the same candle that creates the setup.
      // Apex arms first, then waits for a NEW fully closed M1 confirmation bar.
      if((upCtx&&upAllowed)||(dnCtx&&dnAllowed))
        {
         int d=(upCtx&&upAllowed)?1:-1;double level=d>0?upLevel:dnLevel,comp=d>0?upComp:dnComp;
         double inv=d>0?level-.20*s.atr:level+.20*s.atr;ArmSetup(d,m1[1].time,inv,level,s.atr,comp,d>0?"BREAKOUT_UP":"BREAKOUT_DOWN","BREAKOUT");
        }
      else if(trendCtx)
         ArmSetup(trendDir,m1[1].time,trendInvalid,m1[1].close,s.atr,MathAbs(da.scoreGap),trendDir>0?"TREND_UP_CONTINUATION":"TREND_DOWN_CONTINUATION","TREND_CONTINUATION");
     }

   if(S.state!=SETUP_WATCHING&&S.state!=SETUP_CONFIRMED){s.reason=da.transition?"DIRECTION_TRANSITION_WAIT":"NO_QUALIFIED_CONTEXT";return s;}
   string activeFamily=FamilyFromSig(S.sig);
   s.dir=S.dir;s.sig=S.sig;s.extreme=S.extreme;s.price=S.dir>0?tk.ask:tk.bid;s.triggerPrice=s.price;s.triggerBarTime=m1[1].time;s.setupFamily=activeFamily;s.regime=S.sig;s.activePressure=S.dir>0?s.buyPressure:s.sellPressure;
   s.trendStrength=MathMax(MathAbs(da.scoreGap),MathMax(da.m5FlowStrength,da.m15FlowStrength));
   double threshold=C.entryScore+(C.learningEnabled?C.learnEntryAdj:0);
   bool stillAllowed=DirectionPermits(da,S.dir,activeFamily=="BREAKOUT");
   if(!stillAllowed)
     {
      s.reason="DIRECTION_AUTHORITY_NOT_ALIGNED";s.contextOk=false;s.ignition=false;s.liveTrigger=false;
      EmitSetupTelemetry(s,threshold);return s;
     }

   double cq=0;string kind="NONE";bool ctx=false,confirmed=false;
   bool newClosedBar=m1[1].time>S.sweepBarTime;
   if(s.setupFamily=="BREAKOUT")
     {
      double level=0,comp=0,ext=0;int touches=0;ctx=StructuralBreakoutContext(m1,m5,m15,S.dir,s.atr,s.price,level,touches,comp,ext)&&DirectionPermits(da,S.dir,true);
      double opp=S.dir>0?s.sellPressure:s.buyPressure;
      bool closedBreak=newClosedBar&&BreakoutClosedConfirmed(m1,S.dir,S.prior,s.atr,C.breakoutBufferAtr);
      confirmed=ctx&&closedBreak&&ClosedConfirmationPattern(m1,S.dir,s.atr,s.activePressure,opp,C.breakoutPressureMin,cq,kind);
      s.breakoutLevel=S.prior;s.compressionScore=comp;
      s.score=clamp(8+s.activePressure*.18+cq*.20+comp*.08+MathMin(8.0,(double)touches*2.0)+MathMin(18.0,MathAbs(da.scoreGap)*.28)+MathMin(14.0,MathMax(da.m5FlowStrength,da.m15FlowStrength)*.14)+(closedBreak?10:0),0,100);
     }
   else
     {
      double inv=0,pq=0;ctx=ProfessionalTrendPullback(m1,m5,S.dir,s.atr,da,inv,pq);double opp=S.dir>0?s.sellPressure:s.buyPressure;
      confirmed=newClosedBar&&ctx&&ClosedConfirmationPattern(m1,S.dir,s.atr,s.activePressure,opp,C.trendPressureMin,cq,kind);s.pullbackQuality=pq;
      s.score=0;
     }
   if(s.setupFamily=="TREND_CONTINUATION")
      s.score=clamp(8+s.activePressure*.18+cq*.20+MathMin(20.0,MathAbs(da.scoreGap)*.30)+MathMin(16.0,MathMax(da.m5FlowStrength,da.m15FlowStrength)*.16)+s.pullbackQuality*.14+(confirmed?10:0),0,100);
   s.contextOk=ctx;s.ignition=confirmed;s.liveTrigger=false;s.candleQuality=cq;s.triggerKind=kind;s.bosKind=kind;s.rejected=ctx;s.microBreak=confirmed;s.continuation=s.setupFamily=="TREND_CONTINUATION";
   s.valid=ctx&&confirmed&&newClosedBar&&stillAllowed&&s.candleQuality>=60&&s.score>=threshold;s.reason=s.valid?"CLOSED_SETUP_CONFIRMATION_READY":SetupWaitReason(s,threshold);bool fresh=s.valid&&S.state==SETUP_WATCHING;
   if(fresh){S.state=SETUP_CONFIRMED;S.confirmedAt=TimeCurrent();S.triggerBarTime=s.triggerBarTime;S.triggerPrice=s.triggerPrice;S.bosKind=kind;}EmitSetupTelemetry(s,threshold);
   if(fresh)Emit("SETUP_CONFIRMED",StringFormat(",\"setupId\":\"%s\",\"setupDir\":%d,\"setupState\":\"CONFIRMED\",\"setupFamily\":\"%s\",\"regime\":\"%s\",\"score\":%.2f,\"requiredScore\":%.2f,\"directionTier\":%d,\"structuralBias\":%d,\"freshDirection\":%d,\"freshDirectionTier\":%d,\"m5Flow\":%d,\"m15Flow\":%d,\"m30Flow\":%d,\"m5Structure\":%d,\"m15Structure\":%d,\"pressureGap\":%.2f,\"directionReason\":\"%s\",\"freshDirectionReason\":\"%s\",\"triggerKind\":\"%s\",\"triggerPrice\":%.5f,\"triggerBarTime\":%I64d",S.id,S.dir,s.setupFamily,s.regime,s.score,threshold,s.directionTier,s.structuralBias,s.freshDirection,s.freshDirectionTier,s.m5Flow,s.m15Flow,s.m30Flow,s.m5Structure,s.m15Structure,s.pressureGap,s.directionReason,s.freshDirectionReason,kind,s.triggerPrice,(long)s.triggerBarTime));
   return s;
  }

double ScoreFloorGivenMandatory(){return 0.0;}

//====================== final executable-price gate (APEX-AUDIT-001) ==
struct Gate
  {
   bool     ok;
   string   reason;
   double   bid,ask,price,extensionAtr;
   long     quoteAgeMs;
   bool     reclaimed,triggerStale,quoteStale,extended;
  };

// Run IMMEDIATELY before every submission, and again after anything that can block.
// "The setup happened" and "this is still an executable price" are separate questions.
bool FinalEntryGate(int dir,double invalidLevel,double refPrice,double atr,
                    datetime triggerBar,bool enforceReclaim,Gate &g)
  {
   g.ok=false;g.reason="";g.bid=0;g.ask=0;g.price=0;g.extensionAtr=0;g.quoteAgeMs=0;
   g.reclaimed=false;g.triggerStale=false;g.quoteStale=false;g.extended=false;

   MqlTick tk;
   if(!SymbolInfoTick(_Symbol,tk)||tk.bid<=0||tk.ask<=0){g.reason="NO_FRESH_QUOTE";return false;}
   g.bid=tk.bid;g.ask=tk.ask;
   g.price=dir>0?tk.ask:tk.bid;
   g.quoteAgeMs=(long)TimeCurrent()*1000-(long)tk.time_msc;
   if(g.quoteAgeMs<0)g.quoteAgeMs=0;

   if(InpMaxQuoteAgeMs>0&&g.quoteAgeMs>InpMaxQuoteAgeMs)
     {g.quoteStale=true;g.reason=StringFormat("STALE_QUOTE_%I64dms",g.quoteAgeMs);return false;}

   // The confirming bar must still be the latest closed M1 bar. This is what makes a
   // stored, already-completed candle pattern unable to authorise an entry later.
   if(InpRequireFreshTrigger&&triggerBar>0)
     {
      datetime lastClosed=iTime(_Symbol,PERIOD_M1,1);
      if(lastClosed!=triggerBar)
        {g.triggerStale=true;
         g.reason=StringFormat("TRIGGER_BAR_NO_LONGER_LATEST_%I64d_vs_%I64d",(long)triggerBar,(long)lastClosed);
         return false;}
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


// WAF/HTML 401/403 is TRANSPORT, not an authenticated license denial.
bool BodyLooksLikeJsonObject(const string resp)
  {
   int n=StringLen(resp),i=0;
   while(i<n)
     {
      ushort c=StringGetCharacter(resp,i);
      if(c==' '||c=='\t'||c=='\r'||c=='\n'){i++;continue;}
      return c=='{';
     }
   return false;
  }
bool IsXauCloudDenialEnvelope(bool parsedOk,const string licenseStatus,const string error,const string reason,bool hasOk,bool okValue)
  {
   if(!parsedOk) return false;
   if(licenseStatus=="ACTIVE") return false;
   if(licenseStatus=="LICENSE_DENIED"||licenseStatus=="LICENSE_NOT_ACTIVE"||
      licenseStatus=="LICENSE_DISABLED"||licenseStatus=="LICENSE_EXPIRED"||
      licenseStatus=="LICENSE_NOT_FOUND"||licenseStatus=="ACCOUNT_MISMATCH"||
      licenseStatus=="DISABLED"||licenseStatus=="EXPIRED")
      return true;
   if(error=="LICENSE_DENIED"||error=="LICENSE_NOT_ACTIVE"||error=="license_not_active"||
      error=="LICENSE_DISABLED"||error=="LICENSE_EXPIRED"||error=="LICENSE_NOT_FOUND"||
      error=="ACCOUNT_MISMATCH")
      return true;
   if(hasOk && !okValue && (licenseStatus!=""||reason!=""||error!="")) return true;
   return false;
  }

// 1 = fill exists, 2 = broker accepted as pending/placed (do NOT reset campaign), 0 = rejected
int ClassifyBrokerSubmit(uint rc,bool hasFill)
  {
   if(hasFill) return 1;
   if(rc==TRADE_RETCODE_PLACED) return 2;
   return 0;
  }

// Cloud manager fencing. Network loss never lets a second terminal open new exposure.
bool ManagerAllowsNewExposure(const string myId,const string cloudManagerId,datetime leaseUntil,datetime now,bool cloudLeaseSupported,bool weWereConfirmedManager)
  {
   if(!cloudLeaseSupported) return true;
   if(cloudManagerId=="" ) return weWereConfirmedManager && leaseUntil>=now;
   if(cloudManagerId==myId && leaseUntil>=now) return true;
   return false;
  }

bool SetupSnapshotValidToRestore(int state,int dir,datetime confirmedAt,datetime armedAt,datetime now,int watchExpiryMinutes,double extreme,bool marketReclaimed)
  {
   if(state!=SETUP_WATCHING && state!=SETUP_CONFIRMED) return false;
   if(dir==0) return false;
   if(extreme<=0) return false;
   datetime ageFrom=(state==SETUP_CONFIRMED&&confirmedAt>0)?confirmedAt:armedAt;
   if(ageFrom<=0) return false;
   if(watchExpiryMinutes>0 && now-ageFrom>watchExpiryMinutes*60) return false;
   if(marketReclaimed) return false;
   return true;
  }

void ApplyCloudManagerLease(const string mid,datetime until,long generation)
  {
   bool echoed=(mid!=""||until>0||generation>0);
   g_cloudLeaseSupported=echoed;
   if(!echoed) return;
   g_cloudManagerId=mid;
   g_cloudLeaseUntil=until;
   if(generation>0) g_cloudLeaseGeneration=generation;
   bool mine=(mid==g_instanceId && until>=TimeCurrent());
   if(mine)
     {
      bool wasObs=g_observerOnly;
      g_cloudLeaseConfirmed=true;
      g_observerOnly=false;
      if(wasObs) Print("APEX CLOUD LEASE ACQUIRED | instance=",g_instanceId," until=",(long)until," gen=",generation);
     }
   else if(mid!="" && mid!=g_instanceId && until>=TimeCurrent())
     {
      g_cloudLeaseConfirmed=false;
      if(!g_observerOnly)
        {
         g_observerOnly=true;
         Print("APEX CROSS-TERMINAL OBSERVER | manager=",mid," until=",(long)until," | this instance will NOT submit new exposure");
        }
     }
   else
     {
      if(!(g_cloudLeaseConfirmed && mid==g_instanceId))
         g_cloudLeaseConfirmed=false;
     }
  }

void ClearPending(string reason)
  {
   if(!g_pending.active) return;
   Emit("ORDER_PENDING_CLEARED",StringFormat(",\"reason\":\"%s\",\"order\":%I64u,\"setupId\":\"%s\",\"isFirstEntry\":%s",
        reason,g_pending.order,g_pending.setupId,BoolJson(g_pending.isFirstEntry)));
   if(g_pending.isFirstEntry && campState==CAMP_SUBMITTING)
     {
      campState=CAMP_IDLE;campId="";campSig="";campDir=0;
      layers=0;ClearState();
      Print("APEX PENDING ABANDONED | first entry not filled | setup preserved if still valid | reason=",reason);
     }
   g_pending.active=false;
   g_pending.order=0;
   g_pending.setupId="";
   g_pending.family="";
   g_pending.triggerId="";
   g_pending.why="";
   SaveState();
  }

void PromotePendingFill()
  {
   if(!g_pending.active) return;
   layers++;
   lastAdd=(g_pending.refPrice>0?g_pending.refPrice:SymbolInfoDouble(_Symbol,g_pending.dir>0?SYMBOL_ASK:SYMBOL_BID));
   if(g_pending.isFirstEntry)
     {
      firstEntryPrice=lastAdd;
      masterTicket=FindOldestApexPosition();
      masterGuardStage=0;
      recoveryExitArmed=false;
      double brokerSL=0;
      if(masterTicket!=0&&PositionSelectByTicket(masterTicket)) brokerSL=PositionGetDouble(POSITION_SL);
      firstSLPrice=brokerSL;firstInitialSLPrice=brokerSL;
      anchorsKnown=true;
      campState=CAMP_ACTIVE;
      S.state=SETUP_CONSUMED;
      Emit("CAMPAIGN_START",StringFormat(
        ",\"score\":%.2f,\"targetEquity\":%.2f,\"cycleStart\":%.2f,\"entryPrice\":%.5f,\"setupId\":\"%s\","
        "\"lateFill\":true,\"pendingOrder\":%I64u",
        g_pending.score,targetEq,cycleStart,firstEntryPrice,g_pending.setupId,g_pending.order));
      SetupReset("CONSUMED_BY_CAMPAIGN_LATE_FILL");
     }
   else
     {
      if(g_pending.triggerId!="") ConsumeTrigger(g_pending.triggerId);
      Emit("LAYER_OPEN",StringFormat(",\"layer\":%d,\"score\":%.2f,\"price\":%.5f,\"setupId\":\"%s\",\"lateFill\":true,\"family\":\"%s\"",
           layers,g_pending.score,lastAdd,g_pending.setupId,g_pending.family));
     }
   Emit("ORDER_FILLED_LATE",StringFormat(",\"order\":%I64u,\"layers\":%d,\"isFirstEntry\":%s",
        g_pending.order,layers,BoolJson(g_pending.isFirstEntry)));
   g_pending.active=false;
   SaveState();
  }

void ReconcilePending()
  {
   if(!g_pending.active) return;
   int n=CountPos();
   if(n>0)
     {
      PromotePendingFill();
      return;
     }
   bool orderLive=false;
   if(g_pending.order!=0)
     {
      for(int i=OrdersTotal()-1;i>=0;i--)
        {
         ulong t=OrderGetTicket(i);
         if(t==g_pending.order){orderLive=true;break;}
        }
     }
   if(orderLive) return;
   if(g_pending.order!=0 && HistoryOrderSelect(g_pending.order))
     {
      long st=HistoryOrderGetInteger(g_pending.order,ORDER_STATE);
      if(st==ORDER_STATE_FILLED||st==ORDER_STATE_PARTIAL)
        {PromotePendingFill();return;}
      if(st==ORDER_STATE_CANCELED||st==ORDER_STATE_REJECTED||st==ORDER_STATE_EXPIRED)
        {ClearPending(StringFormat("HISTORY_ORDER_STATE_%d",(int)st));return;}
     }
   // Broker has not published a terminal state. Do NOT resend. Do NOT reset the campaign.
  }

//====================== preflight (APEX-AUDIT-014/027) ================
// Reports why NEW exposure is refused. Protection/closing of already-open positions is
// never gated by this -- an existing basket is always managed.
string ComputePreflight()
  {
   if(g_observerOnly) return "OBSERVER_ONLY_SECOND_INSTANCE";
   if(g_pending.active) return "ORDER_PENDING_BROKER_CONFIRMATION";
   if(g_cloudLeaseSupported && !ManagerAllowsNewExposure(g_instanceId,g_cloudManagerId,g_cloudLeaseUntil,TimeCurrent(),g_cloudLeaseSupported,g_cloudLeaseConfirmed))
      return "CROSS_TERMINAL_LEASE_NOT_MANAGER";
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
   if(campState==CAMP_SUBMITTING) return "CAMPAIGN_SUBMITTING";
   if(campState!=CAMP_IDLE&&!anchorsKnown) return "ANCHORS_UNRECONCILED";
   return "";
  }

//====================== layer submission ==============================
// NORMAL (unchanged since v3.8.7): L1 15%, L2 50%, L3+ 100% of the CURRENT executable
// capacity established by NORMAL's trusted margin economics (or its reference leverage),
// read from the dashboard C.normal* fields.
//
// Retired for sizing: C.baseMarginPct * C.layerMultiplier^layers. Both fields remain
// parsed for config compatibility but no longer size a layer.
double LayerMarginPctFor(int filledLayers)
  {
   // APEX-AUDIT-012: these come from C.* (dashboard), seeded from the Inputs.
   if(filledLayers<=0) return MathMax(0.1,MathMin(100.0,C.normalL1MarginPct));
   if(filledLayers==1) return MathMax(0.1,MathMin(100.0,C.normalL2MarginPct));
   return MathMax(0.1,MathMin(100.0,C.normalL3PlusMarginPct));
  }
double LayerMarginPct(){return LayerMarginPctFor(layers);}

// v3.8.8 UNLIMITED state machine. ROOT CAUSE this replaces: v3.8.7 sized EVERY
// UNLIMITED layer through ComputeVolume()'s UNLIMITED branch, i.e. "pct of the broker's
// current executable capacity". On the Exness unlimited account the client margin model
// reports 0.00/lot, so LargestVolumeWithinMargin() and OrderCheck() both approve
// SYMBOL_VOLUME_MAX and that capacity is 200 lots -- so L1 = 15% x 200 = 30 lots on a
// $1,000 account. The fix is structural: L1/L2 never reach that engine at all.
//
//   filled 0 -> L1  SIMULATED_1_200       15% of simulated 1:200 capacity
//   filled 1 -> L2  SIMULATED_1_200       50% of FRESH simulated 1:200 capacity
//   filled 2 -> L3  UNLIMITED            100% of actual executable capacity
//   filled 3+-> L4+ UNLIMITED_PROFIT_FED 100% of actual executable capacity
//
// The percentages are fixed by the owner rule and deliberately NOT read from the
// dashboard's C.normal* fields, so tuning NORMAL can never re-shape UNLIMITED. Any
// profile that is not NORMAL takes this state machine, never the raw unlimited engine.
LayerSizingPlan PlanLayerSizing(const string profile,int filledLayers)
  {
   LayerSizingPlan p;
   p.profile=profile;
   p.filledLayers=(filledLayers<0?0:filledLayers);
   p.layerIndex=p.filledLayers+1;
   p.simulatedLeverage=0;
   if(profile=="NORMAL")
     {p.mode="NORMAL";p.pct=LayerMarginPctFor(p.filledLayers);return p;}
   if(p.filledLayers==0)
     {p.mode="SIMULATED_1_200";p.pct=APEX_UNL_L1_SIM200_PCT;p.simulatedLeverage=APEX_SIM_LEVERAGE;return p;}
   if(p.filledLayers==1)
     {p.mode="SIMULATED_1_200";p.pct=APEX_UNL_L2_SIM200_PCT;p.simulatedLeverage=APEX_SIM_LEVERAGE;return p;}
   p.mode=(p.filledLayers==2)?"UNLIMITED":"UNLIMITED_PROFIT_FED";
   p.pct=APEX_UNL_L3PLUS_PCT;
   return p;
  }

// The ONLY entry point that sizes a layer. The two capacity engines never mix:
// SIMULATED_1_200 -> ComputeSimulated1200Volume(); everything else -> ComputeVolume(),
// whose profile branch is NORMAL or UNLIMITED exactly as before.
SizingDecision ComputeLayerVolume(const LayerSizingPlan &plan,int dir,double price,double sl)
  {
   if(plan.mode=="SIMULATED_1_200")
     {
      SizingDecision s=ComputeSimulated1200Volume(dir,plan.pct,price,sl,0);
      s.sizingMode=plan.mode;
      return s;
     }
   SizingDecision u=ComputeVolume(dir,plan.pct,price,sl);
   u.sizingMode=plan.mode;
   u.targetVolume=u.capacity*clamp(plan.pct,.1,100)/100.0;
   return u;
  }

// After the SERVER refused `rejectedVol` for a SIZE reason: the refusal proves genuine
// executable capacity is strictly below it. The layer's plan -- engine AND percentage --
// is preserved exactly; only the capacity estimate is re-derived. Returns the next volume,
// or 0 when nothing executable remains. An L1 retry is still 15% of 1:200 capacity, an L2
// retry still 50% of 1:200 capacity; neither can become 50%, 100% or UNLIMITED.
double RederiveAfterSizeRejection(const LayerSizingPlan &plan,int dir,double price,double sl,
                                  double rejectedVol,double &trueCap)
  {
   trueCap=0;
   double capHi=FloorToStep(rejectedVol-VolStep());
   double learnedCap=ServerCapacityCeiling();
   if(learnedCap>0&&learnedCap<capHi) capHi=FloorToStep(learnedCap);
   if(capHi<=0) return 0;
   double pct=clamp(plan.pct,.1,100);
   double reSized=0;
   if(plan.mode=="SIMULATED_1_200")
     {
      // Fresh 1:200 capacity from live equity/exposure, bounded by the refusal.
      SizingDecision f=ComputeSimulated1200Volume(dir,plan.pct,price,sl,capHi);
      trueCap=f.capacity;
      reSized=f.finalVolume;
      if(reSized>rejectedVol*0.9)
        {
         SizingDecision h=ComputeSimulated1200Volume(dir,plan.pct,price,sl,FloorToStep(capHi*0.5));
         trueCap=h.capacity;
         reSized=h.finalVolume;
        }
     }
   else
     {
      trueCap=LargestVolumePassingCheck(dir,price,sl,capHi);
      if(trueCap<=0) trueCap=capHi;   // preflight is degenerate; the bound is still true
      reSized=FloorToStep(trueCap*pct/100.0);
      // At pct=100 the request IS the capacity bound, so a refusal only shaves one
      // volume step and the descent stalls (200 -> 199.99 -> 199.98 ...). When the
      // re-derived request does not make real progress, BISECT the capacity bound and
      // re-apply the SAME percentage to that. The percentage is still what is asked
      // for -- only the capacity ESTIMATE contracts geometrically, which is the one
      // thing a lying preflight leaves us free to do.
      if(reSized>rejectedVol*0.9)
        {
         double bisected=FloorToStep(trueCap*0.5);
         reSized=FloorToStep(bisected*pct/100.0);
        }
     }
   if(reSized<SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_MIN)||reSized<=0||reSized>=rejectedVol) return 0;
   return reSized;
  }

// A blocked UNLIMITED layer WAITS (the trigger is not consumed and capacity is re-derived
// on the next eligible scan). Report each distinct wait at most once a minute instead of
// on every 250 ms scan. NORMAL reporting is untouched.
string   g_sizingBlockKey="";
datetime g_sizingBlockAt=0;
bool SizingBlockReportDue(const string key)
  {
   datetime now=TimeCurrent();
   if(key==g_sizingBlockKey&&now-g_sizingBlockAt<60) return false;
   g_sizingBlockKey=key;
   g_sizingBlockAt=now;
   return true;
  }

// A rejection that is purely about SIZE. Anything else stops the descent immediately.
bool IsSizeOnlyRejection(uint rc,int mt5err)
  {
   return rc==TRADE_RETCODE_NO_MONEY||rc==TRADE_RETCODE_INVALID_VOLUME||
          rc==TRADE_RETCODE_LIMIT_VOLUME||mt5err==134/*ERR_NOT_ENOUGH_MONEY*/;
  }

bool OpenLayer(int dir,double score,string why,double invalidLevel,double refPrice,
               double atr,datetime triggerBar,bool enforceReclaim)
  {
   if(dir==0||(campDir!=0&&dir!=campDir)||(layers==0&&S.dir!=0&&dir!=S.dir))
     {
      Emit("DIRECTION_CONTRACT_BLOCK",StringFormat(",\"signalDir\":%d,\"campaignDir\":%d,\"setupDir\":%d,\"reason\":\"OPEN_LAYER_DIRECTION_MISMATCH\",\"why\":\"%s\"",dir,campDir,S.dir,why));
      Print("APEX DIRECTION CONTRACT BLOCK | OpenLayer dir=",dir," camp=",campDir," setup=",S.dir," why=",why);
      return false;
     }
   g_preflightBlock=ComputePreflight();
   if(g_preflightBlock!="")
     {Emit("ENTRY_BLOCKED",StringFormat(",\"reason\":\"%s\",\"stage\":\"PREFLIGHT\",\"why\":\"%s\"",g_preflightBlock,why));return false;}

   // v3.8.8: the engine and percentage come from the BROKER-CONFIRMED layer count.
   LayerSizingPlan plan=PlanLayerSizing(ExecutionProfile(),layers);
   double pct=plan.pct;
   int layerIndex=plan.layerIndex;
   bool firstNormal=(ExecutionProfile()=="NORMAL"&&layers==0);
   int digits=(int)SymbolInfoInteger(_Symbol,SYMBOL_DIGITS);

   // FINAL executable-price eligibility, immediately before sizing and submission.
   Gate g;
   ulong decidedAt=GetTickCount64();
   if(!FinalEntryGate(dir,invalidLevel,refPrice,atr,triggerBar,enforceReclaim,g))
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

   SizingDecision d=ComputeLayerVolume(plan,dir,g.price,sl);
   bool sizingBlocked=(d.finalVolume<=0);
   bool reportSizing=(plan.mode=="NORMAL"||!sizingBlocked||
                      SizingBlockReportDue(StringFormat("%d|%s|%s",layerIndex,plan.mode,d.blockReason)));
   if(reportSizing) PrintLayerSizing(plan,d,dir);
   if(sizingBlocked)
     {
      if(reportSizing)
        {
         if(plan.mode!="NORMAL")
            PrintFormat("APEX SIZING WAIT | profile=%s layer=%d mode=%s capacity=%.2f percentage=%.0f%% reason=%s"
                        " | trigger NOT consumed; capacity is re-derived on the next eligible scan",
                        plan.profile,layerIndex,plan.mode,d.capacity,pct,
                        d.blockReason==""?"NO_EXECUTABLE_VOLUME":d.blockReason);
         Emit("ADD_BLOCKED",StringFormat(",\"reason\":\"%s\",\"stage\":\"SIZING\",\"why\":\"%s\"%s",
              d.blockReason==""?"NO_EXECUTABLE_VOLUME":d.blockReason,why,SizingJson(d,layerIndex)));
        }
      return false;
     }
   g_sizingBlockKey="";

   double vol=d.finalVolume;
   string com=StringFormat("APEX L%d %.0f",layerIndex,score);
   ExecResult e;
   int attempt=0;
   ulong submittedAt=0,settledAt=0;
   while(true)
     {
      // Re-validate the executable price before EVERY submission attempt.
      if(attempt>0&&!FinalEntryGate(dir,invalidLevel,refPrice,atr,triggerBar,enforceReclaim,g))
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

      // v3.8.7 OWNER RULE, now applied to BOTH profiles: the requested PERCENTAGE must
      // survive capacity rediscovery. The pre-v3.8.7 UNLIMITED branch halved the volume
      // (vol*0.5) until something filled, which silently redefined the ladder -- a 15%
      // L1 of a believed 200 lots became 30 -> 15 -> fill, and 15 lots is not 15% of the
      // capacity that actually existed. Instead: the server has just proven that `vol`
      // is NOT executable, so genuine capacity is strictly below it. Re-derive the best
      // capacity the evidence supports and re-apply the SAME percentage.
      Emit("SIZING_MODEL_REJECTED",StringFormat(
         ",\"attempt\":%d,\"rejectedVolume\":%.4f,\"retcode\":%d,\"mt5Error\":%d,\"profile\":\"%s\",\"why\":\"%s\"%s",
         attempt+1,vol,e.retcode,e.mt5Error,ExecutionProfile(),why,SizingJson(d,layerIndex)));
      PrintFormat("APEX SIZING REJECTED | profile=%s layer=%d mode=%s attempt=%d rejected=%.4f retcode=%d mt5Error=%d reason=%s",
                  plan.profile,layerIndex,plan.mode,attempt+1,vol,e.retcode,e.mt5Error,e.detail);
      if(attempt>=MathMax(1,InpMaxSizingAttempts)-1) break;
      // Same plan (engine + percentage); only the capacity estimate is re-derived,
      // strictly below the refused volume and never above server-proven evidence.
      double trueCap=0;
      double reSized=RederiveAfterSizeRejection(plan,dir,g.price,sl,vol,trueCap);
      if(reSized<=0)
        {
         PrintFormat("APEX SIZING ABORTED | profile=%s layer=%d mode=%s | %.2f%% of re-derived capacity %.4f is not executable",
                     plan.profile,layerIndex,plan.mode,pct,trueCap);
         break;
        }
      PrintFormat("APEX CAPACITY RE-DERIVED | profile=%s layer=%d mode=%s rejected=%.4f -> trueCapacity=%.4f -> %.2f%% = %.4f",
                  plan.profile,layerIndex,plan.mode,vol,trueCap,pct,reSized);
      Emit("SIZING_CAPACITY_REDERIVED",StringFormat(
         ",\"attempt\":%d,\"rejectedVolume\":%.4f,\"trueCapacity\":%.4f,\"marginPct\":%.2f,"
         "\"nextVolume\":%.4f,\"profile\":\"%s\",\"layerIndex\":%d,\"sizingMode\":\"%s\",\"why\":\"%s\"",
         attempt+1,vol,trueCap,pct,reSized,ExecutionProfile(),layerIndex,plan.mode,why));
      vol=reSized;
      attempt++;
     }
   if(attempt>0)
      PrintFormat("APEX SIZING RETRY RESULT | profile=%s layer=%d mode=%s percentage=%.0f%% attempts=%d lastVolume=%.4f"
                  " filled=%.4f class=%s retcode=%d",
                  plan.profile,layerIndex,plan.mode,pct,attempt+1,vol,e.filledVolume,
                  (e.cls==EXEC_FILLED?"FILLED":e.cls==EXEC_PARTIAL?"PARTIAL":e.cls==EXEC_PENDING?"PENDING":
                   e.cls==EXEC_REJECTED?"REJECTED":"UNCONFIRMED"),e.retcode);

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

   if(e.cls==EXEC_PENDING || ClassifyBrokerSubmit(e.retcode,e.filledVolume>1e-9)==2)
     {
      g_pending.active=true;
      g_pending.isFirstEntry=(campState==CAMP_IDLE||campState==CAMP_SUBMITTING||layers==0);
      g_pending.order=e.order;
      g_pending.dir=dir;
      g_pending.requestedVolume=e.requestedVolume;
      g_pending.sl=sl;
      g_pending.score=score;
      g_pending.invalidLevel=invalidLevel;
      g_pending.refPrice=refPrice;
      g_pending.atr=atr;
      g_pending.why=why;
      g_pending.setupId=S.id;
      g_pending.family="";
      g_pending.triggerId="";
      g_pending.submittedAt=TimeCurrent();
      g_pending.triggerBar=triggerBar;
      g_pending.enforceReclaim=enforceReclaim;
      Emit("ORDER_PENDING",execExtra);
      SaveState();
      Print("APEX ORDER PLACED PENDING BROKER CONFIRMATION | order=",e.order," | setup=",S.id," | will NOT resend");
      return false;
     }

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
            // sent=true means the request was accepted for sending, not that the position is gone.
            if(rc==TRADE_RETCODE_DONE||rc==TRADE_RETCODE_DONE_PARTIAL) ResetMarketClosedBackoff();
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
   // Direction contract: analysis, setup and execution must all name the same side.
   // If this invariant is ever false, fail closed instead of submitting an opposite trade.
   if(s.dir==0||s.directionBias==0||s.dir!=s.directionBias||s.freshDirection!=s.dir)
     {
      Emit("DIRECTION_CONTRACT_BLOCK",StringFormat(",\"signalDir\":%d,\"authorityDir\":%d,\"freshDir\":%d,\"reason\":\"START_DIRECTION_MISMATCH\"",s.dir,s.directionBias,s.freshDirection));
      Print("APEX DIRECTION CONTRACT BLOCK | signal=",s.dir," authority=",s.directionBias," fresh=",s.freshDirection);
      return;
     }
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
   if(!OpenLayer(campDir,s.score,s.setupFamily+"_L1_CLOSED_CONFIRMATION",S.extreme,S.triggerPrice,s.atr,S.triggerBarTime,true))
     {
      if(g_pending.active)
        {
         campState=CAMP_SUBMITTING;
         SaveState();
         Print("APEX FIRST ENTRY PENDING | campaign fenced as SUBMITTING | setup=",S.id," order=",g_pending.order);
         return;
        }
      campState=CAMP_IDLE;campId="";campSig="";campDir=0;
      ClearState();
      return;
     }
   campState=CAMP_ACTIVE;
   S.state=SETUP_CONSUMED;
   SaveState();
   Emit("CAMPAIGN_START",StringFormat(
     ",\"score\":%.2f,\"scoreCalibration\":\"COMPOSITE_RANKING_NOT_PROBABILITY\",\"targetEquity\":%.2f,\"cycleStart\":%.2f,\"entryPrice\":%.5f,"
     "\"atr\":%.5f,\"setupId\":\"%s\",\"setupFamily\":\"%s\",\"regime\":\"%s\",\"buyPressure\":%.2f,\"sellPressure\":%.2f,\"activePressure\":%.2f,"
     "\"trendStrength\":%.2f,\"candleQuality\":%.2f,\"compressionScore\":%.2f,\"pullbackQuality\":%.2f,\"triggerKind\":\"%s\",\"invalidationLevel\":%.5f,\"triggerPrice\":%.5f,\"triggerBarTime\":%I64d",
     s.score,targetEq,cycleStart,firstEntryPrice,s.atr,S.id,s.setupFamily,s.regime,s.buyPressure,s.sellPressure,s.activePressure,s.trendStrength,s.candleQuality,s.compressionScore,s.pullbackQuality,s.triggerKind,S.extreme,S.triggerPrice,(long)S.triggerBarTime));
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
   AddCandidate a;a.addEligible=false;a.family="NONE";a.score=0;a.atr=ATR();a.reason="NO_NEW_CONFIRMATION";a.triggerId="";a.triggerBarTime=0;a.dir=campDir;
   if(a.atr<=0)return a;MqlRates m1[],m5[],m15[],m30[];if(!Rates(PERIOD_M1,30,m1)||!Rates(PERIOD_M5,60,m5)||!Rates(PERIOD_M15,50,m15)||!Rates(PERIOD_M30,50,m30)){a.reason="NO_CONFIRMATION_HISTORY";return a;}
   datetime bar=m1[1].time;a.triggerBarTime=bar;if(bar<=campStart){a.reason="WAIT_NEW_CLOSED_BAR_AFTER_L1";return a;}
   double buy=50,sell=50,velocity=0;CalculatePressure(m1,a.atr,buy,sell,velocity);DirectionAuthority da=EvaluateDirectionAuthority(m5,m15,m30,a.atr,buy,sell);
   if(da.transition||da.dir!=campDir||da.tier<2||da.freshDir!=campDir||da.freshTier<2){a.reason="FRESH_DIRECTION_NO_LONGER_CONFIRMS_CAMPAIGN";return a;}
   double pressure=campDir>0?buy:sell,opp=campDir>0?sell:buy,cq=DirectionalCandleQuality(m1[1],campDir,a.atr);
   bool closeBreak=campDir>0?m1[1].close>m1[2].high:m1[1].close<m1[2].low;bool continuation=campDir>0?(m1[1].close>m1[1].open&&m1[1].close>m1[2].close):(m1[1].close<m1[1].open&&m1[1].close<m1[2].close);
   bool m5Aligned=campDir>0?m5[1].close>=m5[2].close:m5[1].close<=m5[2].close;double pressureMin=layers<=1?C.trendPressureMin:C.breakoutPressureMin;bool structure=layers<=1?(closeBreak&&continuation):(closeBreak&&m5Aligned);
   if(!structure){a.reason=layers<=1?"WAIT_L2_STRUCTURE_CONFIRM":"WAIT_L3_EXPANSION";return a;}if(pressure<pressureMin||pressure-opp<8){a.reason="WAIT_ADD_PRESSURE";return a;}if(cq<55){a.reason="WAIT_ADD_CANDLE_QUALITY";return a;}
   a.family=layers<=1?"L2_CONFIRMATION":"L3_EXPANSION";a.score=clamp(10+pressure*.25+cq*.22+MathMin(28.0,MathAbs(da.scoreGap)*.40)+(closeBreak?15:0)+(m5Aligned?10:0),0,100);a.reason=a.family;
   a.triggerId=StringFormat("CONFIRM|%s|%I64d",campId,(long)bar);a.addEligible=true;return a;
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
   if(campState==CAMP_SUBMITTING)
     {
      ReconcilePending();
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

   bool enforceReclaim=false;
   double invalidLevel=0;
   double refPrice=0;
   datetime trigBar=a.triggerBarTime;

   if(OpenLayer(campDir,a.score,a.reason,invalidLevel,refPrice,a.atr,trigBar,enforceReclaim))
     {
      ConsumeTrigger(a.triggerId);
      SaveState();
      Emit("ADD_TRIGGER_CONSUMED",StringFormat(",\"triggerId\":\"%s\",\"family\":\"%s\",\"score\":%.2f",
           a.triggerId,a.family,a.score));
     }
   else if(g_pending.active)
     {
      g_pending.family=a.family;
      g_pending.triggerId=a.triggerId;
      g_pending.isFirstEntry=false;
      SaveState();
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

   if(campState==CAMP_SUBMITTING)
     {
      if(n>0){PromotePendingFill();return;}
      ReconcilePending();
      Emit("CAMPAIGN_RECOVERED",StringFormat(",\"source\":\"STATE_FILE\",\"campaignState\":\"SUBMITTING\",\"pendingOrder\":%I64u,\"positions\":%d",
           g_pending.order,n));
      return;
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
      " | campaignState=",CampStateName(),
      " | observerOnly=",g_observerOnly?"true":"false",
      " | profile=",ExecutionProfile(),
      " | accountTradeAllowed=",(bool)AccountInfoInteger(ACCOUNT_TRADE_ALLOWED)?"true":"false",
      " | accountExpertAllowed=",(bool)AccountInfoInteger(ACCOUNT_TRADE_EXPERT)?"true":"false",
      " | preflight=",(g_preflightBlock==""?"OK":g_preflightBlock),
      " | strategy=CONFIRMED_DIRECTION_BREAKOUT_TREND | entry=closed-confirmation-v3.9.3");
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

void ServiceEntryScan()
  {
   static ulong lastScanMs=0;ulong nowMs=GetTickCount64();if(lastScanMs>0&&nowMs-lastScanMs<75)return;lastScanMs=nowMs;
   if(g_observerOnly||campState!=CAMP_IDLE||!C.armed)return;datetime now=TimeCurrent();if(lastEnd>0&&now-lastEnd<C.cooldownMinutes*60)return;
   g_preflightBlock=ComputePreflight();if(g_preflightBlock!="")return;Snap s=Observe();if(s.valid)Start(s);
  }
void OnTick(){UpdateTickPressure();ServiceEntryScan();}

// APEX-AUDIT-002: risk first, signal scan second, telemetry/cloud last. No network call sits between
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
      if(g_pending.active) ReconcilePending();
      if(campState==CAMP_IDLE&&CountPos()>0) ReconcileAgainstBroker();
      Manage();
     }

   // 2. Local signal scan before network work; MQL event handlers are serialized and campState fences duplicate entry.
   ServiceEntryScan();

   // 3. Telemetry OR cloud, never both on the same tick, never before Manage/signal scan.
   ulong t0=GetTickCount64();
   bool cloudDue=(now-lastCfg>=InpConfigPollSeconds);
   if(cloudDue){CloudSync();lastCfg=now;}
   else FlushEventQueue();
   ulong used=GetTickCount64()-t0;
   if(used>(ulong)MathMax(400,InpCloudTickBudgetMs))
      Print("APEX CLOUD TICK BUDGET | usedMs=",used," cloudDue=",cloudDue?"true":"false");

  }
