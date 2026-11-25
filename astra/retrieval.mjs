import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {selectReferenceObservations} from './reference-observations.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');

export async function knowledge(context) {
  const [base,guide]=await Promise.all([fs.readFile(path.join(root,'astra','strategy.md'),'utf8'),fs.readFile(path.join(root,'astra','reference-pattern-guide.md'),'utf8')]);
  const instructions=base+'\n\n'+guide;
  const files=['reference-setups.jsonl','reference-adds.jsonl','negative-setups.jsonl','failed-campaigns.jsonl','campaign-sequences.jsonl'];
  const groups=await Promise.all(files.map(async file=>{
    try {
      const rows=(await fs.readFile(path.join(root,'data','astra',file),'utf8')).split('\n').filter(x=>x.trim()).map(JSON.parse);
      return rows.map(row=>({sourceFile:file,...row}));
    }catch(e){if(e.code==='ENOENT')return [];throw new Error('KNOWLEDGE_PACKAGE_INVALID');}
  }));
  const direction=context.campaign.positions.length?context.campaign.direction:null;
  const rank=row=>{
    const serialized=JSON.stringify(row).toUpperCase();
    let score=direction&&row.direction===direction?3:0;
    if(context.structure.lowerFailedAcceptance&&row.direction==='BUY')score+=2;
    if(context.structure.failedBullishRecovery&&row.direction==='SELL')score+=2;
    if(context.structure.failedBearishRecovery&&row.direction==='BUY')score+=2;
    if(context.campaign.positions.length&&/ADD|CONTINUATION|COUNTER/.test(serialized))score+=4;
    if(context.structure.upperFailedAcceptance&&/REJECTION|SWEEP/.test(serialized))score+=2;
    return score;
  };
  // Always retain negative and failed-campaign examples, even if their feature
  // overlap ranks lower than a spectacular winner. Stable ordering is reproducible.
  const limits=[2,2,2,1,1],examples=groups.flatMap((rows,i)=>rows.map((row,index)=>({row,index,score:rank(row)}))
    .sort((a,b)=>b.score-a.score||a.index-b.index).slice(0,limits[i]).map(x=>x.row));
  const observed=(await fs.readFile(path.join(root,'data','astra','reference-observations-2026-11-25.jsonl'),'utf8')).split('\n').filter(x=>x.trim()).map(JSON.parse);
  examples.push(...selectReferenceObservations(observed,context));
  return {instructions,examples};
}
