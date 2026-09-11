// Minimal MT5 shim so the REAL MQL5 source text of the sizing / entry-gate functions
// can be compiled and executed against a scripted mock broker. Nothing here is a
// re-implementation of Apex logic -- the functions under test are extracted verbatim
// from the .mq5 files by tests/native/extract.mjs.
#pragma once
#include <string>
#include <cstdio>
#include <cstring>
#include <cmath>
#include <cstdint>
#include <cctype>
#include <algorithm>
#include <vector>

typedef unsigned int   uint;
typedef unsigned long  ulong;          // 64-bit on LP64, matches MQL5 ulong
typedef unsigned short ushort;
typedef long           datetime;       // MQL5 datetime is a 64-bit integer
typedef std::string    string;

// ---- enums -------------------------------------------------------------
enum ENUM_ORDER_TYPE { ORDER_TYPE_BUY=0, ORDER_TYPE_SELL=1, ORDER_TYPE_BUY_LIMIT=2, ORDER_TYPE_SELL_LIMIT=3,
                       ORDER_TYPE_BUY_STOP=4, ORDER_TYPE_SELL_STOP=5, ORDER_TYPE_BUY_STOP_LIMIT=6,
                       ORDER_TYPE_SELL_STOP_LIMIT=7 };
enum ENUM_SYMBOL_CALC_MODE { SYMBOL_CALC_MODE_FOREX=0, SYMBOL_CALC_MODE_FUTURES=1, SYMBOL_CALC_MODE_CFD=2,
                             SYMBOL_CALC_MODE_CFDINDEX=3, SYMBOL_CALC_MODE_CFDLEVERAGE=4,
                             SYMBOL_CALC_MODE_FOREX_NO_LEVERAGE=5 };
enum ENUM_POSITION_TYPE { POSITION_TYPE_BUY=0, POSITION_TYPE_SELL=1 };
enum ENUM_POSITION_PROPERTY_STRING { POSITION_SYMBOL };
enum ENUM_POSITION_PROPERTY_DOUBLE { POSITION_VOLUME };
enum ENUM_POSITION_PROPERTY_INTEGER { POSITION_TYPE, POSITION_MAGIC };
enum ENUM_ORDER_PROPERTY_STRING { ORDER_SYMBOL };
enum ENUM_ORDER_PROPERTY_DOUBLE { ORDER_VOLUME_CURRENT };
enum ENUM_ORDER_PROPERTY_INTEGER { ORDER_TYPE };
enum ENUM_TRADE_REQUEST_ACTIONS { TRADE_ACTION_DEAL=1 };
enum ENUM_ORDER_TYPE_FILLING { ORDER_FILLING_FOK=0, ORDER_FILLING_IOC=1, ORDER_FILLING_RETURN=2 };
enum ENUM_SYMBOL_INFO_DOUBLE { SYMBOL_VOLUME_MIN, SYMBOL_VOLUME_MAX, SYMBOL_VOLUME_STEP,
                               SYMBOL_POINT, SYMBOL_TRADE_CONTRACT_SIZE, SYMBOL_ASK, SYMBOL_BID,
                               SYMBOL_MARGIN_INITIAL, SYMBOL_VOLUME_LIMIT, SYMBOL_TRADE_TICK_VALUE,
                               SYMBOL_TRADE_TICK_SIZE };
enum ENUM_SYMBOL_INFO_INTEGER { SYMBOL_DIGITS, SYMBOL_TRADE_MODE, SYMBOL_FILLING_MODE, SYMBOL_TRADE_EXEMODE,
                                SYMBOL_TRADE_CALC_MODE };
enum ENUM_SYMBOL_INFO_STRING { SYMBOL_CURRENCY_PROFIT, SYMBOL_CURRENCY_MARGIN, SYMBOL_CURRENCY_BASE };
enum ENUM_ACCOUNT_INFO_STRING { ACCOUNT_CURRENCY, ACCOUNT_COMPANY, ACCOUNT_SERVER };
enum ENUM_SYMBOL_TRADE_EXECUTION { SYMBOL_TRADE_EXECUTION_REQUEST=0, SYMBOL_TRADE_EXECUTION_INSTANT=1,
                                   SYMBOL_TRADE_EXECUTION_MARKET=2, SYMBOL_TRADE_EXECUTION_EXCHANGE=3 };
