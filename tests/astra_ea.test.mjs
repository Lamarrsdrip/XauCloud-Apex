import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {extract} from './native/extract.mjs';
import {findCxx,findSdk} from './native/build_and_run.mjs';

const ea=fs.readFileSync(new URL('../ea/XauCloud-Apex.mq5',import.meta.url),'utf8');
const baseline=fs.readFileSync(new URL('../ea/XauCloud-Apex-v3.8.8-UnlimitedFromL3.mq5',import.meta.url),'utf8');
const bridge=fs.readFileSync(new URL('../ea/AstraBridge.mqh',import.meta.url),'utf8');

test('Lifestyle native detector, add families and all economic sizing remain exact historical source',()=>{
  for(const name of ['Observe','BuildAddCandidate','FinalEntryGate','ComputeVolume','ComputeSimulated1200Volume',
    'LayerMarginPctFor','LayerMarginPct','PlanLayerSizing','ComputeLayerVolume','RederiveAfterSizeRejection',
    'SnapshotPolicy','ExecutionProfile','ComputePreflight']){
    assert.equal(extract(ea,name),extract(baseline,name),name);
  }
  const nativeManage=extract(baseline,'Manage');
  const candidateManage=extract(ea,'Manage');
  assert.equal(candidateManage.replace(/   \/\/ Shared native hard exits above always run\.[\s\S]*?if\(strategyOwner=="ASTRA"&&AstraManage\(\)\) return;\n/,''),nativeManage,
    'hard exits and fallback add path stay byte-identical after removing sole ownership hook');
});

