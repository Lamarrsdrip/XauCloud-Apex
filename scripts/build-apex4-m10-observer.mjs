import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SOURCE_COMMIT = 'fc91b97e2ee88eae6b9d4e24c6d74ef522c1ec4c';
export const SOURCE_SHA = '5be1ef095d7bf3d23c1d2cc7ee482368700bfff871a08e8f8f340a932d686d71';
export const OBSERVER = 'Apex4-M10-Observer-v6.29.1.mq5';
const leaseFiles = {
  'XauCloudLeaseClient.mqh': '5645dd32056f1a63304944c553848640d0238fee1a142e9816ace58b9a7346f2',
  'XauCloudLeaseCrypto.mqh': '1a097d4d8585f5d43cc24a3b052908514f93a0f3524f9570ddeddbbae4877485',
  'XauCloudLeaseSha256.mqh': '1f20efcc494ea872fb2ee715d9b13d5e65688b6a3068392a87fea32a435399a8',
};
const stateCalls = {
  WebRequest: 'Apex4DisabledWebRequest', OrderSend: 'Apex4DisabledOrderSend', OrderSendAsync: 'Apex4DisabledOrderSend',
  FileOpen: 'Apex4ObserverFileOpen', FileIsExist: 'Apex4ObserverFileIsExist', FileDelete: 'Apex4ObserverFileDelete',
  FileMove: 'Apex4ObserverFileMove', FileFindFirst: 'Apex4ObserverFileFindFirst',
  GlobalVariableCheck: 'Apex4ObserverGlobalCheck', GlobalVariableDel: 'Apex4ObserverGlobalDel',
  GlobalVariableGet: 'Apex4ObserverGlobalGet', GlobalVariableSet: 'Apex4ObserverGlobalSet',
  GlobalVariableSetOnCondition: 'Apex4ObserverGlobalCompareSet',
};
const eaRoot = new URL('../ea/', import.meta.url);

function replaceOnce(source, before, after) {
  const parts = source.split(before);
  if (parts.length !== 2) throw Error('Pinned XauCloud source anchor changed: '+before);
  return parts[0]+after+parts[1];
}

function extract(source, start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  if (a < 0 || b < a) throw Error('Pinned XauCloud telemetry anchors changed: '+start);
  return source.slice(a, b);
}

async function readPinned(path, sha) {
  const bytes = await readFile(path);
  if (createHash('sha256').update(bytes).digest('hex') !== sha) throw Error('Unverified source bytes: '+path);
  return bytes.toString('utf8').replace(/\r\n/g, '\n');
}

// Run against the exact pinned monolith. Only capability boundaries, observer
// inputs, and telemetry calls are patched. Reuse original serializers verbatim.
function isolateSideEffects(source) {
  for (const [before, after] of Object.entries(stateCalls)) source = source.replace(new RegExp('\\b'+before+'(?=\\s*\\()', 'g'), after);
  if (/^\s*#import\b/m.test(source) || /\b(?:Socket\w+|SendMail|SendNotification|WebRequest|OrderSend(?:Async)?)\s*\(/.test(source)) {
    throw Error('Unexpected external I/O in generated observer source');
  }
  return source;
}