#define SYMBOL_FILLING_FOK 1
#define SYMBOL_FILLING_IOC 2
enum ENUM_ACCOUNT_INFO_DOUBLE { ACCOUNT_MARGIN_FREE, ACCOUNT_EQUITY, ACCOUNT_MARGIN,
                                ACCOUNT_BALANCE, ACCOUNT_MARGIN_LEVEL };
enum ENUM_ACCOUNT_INFO_INTEGER { ACCOUNT_LOGIN, ACCOUNT_LEVERAGE, ACCOUNT_MARGIN_MODE, ACCOUNT_TRADE_MODE };
enum ENUM_TIMEFRAMES { PERIOD_M1=1, PERIOD_M3=3, PERIOD_M5=5 };
#define TRADE_RETCODE_DONE            10009
#define TRADE_RETCODE_PLACED          10008
#define TRADE_RETCODE_DONE_PARTIAL    10010
#define TRADE_RETCODE_NO_MONEY        10019
#define TRADE_RETCODE_INVALID_VOLUME  10014
// Real MQL5 values. LIMIT_VOLUME was previously 10018 here, which collided with
// MARKET_CLOSED and would have made a market-closed reply look like a size rejection.
#define TRADE_RETCODE_MARKET_CLOSED   10018
#define TRADE_RETCODE_LIMIT_VOLUME    10024
#define TRADE_RETCODE_INVALID_FILL    10030
#define DBL_MAX 1.7976931348623158e+308

// ---- structs -----------------------------------------------------------
struct MqlTick { datetime time; double bid, ask, last; ulong volume; long time_msc; uint flags; };
struct MqlRates { datetime time; double open, high, low, close; long tick_volume; int spread; long real_volume; };
struct MqlTradeRequest { int action; ulong magic; std::string symbol; double volume, price, sl, tp;
                         int type; int type_filling; int deviation; };
struct MqlTradeCheckResult { uint retcode; double balance, equity, profit, margin, margin_free, margin_level;
                             std::string comment; };
template<class T> void ZeroMemory(T &x){ memset((void*)&x,0,sizeof(T)); }
inline void ZeroMemory(MqlTradeRequest &r){ r.action=0;r.magic=0;r.symbol.clear();r.volume=r.price=r.sl=r.tp=0;
                                            r.type=0;r.type_filling=0;r.deviation=0; }
inline void ZeroMemory(MqlTradeCheckResult &r){ r.retcode=0;r.balance=r.equity=r.profit=r.margin=r.margin_free=r.margin_level=0;r.comment.clear(); }

// ---- scripted mock broker ---------------------------------------------
struct MockPos   { std::string symbol; long magic; int type; double volume; double open; };
struct MockOrder { std::string symbol; int type; double volume; };
struct MockBroker {
  double volMin=0.01, volMax=200.0, volStep=0.01;
  int    digits=3;
  double bid=4401.0, ask=4401.10, point=0.001;
  long   quoteMsc=0;
  double freeMargin=1000.0, equity=1000.0, usedMargin=0.0, balance=1000.0;
  long  leverage=500, login=476885386;
  // What OrderCalcMargin/OrderCheck (the CLIENT model) reports per lot.
  double marginPerLot=0.0;
  // What the broker SERVER actually charges per lot. <0 means "same as the client model".
  // A positive value with marginPerLot=0 models the Exness-style divergence where the
  // terminal believes gold is margin-free but the server still charges for it.
  double serverMarginPerLot=-1.0;
  // OrderCheck fidelity: does the client-side check see the tiered requirement?
  bool   orderCheckSeesServerTruth=false;
  double basketVolume=0.0;
  // v3.8.8 simulated-1:200 inputs: contract specification + open exposure.
  double contract=100.0;
  double tickSize=0.001, tickValue=0.1;     // 0.001 * 100oz = $0.10 per tick per lot
  int    calcMode=SYMBOL_CALC_MODE_CFDLEVERAGE;
  double marginRateInit=1.0; bool marginRateOk=true;
  double volLimit=0.0;                      // SYMBOL_VOLUME_LIMIT, 0 = none
  std::vector<MockPos>   positions;         // every open position on the account
  std::vector<MockOrder> orders;            // every pending order on the account
  int    selPos=-1, selOrd=-1;
  // v3.8.2 CapacityTruth inputs: the independent margin cross-checks.
  double marginInitial=0.0;                 // SYMBOL_MARGIN_INITIAL (0 = broker publishes none)
  std::string accountCurrency="USD", profitCurrency="USD", marginCurrency="USD";
  long   fillingMode=SYMBOL_FILLING_FOK;
  int    execMode=SYMBOL_TRADE_EXECUTION_MARKET;
  datetime now=1000000;
  datetime lastClosedM1=1000000;
  double atr=2.0;
  std::vector<MqlRates> m1, m3, m5;
  // execution log
  std::vector<double> submitted;
  std::vector<uint>   retcodes;
  // client-side margin (what OrderCalcMargin returns)
  double clientMargin(double vol) const { return marginPerLot*vol; }
  // server-side margin (what the broker really charges)
  double serverMargin(double vol) const {
    return (serverMarginPerLot>=0 ? serverMarginPerLot : marginPerLot) * vol;
  }
};
extern MockBroker BRK;

