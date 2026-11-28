import {readFile,writeFile} from 'node:fs/promises';
import {nativeOutlookHours,nativeOutlookReplayCsv} from '../intelligence/apex4-native-basket-contract.mjs';
const [input,output,hours='8,9']=process.argv.slice(2);
if(!input||!output)throw Error('Usage: node scripts/export-apex4-strong-outlook.mjs <canonical-records.json> <Apex4StrongOutlook.csv> [WAT hours]');
const data=JSON.parse(await readFile(input,'utf8'));
const csv=nativeOutlookReplayCsv(data,nativeOutlookHours(hours));
if(!csv)throw Error('NO_VERIFIED_STRONG_OUTLOOK_RECORDS');
await writeFile(output,csv,{flag:'wx'});
console.log('Exported '+csv.trim().split('\n').length+' canonical STRONG signals. Verify the source receipt before testing.');
