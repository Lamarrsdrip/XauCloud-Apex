// Offline, provider-free. Archive OHLC is MID; convert to a fixed-spread
// synthetic BID path for a conservative cost scenario, not an actual tick backtest.
import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createInterface} from 'node:readline';
import path from 'node:path';
import {scanPullbacks,trainKnowledge} from '../intelligence/apex4-engine.ts';
import {rollingSplits} from '../intelligence/xaucloud/aiTradingEducation.ts';
const [dirArg,outArg,spreadArg='0.30',slipArg='0.10']=process.argv.slice(2);
if(!dirArg||!outArg)throw Error('Provide export directory and private output file');
const dir=path.resolve(dirArg),out=path.resolve(outArg),spread=Number(spreadArg),slippage=Number(slipArg);
if(!(spread>0&&slippage>=0))throw Error('Invalid cost assumptions');
const meta=JSON.parse(await fs.readFile(path.join(dir,'metadata.json'),'utf8')),cases=JSON.parse(await fs.readFile(path.join(dir,'cases.json'),'utf8'));
if(meta.source!=='XAUCLOUD_EXNESS_PUBLIC_TICKS_M1_MID'||!Array.isArray(cases)||!cases.length)throw Error('No verified historical case export');
const bars=[];
for await(const line of createInterface({input:createReadStream(path.join(dir,'bars.ndjson')),crlfDelay:Infinity})){
 if(!line.trim())continue;
 const b=JSON.parse(line);
 if(![b.t,b.o,b.h,b.l,b.c].every(Number.isFinite)||b.t%60000!==0||b.l<=spread/2||b.l>Math.min(b.o,b.c)||b.h<Math.max(b.o,b.c)||bars.length&&b.t<=bars.at(-1).t)throw Error('Invalid or unordered archive row');
 bars.push({t:b.t,o:b.o-spread/2,h:b.h-spread/2,l:b.l-spread/2,c:b.c-spread/2});
}
if(bars.length<10000||bars.length!==meta.bars)throw Error('Insufficient or incomplete price archive');
const splits=rollingSplits(cases),tr=Date.parse(splits.train_end),va=Date.parse(splits.validation_end);
const through=Math.min(meta.to,Date.now());
const pullbacks=scanPullbacks(bars,spread,slippage);
const pTrain=bars[Math.floor(bars.length*.6)].t,pValidation=bars[Math.floor(bars.length*.8)].t;
const k=trainKnowledge(cases,pullbacks,tr,va,through,{trainEnd:pTrain,validationEnd:pValidation});
k.diagnostics.costScenario={spread,slippage,archive:'MID converted to synthetic BID',minuteResolution:true,commissionNotIncluded:true};
await fs.writeFile(out+'.tmp',JSON.stringify(k,null,2),{flag:'wx',mode:0o600});await fs.rename(out+'.tmp',out);
console.log(JSON.stringify({cases:k.diagnostics.caseCount,pullbacks:k.diagnostics.pullbackCaseCount,hoursWAT:k.hours,groups:k.pullbacks,holdout:k.diagnostics.pullbackHoldout,output:out}));