// ---- MT5 API -----------------------------------------------------------
#define _Symbol std::string("XAUUSDm")
#define _Point  BRK.point

inline double SymbolInfoDouble(const std::string&, ENUM_SYMBOL_INFO_DOUBLE p){
  switch(p){ case SYMBOL_VOLUME_MIN: return BRK.volMin; case SYMBOL_VOLUME_MAX: return BRK.volMax;
             case SYMBOL_VOLUME_STEP: return BRK.volStep; case SYMBOL_POINT: return BRK.point;
             case SYMBOL_TRADE_CONTRACT_SIZE: return BRK.contract;
             case SYMBOL_VOLUME_LIMIT: return BRK.volLimit;
             case SYMBOL_TRADE_TICK_VALUE: return BRK.tickValue;
             case SYMBOL_TRADE_TICK_SIZE: return BRK.tickSize;
             case SYMBOL_MARGIN_INITIAL: return BRK.marginInitial;
             case SYMBOL_ASK: return BRK.ask; case SYMBOL_BID: return BRK.bid; }
  return 0;
}
inline long SymbolInfoInteger(const std::string&, ENUM_SYMBOL_INFO_INTEGER p){
  if(p==SYMBOL_DIGITS) return BRK.digits;
  if(p==SYMBOL_FILLING_MODE) return BRK.fillingMode;
  if(p==SYMBOL_TRADE_EXEMODE) return BRK.execMode;
  if(p==SYMBOL_TRADE_CALC_MODE) return BRK.calcMode;
  return 0;
}
inline std::string SymbolInfoString(const std::string&, ENUM_SYMBOL_INFO_STRING p){
  if(p==SYMBOL_CURRENCY_PROFIT) return BRK.profitCurrency;
  if(p==SYMBOL_CURRENCY_MARGIN) return BRK.marginCurrency;
  return std::string("USD");
}
inline std::string AccountInfoString(ENUM_ACCOUNT_INFO_STRING p){
  if(p==ACCOUNT_CURRENCY) return BRK.accountCurrency;
  return std::string("MOCK");
}
inline bool SymbolInfoTick(const std::string&, MqlTick &t){
  t.bid=BRK.bid; t.ask=BRK.ask; t.time=BRK.now; t.time_msc=BRK.quoteMsc?BRK.quoteMsc:(long)BRK.now*1000;
  t.last=BRK.bid; t.volume=1; t.flags=0;
  return BRK.bid>0 && BRK.ask>0;
}
inline double AccountInfoDouble(ENUM_ACCOUNT_INFO_DOUBLE p){
  switch(p){ case ACCOUNT_MARGIN_FREE: return BRK.freeMargin; case ACCOUNT_EQUITY: return BRK.equity;
             case ACCOUNT_MARGIN: return BRK.usedMargin; case ACCOUNT_BALANCE: return BRK.balance;
             case ACCOUNT_MARGIN_LEVEL: return BRK.usedMargin>0?BRK.equity/BRK.usedMargin*100.0:0; }
  return 0;
}
inline long AccountInfoInteger(ENUM_ACCOUNT_INFO_INTEGER p){
  if(p==ACCOUNT_LEVERAGE) return BRK.leverage;
  if(p==ACCOUNT_LOGIN) return BRK.login;
  return 0;
}
inline bool OrderCalcMargin(ENUM_ORDER_TYPE, const std::string&, double vol, double, double &m){
  m = BRK.clientMargin(vol);
  return true;
}
inline double MockDirectionalExposure(int type){
  double v=0;
  for(auto &p:BRK.positions) if(p.symbol=="XAUUSDm"&&p.type==type) v+=p.volume;
  for(auto &o:BRK.orders) if(o.symbol=="XAUUSDm"&&(o.type%2)==type) v+=o.volume;
  return v;
}
inline bool OrderCheck(const MqlTradeRequest &rq, MqlTradeCheckResult &cr){
  ZeroMemory(cr);
  if(rq.volume < BRK.volMin - 1e-9 || rq.volume > BRK.volMax + 1e-9){ cr.retcode=TRADE_RETCODE_INVALID_VOLUME; return false; }
  if(BRK.volLimit>0 && MockDirectionalExposure(rq.type)+rq.volume > BRK.volLimit + 1e-9){ cr.retcode=TRADE_RETCODE_LIMIT_VOLUME; return false; }
  double need = BRK.orderCheckSeesServerTruth ? BRK.serverMargin(rq.volume) : BRK.clientMargin(rq.volume);
  cr.margin=need; cr.margin_free=BRK.freeMargin-need;
  if(need > BRK.freeMargin + 1e-9){ cr.retcode=TRADE_RETCODE_NO_MONEY; return false; }
  cr.retcode=TRADE_RETCODE_DONE;
  return true;
}
inline bool SymbolInfoMarginRate(const std::string&, ENUM_ORDER_TYPE, double &init, double &maint){
  init=BRK.marginRateInit; maint=BRK.marginRateInit;
  return BRK.marginRateOk;
}
// Positions / orders: the selection model mirrors MQL5 (GetTicket selects).
inline int   PositionsTotal(){ return (int)BRK.positions.size(); }
inline ulong PositionGetTicket(int i){ if(i<0||i>=(int)BRK.positions.size()) return 0; BRK.selPos=i; return (ulong)(i+1); }
inline std::string PositionGetString(ENUM_POSITION_PROPERTY_STRING){ return BRK.selPos>=0?BRK.positions[BRK.selPos].symbol:std::string(); }
inline double PositionGetDouble(ENUM_POSITION_PROPERTY_DOUBLE){ return BRK.selPos>=0?BRK.positions[BRK.selPos].volume:0; }
inline long  PositionGetInteger(ENUM_POSITION_PROPERTY_INTEGER p){
  if(BRK.selPos<0) return 0;
  return p==POSITION_TYPE?(long)BRK.positions[BRK.selPos].type:BRK.positions[BRK.selPos].magic;
}
inline int   OrdersTotal(){ return (int)BRK.orders.size(); }
inline ulong OrderGetTicket(int i){ if(i<0||i>=(int)BRK.orders.size()) return 0; BRK.selOrd=i; return (ulong)(1000+i); }
inline std::string OrderGetString(ENUM_ORDER_PROPERTY_STRING){ return BRK.selOrd>=0?BRK.orders[BRK.selOrd].symbol:std::string(); }
inline double OrderGetDouble(ENUM_ORDER_PROPERTY_DOUBLE){ return BRK.selOrd>=0?BRK.orders[BRK.selOrd].volume:0; }
inline long  OrderGetInteger(ENUM_ORDER_PROPERTY_INTEGER){ return BRK.selOrd>=0?(long)BRK.orders[BRK.selOrd].type:0; }
inline datetime TimeCurrent(){ return BRK.now; }
inline ulong GetTickCount64(){ return (ulong)BRK.now*1000; }
inline datetime iTime(const std::string&, ENUM_TIMEFRAMES, int shift){ return shift==1?BRK.lastClosedM1:BRK.lastClosedM1-60; }
inline double NormalizeDouble(double v,int d){ double f=std::pow(10.0,d); return std::floor(v*f+0.5)/f; }
inline double MathFloor(double v){ return std::floor(v); }
inline double MathRound(double v){ return std::floor(v+0.5); }
inline double MathMax(double a,double b){ return a>b?a:b; }
inline double MathMin(double a,double b){ return a<b?a:b; }
inline double MathAbs(double a){ return a<0?-a:a; }
inline double MathPow(double a,double b){ return std::pow(a,b); }
inline bool   MathIsValidNumber(double v){ return !std::isnan(v) && !std::isinf(v); }
inline int    MathRand(){ return 42; }
inline void   Print(const std::string&){}
template<typename... A> inline void PrintFormat(const char*, A...){}
template<typename... A> inline std::string StringFormat(const char *fmt, A... a){
  char buf[4096]; snprintf(buf,sizeof(buf),fmt,a...); return std::string(buf);
}
inline std::string StringFormat(const char *fmt){ return std::string(fmt); }
inline std::string BoolJson(bool v){ return v?"true":"false"; }
inline double clamp(double x,double a,double b){ return MathMax(a,MathMin(b,x)); }
inline int StringLen(const string& s){ return (int)s.size(); }
inline ushort StringGetCharacter(const string& s,int i){ return i>=0&&i<(int)s.size()?(ushort)(unsigned char)s[i]:0; }
inline string IntegerToString(int v){ return std::to_string(v); }
inline string IntegerToString(long v){ return std::to_string((long long)v); }
inline uint GetTickCount(){ return (uint)BRK.now; }
inline void Emit(const string&, const string& extra=""){}
inline double ATR(){ return BRK.atr>0?BRK.atr:2.0; }
template<class T> inline int ArraySize(const std::vector<T>& v){ return (int)v.size(); }
inline bool Rates(ENUM_TIMEFRAMES tf,int n,std::vector<MqlRates> &r){
  if(tf==PERIOD_M1) r=BRK.m1;
  else if(tf==PERIOD_M3) r=BRK.m3;
  else r=BRK.m5;
  return (int)r.size()>=n-2;
}

