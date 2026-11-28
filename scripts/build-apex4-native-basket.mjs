import {mkdir,readFile,writeFile,copyFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {generateObserver,OBSERVER} from './build-apex4-m10-observer.mjs';
export const NATIVE='XauCloud-Apex-v4-NativeBasket-TESTER.mq5';
export function nativeBasketSource(observer,{outlookReplay=false}={}) {
  const replace=(a,b)=>{if(observer.split(a).length!==2)throw Error('Native basket anchor changed: '+a);observer=observer.replace(a,b);};
  replace('#property version   "6.291"','#property version   "4.100"');
  replace('   if(!Apex4ObserverAllowed() || (!isTester && !Apex4EvidenceIdValid())) return INIT_FAILED;',
          '   if(!ApexBasketInit()) return INIT_FAILED;');
  replace('void OnTick()\n{','void OnTick()\n{\n   ApexBasketManage();\n   ApexBasketReplayTick();\n   ApexBasketLiveOutlookTick();');
  replace('void OnDeinit(const int reason)\n{','void OnDeinit(const int reason)\n{\n   ApexBasketShutdown();');
  const hook='      Apex4PublishNativeEvidence();';
  if(observer.split(hook).length!==3)throw Error('Native M10 hook count changed');
  observer=observer.replaceAll(hook,hook+'\n      ApexBasketConsiderNative();');
  return (outlookReplay?'#property tester_file "Apex4StrongOutlook.csv"\n':'')+observer+'\n#include "Apex4-NativeBasket-Tester.mqh"\n';
}
export async function generateNativeBasket(sourceDir,outputDir,options={}){
 if(resolve(sourceDir)===resolve(outputDir))throw Error('Use separate output folder');
 await mkdir(outputDir,{recursive:true});
 await generateObserver(sourceDir,outputDir);
 const observer=await readFile(join(outputDir,OBSERVER),'utf8');
 await copyFile(new URL('../ea/Apex4-NativeBasket-Tester.mqh',import.meta.url),join(outputDir,'Apex4-NativeBasket-Tester.mqh'));
 await writeFile(join(outputDir,NATIVE),nativeBasketSource(observer,options));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [source,output,flag]=process.argv.slice(2);
 if(!source||!output||(flag&&flag!=='--outlook-replay'))throw Error('Usage: node scripts/build-apex4-native-basket.mjs <XauAI-Sniper/backend/ea_code> <separate output folder> [--outlook-replay]');
 await generateNativeBasket(resolve(source),resolve(output),{outlookReplay:flag==='--outlook-replay'});
 console.log(join(resolve(output),NATIVE));
}
