// Extracts named function / struct definitions VERBATIM from a .mq5 file so the real
// source text can be compiled and executed. If the source changes, the extracted text
// changes with it -- this is deliberately not a re-implementation.
import fs from 'node:fs';

export function readSource(file){return fs.readFileSync(file,'utf8')}

function matchBraces(src,openIdx){
  let depth=0,i=openIdx,inStr=false,inChr=false,inLine=false,inBlock=false;
  for(;i<src.length;i++){
    const c=src[i],n=src[i+1];
    if(inLine){if(c==='\n')inLine=false;continue}
    if(inBlock){if(c==='*'&&n==='/'){inBlock=false;i++}continue}
    if(inStr){if(c==='\\'){i++;continue}if(c==='"')inStr=false;continue}
    if(inChr){if(c==='\\'){i++;continue}if(c==="'")inChr=false;continue}
    if(c==='/'&&n==='/'){inLine=true;i++;continue}
    if(c==='/'&&n==='*'){inBlock=true;i++;continue}
    if(c==='"'){inStr=true;continue}
    if(c==="'"){inChr=true;continue}
    if(c==='{')depth++;
    else if(c==='}'){depth--;if(depth===0)return i}
  }
  throw new Error('unbalanced braces from '+openIdx);
}

// Extracts `<returnType> name(...) { ... }` (function) or `struct Name { ... };`.
// v3.7.1 packs several functions onto one physical line, so the start of a definition is
// found structurally (identifier -> balanced parens -> `{`) rather than by line shape.
function matchParens(src,openIdx){
  let depth=0;
  for(let i=openIdx;i<src.length;i++){
    const c=src[i];
    if(c==='(')depth++;
    else if(c===')'){depth--;if(depth===0)return i}
  }
  return -1;
}
export function extract(src,name,{kind='function'}={}){
  if(kind==='struct'){
    const m=src.match(new RegExp(`\\bstruct\\s+${name}\\b`));
    if(!m)throw new Error('cannot locate struct '+name);
    const open=src.indexOf('{',m.index);
    const close=matchBraces(src,open);
    let end=close+1;
    while(end<src.length&&src[end]!==';')end++;
    return src.slice(m.index,end+1);
  }
  const re=new RegExp(`\\b${name}\\b`,'g');
  let m;
  while((m=re.exec(src))!==null){
    let i=m.index+name.length;
    while(i<src.length&&/\s/.test(src[i]))i++;
    if(src[i]!=='(')continue;
    const closeParen=matchParens(src,i);
    if(closeParen<0)continue;
    let j=closeParen+1;
    while(j<src.length&&/\s/.test(src[j]))j++;
    if(src[j]!=='{')continue;                 // a call, not a definition
    // rewind over the return type back to the previous statement boundary
    let start=m.index;
    while(start>0){
      const c=src[start-1];
      if(c===';'||c==='}'||c==='\n')break;
      start--;
    }
    const close=matchBraces(src,j);
    return src.slice(start,close+1).trim();
  }
  throw new Error('cannot locate function '+name);
}

export function extractAll(src,specs){
  return specs.map(s=>typeof s==='string'?extract(src,s):extract(src,s.name,s)).join('\n\n');
}