enum SetupState { SETUP_NONE=0, SETUP_WATCHING=1, SETUP_CONFIRMED=2, SETUP_INVALIDATED=3, SETUP_EXPIRED=4, SETUP_CONSUMED=5 };
enum CampState { CAMP_IDLE=0, CAMP_ACTIVE=1, CAMP_CLOSING=2, CAMP_SUBMITTING=3 };
enum ApexBosMode { BOS_V371_CLOSE_OR_WICK=0, BOS_CLOSE_BREAK_ONLY=1 };

// ---- Apex globals the extracted functions reference ---------------------
struct ApexConfig { std::string accountProfile="NORMAL";
                    double marginReservePct=0, maxBasketLots=0, minMarginLevelPct=0,
                           normalL1MarginPct=15, normalL2MarginPct=50, normalL3PlusMarginPct=100,
                           baseMarginPct=100, layerMultiplier=2;
                    long normalReferenceLeverage=0;
                    double entryScore=76, addScore=70, impulseAtr=1.8, sweepAtr=0.05,
                           addSpacingAtr=0.22, rejectionZoneAtr=0.12, learnEntryAdj=0, learnAddAdj=0;
                    int rejectionBars=5, watchExpiryMinutes=12;
                    bool requireM3Confirm=false, requireM5Context=false, learningEnabled=false; };
