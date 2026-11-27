// Read-only export from an existing XauCloud backend build and local price archive.
// Usage: node scripts/export-xaucloud-v4-knowledge.mjs /path/to/XauAI-Sniper/backend_node /private/export-dir 2021-11-01 2026-11-27
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const [rootArg,outArg,fromArg,toArg]=process.argv.slice(2);
if(!rootArg||!outArg||!fromArg||!toArg)throw Error('Provide backend root, NEW private output directory, from and to (UTC).');
const root=path.resolve(rootArg),out=path.resolve(outArg),from=Date.parse(fromArg),to=Date.parse(toArg);
if(!(from<to&&to<=Date.now()))throw Error('Invalid export dates');
await fs.mkdir(out,{recursive:false,mode:0o700});
process.chdir(root);
const {connectDb,closeDb}=await import(pathToFileURL(path.join(root,'dist/db.js')).href);
const {archiveBars,archiveCoverage}=await import(pathToFileURL(path.join(root,'dist/services/goldHistoryArchive.js')).href);
try{
 const db=await connectDb();
 const rows=await db.collection('ai_trading_cases').find({version:'TRADING_EDUCATION_V2_2026_11_27',at:{$gte:new Date(from).toISOString(),$lt:new Date(to).toISOString()}},{projection:{_id:0,case:1}}).sort({at:1}).toArray();
 const cases=rows.map(({case:c})=>({id:createHash('sha256').update(String(c.id)).digest('hex'),engine:c.engine,side:c.side,at:c.at,features:c.features,outcome:c.outcome,study:c.study}));
 await fs.writeFile(path.join(out,'cases.json'),JSON.stringify(cases),{flag:'wx',mode:0o600});
 let n=0;
 const h=await fs.open(path.join(out,'bars.ndjson'),'wx',0o600);
 try{for(let t=from;t<to;){const d=new Date(t),next=Math.min(to,Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,1));const bars=archiveBars(t,next);
 await h.writeFile(bars.map(x=>JSON.stringify({t:x.t,o:x.o,h:x.h,l:x.l,c:x.c,spread:x.spread})).join('\n')+(bars.length?'\n':''));n+=bars.length;t=next;}}finally{await h.close();}
 await fs.writeFile(path.join(out,'metadata.json'),JSON.stringify({source:'XAUCLOUD_EXNESS_PUBLIC_TICKS_M1_MID',from,to,cases:cases.length,bars:n,coverage:archiveCoverage(),exportedAt:Date.now()},null,2),{flag:'wx',mode:0o600});
 console.log(JSON.stringify({cases:cases.length,archiveBars:n,output:out}));if(!cases.length||!n)process.exitCode=2;
}finally{await closeDb();}