test('candidate identity and ownership schema preserve immutable historical release',()=>{
  assert.match(ea,/#property version\s+"3\.100"/);
  assert.match(ea,/#define APEX_STATE_SCHEMA\s+7/);
  assert.match(baseline,/#property version\s+"3\.880"/);
  assert.match(extract(ea,'SaveState'),/strategyOwner/);
  assert.match(extract(ea,'LoadState'),/g_astraRestartTakeover=true/);
  assert.ok(extract(ea,'OnTimer').indexOf('Manage();')<extract(ea,'OnTimer').indexOf('AstraService()'));
  assert.ok(extract(ea,'OpenLayer').indexOf('AstraSubmissionValid()')<extract(ea,'OpenLayer').indexOf('e=SubmitMarket'));
  assert.doesNotMatch(bridge,/api\.openai\.com|sk-proj-|OPENAI_API_KEY/);
  // Cost guard: live and export requests share the attention/pacing gate; the
  // license never appears in a URL.
  assert.match(extract(bridge,'AstraService'),/AstraRequestDue\(now,event,tk\.bid\)/);
  assert.match(extract(bridge,'AstraExportContext'),/AstraRequestDue\(now,event,tk\.bid\)/);
  assert.match(extract(bridge,'AstraRequestDue'),/campState==CAMP_IDLE\)\s*return closed!=g_astraRequestClosedBar&&AstraAttention\(\)/);
  assert.doesNotMatch(bridge,/\?license=|"GET"/);
});

const compiler=findCxx();
test('actual extracted MQL decision parser, freshness, ownership and trade dispatcher execute adversarial scenarios',
  {skip:compiler?false:'C++ compiler unavailable'},()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'astra-ea-test-'));
  const core=['JsonSkipWs','JsonReadString','JsonIsNumberToken','JsonReadValue','JsonParseObject','JIdx','JHas',
    'JBoolStrict','JNumStrict','JStrStrict'].map(n=>extract(ea,n)).join('\n');
  const fns=['AstraMember','AstraUnit','AstraHexTrigger','AstraParseObject','AstraReadDecision','AstraFreshEnvelope','AstraWinnerProof',
    'AstraTakeover','AstraFail','AstraSubmissionValid','AstraEntryAuthority','AstraManage'].map(n=>extract(bridge,n)).join('\n');
  const prefix=String.raw`
#include <string>
#include <vector>
#include <cmath>
#include <iostream>
#include <stdexcept>
#include <cstring>
#include <algorithm>
using string=std::string;using ushort=unsigned short;using ulong=unsigned long;using datetime=long;
int StringLen(const string&s){return s.size();}
ushort StringGetCharacter(const string&s,int i){return i>=0&&i<(int)s.size()?s[i]:0;}
int StringFind(const string&s,const string&v){auto i=s.find(v);return i==string::npos?-1:(int)i;}
string StringSubstr(const string&s,int start,int length=-1){return s.substr(start,length<0?string::npos:length);}
string ShortToString(ushort c){return string(1,(char)c);}
long StringToInteger(const string&s){try{return std::stol(s,nullptr,0);}catch(...){return 0;}}
double StringToDouble(const string&s){return std::stod(s);}
template<class T>void ArrayResize(std::vector<T>&v,int n){v.resize(n);}
template<class T>void ZeroMemory(T&x){x=T{};}
bool MathIsValidNumber(double x){return std::isfinite(x);}
double MathFloor(double x){return std::floor(x);}
double MathAbs(double x){return std::abs(x);}
double MathMax(double x,double y){return std::max(x,y);}
double MathMin(double x,double y){return std::min(x,y);}
template<class... T>string StringFormat(const char*fmt,T...){return fmt;}
std::vector<string>events;std::vector<string>g_jkey,g_jval;std::vector<ushort>g_jtype;int g_jcount=0;
long wall=1000000;ulong mono=1000;long closedBar=960;bool tester=false;
long AstraNowMs(){return wall;}
long AstraBrokerOffset(){return 0;}
ulong GetTickCount64(){return mono;}
bool IsTester(){return tester;}
bool InpAstraBridge=true;long InpMagic=1;
string _Symbol="XAUUSDm";int PERIOD_M1=1,POSITION_TIME_MSC=1;
long iTime(string,int,int){return closedBar;}
struct MqlTick{double bid=4314.00,ask=4314.10;long time_msc=1000000;};MqlTick tick;
bool SymbolInfoTick(string,MqlTick&out){out=tick;return true;}
long TimeCurrent(){return wall/1000;}
enum CampState{CAMP_IDLE,CAMP_ACTIVE,CAMP_CLOSING,CAMP_SUBMITTING};
CampState campState=CAMP_IDLE;string campId="",strategyOwner="LIFESTYLE_NATIVE";int layers=0,campDir=0;
double lastAdd=4313.96,pnl=10;int positions=0,triggerUses=0,saveCalls=0,entryCalls=0,addCalls=0,exitCalls=0,reduceCalls=0;
bool g_astraStopAdding=false,g_astraSubmitting=false;double g_astraCampaignInvalidation=0;ulong masterTicket=1;
struct {bool armed=true;int maxLayers=0;}C;
struct {bool active=false,isFirstEntry=false;string family,triggerId;}g_pending;
struct Setup{string id,bosKind;double extreme=0,triggerPrice=0;long triggerBarTime=0,armedAt=0;}S;
struct Snap{int dir=0;double score=0,atr=0;string sig;bool valid=false;};
int CountPos(){return positions;}
double BasketProfitFloating(){return pnl;}
int TriggerUseCount(string){return triggerUses;}
void ConsumeTrigger(string){triggerUses++;}
void SaveState(){saveCalls++;}
void AstraEvent(string type,string reason=""){events.push_back(type+"|"+reason);}
void RequestClose(string,string){exitCalls++;campState=CAMP_CLOSING;}
void Start(Snap&s,string owner){entryCalls++;strategyOwner=owner;campId="new-campaign";campState=CAMP_ACTIVE;campDir=s.dir;positions=1;layers=1;}
bool OpenLayer(int,double,string,double,double,double,long,bool){addCalls++;positions++;layers++;return true;}
int PositionsTotal(){return positions;}
ulong PositionGetTicket(int i){return i+1;}
bool IsOurPosition(ulong t){return t>0&&t<=(ulong)positions;}
long PositionGetInteger(int){return positions*100;}
typedef unsigned int uint;const uint TRADE_RETCODE_DONE=10009,TRADE_RETCODE_DONE_PARTIAL=10010;uint closeRc=TRADE_RETCODE_DONE;
struct Trade{void SetExpertMagicNumber(long){}bool PositionClose(ulong){reduceCalls++;if(closeRc==TRADE_RETCODE_DONE)positions--;return closeRc==TRADE_RETCODE_DONE;}uint ResultRetcode(){return closeRc;}}trade;
`;
  const globals=String.raw`
#define ASTRA_KNOWLEDGE_VERSION "tradingcartel-breakfast-v1"
AstraDecision g_astraDecision;
bool g_astraAvailable=true,g_astraPending=false;
string g_astraStatus="ACTIVE",g_astraFallback="",g_astraRequestId="req1",g_astraSnapshotId="snap1",g_astraLastApplied="";
ulong g_astraBackoffUntil=0,g_astraPendingSince=1000;long g_astraRequestClosedBar=960;
bool AstraSubmissionValid();void AstraFail(string reason);void AstraTakeover(string reason);
`;
  const main=String.raw`
void check(bool x,const char*m){if(!x)throw std::runtime_error(m);}
void reset(){
 wall=1000000;mono=1000;closedBar=960;tester=false;InpAstraBridge=true;tick=MqlTick{};
 campState=CAMP_IDLE;campId="";strategyOwner="LIFESTYLE_NATIVE";layers=0;campDir=0;positions=0;triggerUses=0;
 pnl=10;saveCalls=entryCalls=addCalls=exitCalls=reduceCalls=0;g_astraStopAdding=g_astraSubmitting=false;g_astraCampaignInvalidation=0;
 g_astraAvailable=true;g_astraPending=false;g_astraFallback="";g_astraLastApplied="";
 g_astraRequestId="req1";g_astraSnapshotId="snap1";g_astraPendingSince=1000;g_astraRequestClosedBar=960;
 g_astraDecision=AstraDecision{};closeRc=TRADE_RETCODE_DONE;events.clear();C.armed=true;C.maxLayers=0;g_pending.active=false;
}
string payload(){return R"JSON({"status":"ACTIVE","decisionId":"req1","snapshotId":"snap1","strategyVersion":"tradingcartel-breakfast-v1","state":"ENTRY_READY","action":"ENTER_SELL","direction":"SELL","triggerId":"01234567890123456789012345678901","expectedCampaignId":"","thesisValid":true,"confidence":0.9,"setupQuality":0.9,"locationQuality":0.9,"freshness":0.9,"extensionRisk":0.1,"continuationQuality":0.9,"invalidationPrice":4316,"referenceBid":4314,"referenceAsk":4314.1,"maxDriftAtr":0.5,"atr":2,"createdAtMs":1000000,"expiresAtMs":1008000,"expectedLayers":0})JSON";}
void parse(){check(AstraParseObject(payload()),"valid object");check(AstraReadDecision(),"valid decision");}
void active(){parse();campState=CAMP_ACTIVE;campId="camp1";strategyOwner="ASTRA";campDir=-1;layers=positions=1;
 g_astraDecision.action="ADD";g_astraDecision.state="ADD_READY";g_astraDecision.expectedCampaignId="camp1";g_astraDecision.expectedLayers=1;}
int main(){try{
 reset();parse();check(AstraEntryAuthority(),"Astra authority");check(entryCalls==1&&strategyOwner=="ASTRA","entry bypasses absent native setup");
 check(AstraEntryAuthority()&&entryCalls==1,"decision cannot execute twice");
 reset();active();check(AstraManage()&&addCalls==1,"early clustered add allowed despite last fill below live SELL quote");
 check(AstraManage()&&addCalls==1,"same add decision single use");
 reset();active();pnl=-0.01;AstraManage();check(addCalls==0,"losing basket never pyramids");
 reset();active();triggerUses=1;AstraManage();check(addCalls==0,"consumed trigger cannot pyramid");
 reset();active();wall=1009000;AstraManage();check(addCalls==0&&strategyOwner=="LIFESTYLE_NATIVE","stale decision native takeover");
 reset();active();mono=9001;AstraManage();check(addCalls==0&&strategyOwner=="LIFESTYLE_NATIVE","monotonic age survives clock discrepancy");
 reset();active();tick.bid=4312;AstraManage();check(addCalls==0,"price drift blocks add");
 reset();active();closedBar=1020;AstraManage();check(addCalls==0,"new closed bar invalidates old decision");
 reset();active();g_astraDecision.expectedLayers=2;AstraManage();check(addCalls==0&&strategyOwner=="LIFESTYLE_NATIVE","fill prefix changed");
 reset();active();g_astraDecision.direction="BUY";AstraManage();check(addCalls==0&&strategyOwner=="LIFESTYLE_NATIVE","opposite direction blocked");
 reset();active();AstraFail("AI_TIMEOUT");check(strategyOwner=="LIFESTYLE_NATIVE"&&saveCalls==1,"failure ownership durable");
 g_astraAvailable=true;check(!AstraManage()&&addCalls==0&&strategyOwner=="LIFESTYLE_NATIVE","AI recovery cannot regain native campaign");
 reset();active();g_astraDecision.action="STOP_ADDING";AstraManage();check(g_astraStopAdding&&addCalls==0,"stop adding");
 reset();active();g_astraDecision.thesisValid=false;AstraManage();check(exitCalls==1&&campState==CAMP_CLOSING,"thesis invalid exit");
 reset();active();g_astraCampaignInvalidation=4315;g_astraPending=true;tick.ask=4315.01;AstraManage();check(exitCalls==1&&addCalls==0,"live invalidation exits during pending inference");
 reset();active();g_astraCampaignInvalidation=4315;g_astraDecision.invalidationPrice=4320;g_astraDecision.action="HOLD";AstraManage();check(g_astraCampaignInvalidation==4315,"AI cannot widen campaign invalidation");
 reset();active();g_astraDecision.action="REDUCE";positions=3;AstraManage();check(reduceCalls==1&&g_astraStopAdding&&events.back().rfind("ASTRA_REDUCE|",0)==0,"reduce newest nonmaster confirmed");
 reset();active();g_astraDecision.action="REDUCE";positions=3;closeRc=10006;AstraManage();check(reduceCalls==1&&g_astraStopAdding&&events.back().rfind("ASTRA_STOP_ADDING|REDUCE_NOT_CONFIRMED",0)==0&&g_astraLastApplied==g_astraDecision.decisionId,"rejected reduce is reported unconfirmed and not retried");
 reset();active();g_astraDecision.action="REDUCE";AstraManage();check(reduceCalls==0&&g_astraStopAdding,"sole master reduction stops adds");
 reset();parse();g_astraDecision.invalidationPrice=4314.05;check(!AstraSubmissionValid(),"live ask reclaim blocked");
 reset();check(!AstraParseObject("prose SELL"),"prose rejected");
 check(!AstraParseObject("{\"action\":\"WAIT\",\"action\":\"ENTER_SELL\"}"),"duplicates rejected");
 check(!AstraParseObject("{\"action\":\"WAIT\"} ignored"),"trailing data rejected");
 check(!AstraParseObject("{\"action\":\"WAIT\",}"),"trailing comma rejected");
 reset();string bad=payload();bad.replace(bad.find("\"confidence\":0.9"),16,"\"confidence\":2.0");
 check(AstraParseObject(bad)&&!AstraReadDecision(),"out of range confidence rejected");
 reset();parse();g_astraSnapshotId="different";check(!AstraSubmissionValid(),"snapshot mismatch");
 std::cout<<"27 actual-source adversarial scenarios passed\n";return 0;
 }catch(const std::exception&e){std::cerr<<e.what()<<"\n";return 1;}}
`;
  try{
    fs.writeFileSync(path.join(dir,'test.cpp'),prefix+core+'\n'+extract(bridge,'AstraDecision',{kind:'struct'})+'\n'+globals+fns+main);
    const args=['-std=c++17','-O0',path.join(dir,'test.cpp'),'-o',path.join(dir,'test')];
    const sdk=findSdk();if(sdk)args.unshift('-isysroot',sdk);
    execFileSync(compiler,args,{stdio:'pipe'});
    assert.match(execFileSync(path.join(dir,'test'),[],{encoding:'utf8'}),/27 actual-source adversarial scenarios passed/);
  }catch(error){
    if(error.stderr)error.message+='\n'+String(error.stderr);throw error;
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