function emitter(source) {
  const activity = source.slice(source.lastIndexOf('void BotMonitorDecisionEvent('));
  const thesis = extract(activity, '   XAU_AdaptiveTransitionDecision pressureTd =', '   // v6.24.14 — POST-TRADE STATE');
  const readiness = extract(activity, '   string readinessJson =', '   // v6.25.0 owner directive');
  const m10 = extract(activity, '   string m10SignalJson = ', '\n   string body =');
  return String.raw`
bool Apex4ObserverHTFReady()
{
   const int handles[4] = { hEMAFast_H1, hEMASlow_H1, hEMAFast_H4, hEMASlow_H4 };
   double value[1];
   for(int i = 0; i < 4; ++i)
      if(handles[i] == INVALID_HANDLE || CopyBuffer(handles[i], 0, 1, 1, value) != 1 ||
         !MathIsValidNumber(value[0]) || value[0] <= 0.0 || value[0] == EMPTY_VALUE) return false;
   const ENUM_TIMEFRAMES timeframes[3] = { PERIOD_H1, PERIOD_H4, PERIOD_D1 };
   MqlRates candle[1];
   for(int i = 0; i < 3; ++i)
      if(CopyRates(Symbol(), timeframes[i], 1, 1, candle) != 1 || candle[0].close <= 0.0) return false;
   return true;
}

void Apex4PublishNativeEvidence()
{
   const bool replay = (bool)MQLInfoInteger(MQL_TESTER);
   if(!Apex4ObserverAllowed() || (replay && !InpApexReplayEvidence) || (!replay && !Apex4EvidenceIdValid())) return;
   if(!g_entrySnapshotValid || !g_m10Snapshot.complete || g_m10Snapshot.freshnessState != "FRESH" ||
      g_m10Decision.evidenceId <= 0 || g_m10Snapshot.closedBarTime != iTime(Symbol(), PERIOD_M10, 1) ||
      g_m10Snapshot.closedBarTime != g_m10Decision.closedBarTime || !Apex4ObserverHTFReady()) return;

   MqlTick tick;
   if(!SymbolInfoTick(Symbol(), tick) || tick.bid <= 0 || tick.ask < tick.bid || tick.time_msc <= 0) return;
   static long lastTick = 0;
   static datetime lastBar = 0;
   if((replay && g_m10Snapshot.closedBarTime == lastBar) || (!replay && tick.time_msc - lastTick < 500)) return;
   const datetime timing = TimeTradeServer();
   if(timing <= 0) return;
   const long offset = (long)MathRound((double)(timing - TimeGMT()) / 60.0) * 60;
   const long asOf = tick.time_msc - offset * 1000;
   const long nowMs = (long)TimeGMT() * 1000;
   if(!replay && (nowMs - asOf > 3000 || asOf - nowMs > 1500)) return;
   const int signalDir = g_m10Decision.preferredDirection;
${thesis}
${readiness}
${m10}
   if(MathAbs(liveBid - tick.bid) > 0.000001 || MathAbs(liveAsk - tick.ask) > 0.000001) return;
   string packet = StringFormat(
      "{\"schema\":\"XAUCLOUD_CANONICAL_M10_EVIDENCE_V1\",\"sourceCommit\":\"${SOURCE_COMMIT}\",\"sourceSha256\":\"${SOURCE_SHA}\","
      "\"environment\":\"%s\",\"account\":\"%I64d\",\"symbol\":\"XAUUSD\",\"brokerSymbol\":\"%s\",\"brokerServer\":\"%s\","
      "\"observedAt\":%I64d,\"htfComplete\":true,\"quote\":{\"bid\":%.8f,\"ask\":%.8f,\"atMs\":%I64d},\"m10Signal\":%s,\"entryReadiness\":%s,\"thesis\":%s}",
      replay ? "TESTER" : "DEMO", AccountInfoInteger(ACCOUNT_LOGIN), BotMonitorJsonSafe(Symbol(), 48),
      BotMonitorJsonSafe(AccountInfoString(ACCOUNT_SERVER), 80), asOf, tick.bid, tick.ask, asOf, m10SignalJson, readinessJson, thesisJson);
   if(replay)
   {
      const int capture = FileOpen("Apex4Evidence\\replay-" + IntegerToString(ChartID()) + ".jsonl",
                                   FILE_COMMON | FILE_READ | FILE_WRITE | FILE_TXT | FILE_ANSI, '\t', CP_UTF8);
      if(capture == INVALID_HANDLE) return;
      FileSeek(capture, 0, SEEK_END);
      FileWriteString(capture, packet + "\n");
      FileClose(capture);
   }
   else
   {
      const string file = "Apex4Evidence\\" + InpApexEvidenceId + ".json";
      const string tmp = file + "." + IntegerToString(ChartID()) + ".tmp";
      const int capture = FileOpen(tmp, FILE_COMMON | FILE_WRITE | FILE_TXT | FILE_ANSI, '\t', CP_UTF8);
      if(capture == INVALID_HANDLE) return;
      FileWriteString(capture, packet);
      FileClose(capture);
      if(!FileMove(tmp, FILE_COMMON, file, FILE_COMMON | FILE_REWRITE)) return;
   }
   lastTick = tick.time_msc;
   lastBar = g_m10Snapshot.closedBarTime;
}
`;
}