extern ApexConfig C;
extern long InpMagic;
extern int   InpMaxQuoteAgeMs;
extern bool  InpRequireFreshTrigger;
extern bool  InpRejectReclaimedExtreme;
extern double InpMaxEntryExtensionAtr;
enum ApexGateMode { GATE_SHADOW=0, GATE_ENFORCE=1 };
extern ApexGateMode InpEntryExtensionMode;
extern ApexBosMode InpBosMode;
extern bool InpRequireFreshM3;
inline double BasketVolume(){ return BRK.basketVolume; }

// Market-closed backoff state used verbatim by NoteMarketClosed/MarketClosedBackoffActive.
extern datetime g_marketClosedRetryAt;
extern int      g_marketClosedBackoffSec;
// Server-proven executable capacity evidence (v3.8.2).
extern double g_serverRejectedVolume, g_serverFilledVolume, g_serverEvidenceFreeMargin;
inline double MathRound(double v);

// The EA resolves this from campaign-scoped vs desired policy; in the harness the
// scenario sets C.accountProfile directly and the campaign is always idle. Normalisation
// mirrors the EA so a lowercase profile cannot silently select the aggressive path.
inline std::string ExecutionProfile(){
  std::string p=C.accountProfile;
  for(auto &ch:p) ch=(char)std::toupper((unsigned char)ch);
  return p;
}
