import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');

export async function knowledge(context) {
  const instructions=await fs.readFile(path.join(root,'astra','strategy.md'),'utf8');
  const files=['reference-setups.jsonl','reference-adds.jsonl','negative-setups.jsonl','failed-campaigns.jsonl','campaign-sequences.jsonl'];
  const groups=await Promise.all(files.map(async file=>{
    try {
      const rows=(await fs.readFile(path.join(root,'data','astra',file),'utf8')).split('\n').filter(x=>x.trim()).map(JSON.parse);
      return rows.map(row=>({sourceFile:file,...row}));
    }catch(e){if(e.code==='ENOENT')return [];throw new Error('KNOWLEDGE_PACKAGE_INVALID');}
  }));
  const direction=context.campaign.direction!=='NONE'?context.campaign.direction:
    context.structure.approach.impulseAtr>0?'SELL':'BUY';
  const rank=row=>{
    const serialized=JSON.stringify(row).toUpperCase();
    let score=serialized.includes(direction)?3:0;
    if(context.campaign.positions.length&&/ADD|CONTINUATION|COUNTER/.test(serialized))score+=4;
    if(context.structure.upperFailedAcceptance&&/REJECTION|SWEEP/.test(serialized))score+=2;
    return score;
  };
  // Always retain negative and failed-campaign examples, even if their feature
  // overlap ranks lower than a spectacular winner. Stable ordering is reproducible.
  const limits=[2,2,2,1,1],examples=groups.flatMap((rows,i)=>rows.map((row,index)=>({row,index,score:rank(row)}))
    .sort((a,b)=>b.score-a.score||a.index-b.index).slice(0,limits[i]).map(x=>x.row));
  return {instructions,examples};
}