export async function generateObserver(sourceDir, outputDir) {
  const raw = await readPinned(join(sourceDir, 'XauCloud.mq5'), SOURCE_SHA);
  const deps = await Promise.all(Object.entries(leaseFiles).map(async ([name, sha]) => [name, isolateSideEffects(await readPinned(join(sourceDir, 'lease', name), sha))]));
  let source = isolateSideEffects(raw);
  source = replaceOnce(source, '#include <Trade\\Trade.mqh>', '#include "Apex4-M10-Observer-Safety.mqh"');
  source = replaceOnce(source, 'CTrade        trade;', 'Apex4ObserverTrade trade;');
  const initAuth = extract(source, '   bool isTester = (bool)MQLInfoInteger(MQL_TESTER);\n   if(isTester)', '   // Strategy Tester startup self-tests');
  source = replaceOnce(source, initAuth, String.raw`   bool isTester = (bool)MQLInfoInteger(MQL_TESTER);
   if(!Apex4ObserverAllowed() || (!isTester && !Apex4EvidenceIdValid())) return INIT_FAILED;
   string symbol = Symbol();
   StringToUpper(symbol);
   if(StringFind(symbol, "XAUUSD") != 0 && StringFind(symbol, "GOLD") != 0) return INIT_FAILED;
   licenseValid = true;
   Print("APEX4_M10_OBSERVER_ACTIVE: order and network APIs disabled");

`);
  for (const callback of ['OnTimer', 'OnTick']) {
    const anchor = 'void '+callback+'()\n{';
    source = replaceOnce(source, anchor, anchor+'\n   if(!Apex4ObserverAllowed()) return;');
  }
  for (const [name, value] of Object.entries({
    InpUseAI: 'false', InpLocalAIEnabled: 'false', InpLocalAIReplayCacheEnabled: 'false', InpLocalAIReplayCollectMissing: 'false',
    InpEmergentDifficultFallbackEnabled: 'false', InpBotMonitorEnable: 'false', InpCloudFanout: 'false', InpOfflineLeaseEnabled: 'false',
    InpAIExitOverride: 'false', InpAISLTPMode: 'AI_SLTP_OFF', InpAIMode: 'AI_OFF',
    InpMagicNumber: '74019629', InpCounterExcursionMagicNumber: '74019630', InpExhaustionCounterMagicNumber: '74019631', InpSignalPlanMagicNumber: '74019632',
  })) {
    const pattern = new RegExp('^input ([\\w]+) +'+name+' *=[^;]+;', 'gm');
    if ([...source.matchAll(pattern)].length !== 1) throw Error('Pinned XauCloud input changed: '+name);
    source = source.replace(pattern, (_, type) => 'const '+type+' '+name+' = '+value+';');
  }
  const hook = '      XAU_RecordM10EvidenceIfNew();';
  if (source.split(hook).length !== 3) throw Error('Pinned XauCloud M10 evaluation count changed');
  source = source.replaceAll(hook, hook+'\n      Apex4PublishNativeEvidence();');

  await mkdir(join(outputDir, 'lease'), { recursive: true });
  await Promise.all(deps.map(([name, contents]) => writeFile(join(outputDir, 'lease', name), contents)));
  await copyFile(new URL('Apex4-M10-Observer-Safety.mqh', eaRoot), join(outputDir, 'Apex4-M10-Observer-Safety.mqh'));
  await writeFile(join(outputDir, OBSERVER), '// Generated evidence-only derivative of XauCloud '+SOURCE_COMMIT+' SHA-256 '+SOURCE_SHA+'\n'+source+emitter(raw));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [sourceDir, outputDir] = process.argv.slice(2);
  if (!sourceDir || !outputDir) {
    console.error('Usage: node scripts/build-apex4-m10-observer.mjs /path/to/XauAI-Sniper/backend/ea_code /path/to/separate-build-folder');
    process.exitCode = 1;
  } else {
    if (resolve(sourceDir) === resolve(outputDir)) throw Error('Use a separate output folder');
    await generateObserver(resolve(sourceDir), resolve(outputDir));
    console.log(join(resolve(outputDir), OBSERVER));
  }
}
