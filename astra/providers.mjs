import {DECISION_SCHEMA,validateDecision} from './contract.mjs';
import {knowledge} from './retrieval.mjs';
const fail=message=>Object.assign(new Error(message),{safe:true});
export function providerForKey(key){return String(key).startsWith('sk-ant-')?'anthropic':'openai';}
export function assertProviderModel(provider,model){
 if(provider==='anthropic'&&!/^claude-/i.test(model)||provider==='openai'&&/^claude-/i.test(model))throw fail('PROVIDER_MODEL_MISMATCH');
}
// Anthropic's schema subset may not enforce numeric bounds/patterns. The existing
// local contract validator always enforces the complete schema after generation.
function schemaSubset(node){
 if(Array.isArray(node))return node.map(schemaSubset);
 if(!node||typeof node!=='object')return node;
 return Object.fromEntries(Object.entries(node).filter(([k])=>!['minimum','maximum','pattern','minItems','maxItems'].includes(k)).map(([k,v])=>[k,schemaSubset(v)]));
}
export async function anthropicText({key,model,effort='default',system,text,image=null,schema=null,fetchImpl=fetch,signal,maxTokens=16000}){
 assertProviderModel('anthropic',model);
 const config={};
 if(['low','medium','high','xhigh'].includes(effort))config.effort=effort;
 if(schema)config.format={type:'json_schema',schema:schemaSubset(schema)};
 const content=[{type:'text',text}];
 if(image){const [head,data]=image.split(',');content.push({type:'image',source:{type:'base64',media_type:head.slice(5).split(';')[0],data}});}
 const r=await fetchImpl('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'x-api-key':key,'anthropic-version':'2023-06-01','content-type':'application/json'},signal,body:JSON.stringify({model,max_tokens:maxTokens,system,messages:[{role:'user',content}],...(Object.keys(config).length?{output_config:config}:{})})});
 if(r.status===401||r.status===403)throw fail('AUTH_ERROR');
 if(r.status===429)throw fail('RATE_LIMITED');
 if(!r.ok)throw fail('AI_ERROR');
 const data=await r.json();
 if(data.stop_reason==='refusal')throw fail('AI_REFUSAL');
 if(data.stop_reason!=='end_turn')throw fail('AI_INCOMPLETE');
 const answer=(data.content||[]).filter(x=>x.type==='text'&&typeof x.text==='string').map(x=>x.text).join('\n').trim();
 if(!answer||answer.length>40000)throw fail('AI_INCOMPLETE');
 return answer;
}
export async function callAnthropicDecision({key,model,effort,context,fetchImpl=fetch,timeoutMs=6000,signal,loadKnowledge=knowledge}){
 const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),timeoutMs),abort=()=>ctrl.abort();
 signal?.addEventListener('abort',abort,{once:true});
 try{
  if(signal?.aborted)throw fail('AI_TIMEOUT');
  const {instructions,examples}=await loadKnowledge(context);
  if(ctrl.signal.aborted)throw fail('AI_TIMEOUT');
  const text=await anthropicText({key,model,effort,system:instructions,text:JSON.stringify({referenceExamples:examples,market:context}),schema:DECISION_SCHEMA,fetchImpl,signal:ctrl.signal,maxTokens:6000});
  let raw;try{raw=JSON.parse(text);}catch{throw fail('SCHEMA_FAILURE');}
  return validateDecision(raw);
 }catch(e){if(ctrl.signal.aborted||e.name==='AbortError')throw fail('AI_TIMEOUT');throw e;}
 finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}
