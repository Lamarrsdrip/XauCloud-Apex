// Included only by the generated v6.29.1 evidence observer.
input string InpApexEvidenceId = "";  // SHA-256(Apex license + "|" + demo account)
input bool InpApexReplayEvidence = false;

bool Apex4ObserverAllowed()
{
   return (bool)MQLInfoInteger(MQL_TESTER) || AccountInfoInteger(ACCOUNT_TRADE_MODE) == ACCOUNT_TRADE_MODE_DEMO;
}

bool Apex4EvidenceIdValid()
{
   if(StringLen(InpApexEvidenceId) != 64) return false;
   for(int i = 0; i < 64; ++i)
   {
      ushort c = StringGetCharacter(InpApexEvidenceId, i);
      if(!((c >= 'a' && c <= 'f') || (c >= '0' && c <= '9'))) return false;
   }
   return true;
}

// These stand in for CTrade and the native send APIs. No network or broker
// mutating API exists in this adapter, even with MT5 algo trading enabled.
class Apex4ObserverTrade
{
public:
   bool Buy(double volume, string symbol, double price, double sl, double tp, string text) { return false; }
   bool Sell(double volume, string symbol, double price, double sl, double tp, string text) { return false; }
   bool PositionClose(ulong ticket) { return false; }
   bool PositionClosePartial(ulong ticket, double volume) { return false; }
   bool PositionModify(ulong ticket, double sl, double tp) { return false; }
   ulong ResultDeal() { return 0; }
   ulong ResultOrder() { return 0; }
   double ResultPrice() { return 0; }
   uint ResultRetcode() { return TRADE_RETCODE_TRADE_DISABLED; }
   string ResultRetcodeDescription() { return "Evidence observer does not send orders"; }
   double ResultVolume() { return 0; }
   void SetDeviationInPoints(ulong points) {}
   void SetExpertMagicNumber(ulong magic) {}
   void SetTypeFilling(ENUM_ORDER_TYPE_FILLING filling) {}
};

bool Apex4DisabledOrderSend(const MqlTradeRequest &request, MqlTradeResult &result)
{
   ZeroMemory(result);
   result.retcode = TRADE_RETCODE_TRADE_DISABLED;
   return false;
}

int Apex4DisabledWebRequest(string method, string url, string headers, int timeout,
                            const char &inputBytes[], char &outputBytes[], string &responseHeaders)
{
   ArrayResize(outputBytes, 0);
   responseHeaders = "";
   return -1;
}

int Apex4DisabledWebRequest(string method, string url, string headers, int timeout,
                            const uchar &inputBytes[], uchar &outputBytes[], string &responseHeaders)
{
   ArrayResize(outputBytes, 0);
   responseHeaders = "";
   return -1;
}

string Apex4ObserverPath(string filename)
{
   return "Apex4ObserverState\\" + (MQLInfoInteger(MQL_TESTER) ? "tester" : IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN))) + "\\" + filename;
}

int Apex4ObserverFileOpen(string filename, int flags, short delimiter = '\t', uint codepage = CP_ACP)
{
   return FileOpen(Apex4ObserverPath(filename), flags, delimiter, codepage);
}
bool Apex4ObserverFileIsExist(string filename, int flags = 0) { return FileIsExist(Apex4ObserverPath(filename), flags); }
bool Apex4ObserverFileDelete(string filename, int flags = 0) { return FileDelete(Apex4ObserverPath(filename), flags); }
bool Apex4ObserverFileMove(string from, int flags, string to, int mode)
{
   return FileMove(Apex4ObserverPath(from), flags, Apex4ObserverPath(to), mode);
}
long Apex4ObserverFileFindFirst(string filter, string &name, int flags = 0)
{
   return FileFindFirst(Apex4ObserverPath(filter), name, flags);
}

string Apex4ObserverGlobalName(string name) { return "apex4m10." + name; }
bool Apex4ObserverGlobalCheck(string name) { return GlobalVariableCheck(Apex4ObserverGlobalName(name)); }
bool Apex4ObserverGlobalDel(string name) { return GlobalVariableDel(Apex4ObserverGlobalName(name)); }
double Apex4ObserverGlobalGet(string name) { return GlobalVariableGet(Apex4ObserverGlobalName(name)); }
datetime Apex4ObserverGlobalSet(string name, double value) { return GlobalVariableSet(Apex4ObserverGlobalName(name), value); }
bool Apex4ObserverGlobalCompareSet(string name, double value, double check)
{
   return GlobalVariableSetOnCondition(Apex4ObserverGlobalName(name), value, check);
}
