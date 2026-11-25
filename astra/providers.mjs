import {DECISION_SCHEMA,validateDecision} from './contract.mjs';
import {knowledge} from './retrieval.mjs';
import {effectiveEffort} from './models.mjs';
const fail=(message,extra={})=>Object.assign(new Error(message),{safe:true,...extra});
export function providerForKey(key){return String(key).startsWith('sk-ant-')?'anthropic':'openai';}
export function assertProviderModel(provider,model){
 if(provider==='anthropic'&&!/^claude-/i.test(model)||provider==='openai'&&/^claude-/i.test(model))throw fail('PROVIDER_MODEL_MISMATCH');
}
// Provider URLs are fixed: a customer's key can never be redirected. Provider
// error bodies are inspected for a code only and never logged or returned.
const OPENAI_URL='https://api.openai.com/v1/responses',ANTHROPIC_URL='https://api.anthropic.com/v1/messages';

// Anthropic's schema subset may not enforce numeric bounds/patterns. The local
// contract validator always enforces the complete schema after generation.
function schemaSubset(node){
 if(Array.isArray(node))return node.map(schemaSubset);
 if(!node||typeof node!=='object')return node;
 return Object.fromEntries(Object.entries(node).filter(([k])=>!['minimum','maximum','pattern','minItems','maxItems'].includes(k)).map(([k,v])=>[k,schemaSubset(v)]));
}
async function httpFailure(r,provider){
 let code='',type='';try{const j=await r.json();code=j?.error?.code||'';type=j?.error?.type||'';}catch{}
 if(r.status===401||r.status===403)throw fail('AUTH_ERROR');
 if(r.status===429)throw fail(code==='insufficient_quota'?'NO_CREDIT':'RATE_LIMITED');
 if(r.status===404||code==='model_not_found'||type==='not_found_error')throw fail('MODEL_NOT_AVAILABLE');
 if(r.status===400||r.status===422)throw fail('PROVIDER_REJECTED_REQUEST');
 if(r.status===529||r.status>=500)throw fail('PROVIDER_UNAVAILABLE');
 throw fail('AI_ERROR',{provider});
}
function openaiBody({model,effort,system,text,image,schema,maxTokens,stream}){
 const content=[{type:'input_text',text}];
 if(image)content.push({type:'input_image',image_url:image,detail:'high'});
 const e=effectiveEffort(model,effort);
 return {model,store:false,instructions:system,input:[{role:'user',content}],
  ...(e!=='default'?{reasoning:{effort:e}}:{}),
  ...(schema?{text:{format:{type:'json_schema',name:'apex_output',strict:true,schema}}}:{}),
  max_output_tokens:maxTokens,...(stream?{stream:true}:{})};
}
function anthropicBody({model,effort,system,text,image,schema,maxTokens,stream}){
 const config={},e=effectiveEffort(model,effort);
 if(e!=='default'&&e!=='none')config.effort=e;
 if(schema)config.format={type:'json_schema',schema:schemaSubset(schema)};
 const content=[{type:'text',text}];
 if(image){const [head,data]=image.split(',');content.push({type:'image',source:{type:'base64',media_type:head.slice(5).split(';')[0],data}});}
 return {model,max_tokens:maxTokens,system,messages:[{role:'user',content}],...(Object.keys(config).length?{output_config:config}:{}),...(stream?{stream:true}:{})};
}
function usageOf(provider,data){
 const u=data?.usage||{};
 return provider==='openai'?{inputTokens:u.input_tokens??0,outputTokens:u.output_tokens??0,reasoningTokens:u.output_tokens_details?.reasoning_tokens??0}
  :{inputTokens:(u.input_tokens??0)+(u.cache_read_input_tokens??0)+(u.cache_creation_input_tokens??0),outputTokens:u.output_tokens??0};
}

/**
 * One model call for any supported provider. Returns {text, usage, latencyMs}.
 * `onDelta` enables streaming (chat). The caller owns the AbortSignal deadline.
 */
export async function callModel({key,model,effort='default',system,text,image=null,schema=null,maxTokens=16000,fetchImpl=fetch,signal,onDelta=null}){
 const provider=providerForKey(key);assertProviderModel(provider,model);
 const started=Date.now(),stream=!!onDelta;
 const args={model,effort,system,text,image,schema,maxTokens,stream};
 const r=provider==='openai'
  ?await fetchImpl(OPENAI_URL,{method:'POST',signal,headers:{authorization:'Bearer '+key,'content-type':'application/json'},body:JSON.stringify(openaiBody(args))})
  :await fetchImpl(ANTHROPIC_URL,{method:'POST',signal,headers:{'x-api-key':key,'anthropic-version':'2023-06-01','content-type':'application/json'},body:JSON.stringify(anthropicBody(args))});
 if(!r.ok)await httpFailure(r,provider);
 if(stream&&r.body&&String(r.headers?.get?.('content-type')||'').includes('event-stream'))return readStream(provider,r,onDelta,started);
 const data=await r.json();
 let answer='';
 if(provider==='openai'){
  if(data.status!=='completed')throw fail('AI_INCOMPLETE');
  const parts=(data.output||[]).filter(x=>x.type==='message'&&x.role==='assistant').flatMap(x=>x.content||[]);
  if(parts.some(x=>x.type==='refusal'))throw fail('AI_REFUSAL');
  answer=parts.filter(x=>x.type==='output_text'&&typeof x.text==='string').map(x=>x.text).join('\n').trim();
 }else{
  if(data.stop_reason==='refusal')throw fail('AI_REFUSAL');
  if(data.stop_reason!=='end_turn')throw fail('AI_INCOMPLETE');
  answer=(data.content||[]).filter(x=>x.type==='text'&&typeof x.text==='string').map(x=>x.text).join('\n').trim();
 }
 if(!answer||answer.length>60000)throw fail('AI_INCOMPLETE');
 if(onDelta)onDelta(answer);
 return {text:answer,usage:usageOf(provider,data),latencyMs:Date.now()-started,provider};
}
async function readStream(provider,r,onDelta,started){
 const reader=r.body.getReader(),dec=new TextDecoder();let buf='',text='',usage={},done=false,stop='';
 while(!done){
  const {value,done:end}=await reader.read();if(end)break;
  buf+=dec.decode(value,{stream:true});let i;
  while((i=buf.indexOf('\n\n'))>=0){
   const chunk=buf.slice(0,i);buf=buf.slice(i+2);
   const line=chunk.split('\n').find(l=>l.startsWith('data:'));if(!line)continue;
   const raw=line.slice(5).trim();if(raw==='[DONE]'){done=true;break;}
   let ev;try{ev=JSON.parse(raw);}catch{continue;}
   if(provider==='openai'){
    if(ev.type==='response.output_text.delta'&&ev.delta){text+=ev.delta;onDelta(ev.delta);}
    else if(ev.type==='response.refusal.delta')throw fail('AI_REFUSAL');
    else if(ev.type==='response.completed'){usage=usageOf('openai',ev.response);stop='completed';done=true;}
    else if(ev.type==='response.incomplete'||ev.type==='response.failed')throw fail('AI_INCOMPLETE');
   }else{
    if(ev.type==='content_block_delta'&&ev.delta?.type==='text_delta'){text+=ev.delta.text;onDelta(ev.delta.text);}
    else if(ev.type==='message_start')usage=usageOf('anthropic',ev.message);
    else if(ev.type==='message_delta'){stop=ev.delta?.stop_reason||stop;usage={...usage,outputTokens:ev.usage?.output_tokens??usage.outputTokens};}
    else if(ev.type==='message_stop')done=true;
    else if(ev.type==='error')throw fail('PROVIDER_UNAVAILABLE');
   }
  }
 }
 if(provider==='anthropic'&&stop==='refusal')throw fail('AI_REFUSAL');
 if(provider==='anthropic'&&stop&&stop!=='end_turn')throw fail('AI_INCOMPLETE');
 if(!text.trim())throw fail('AI_INCOMPLETE');
 return {text:text.trim(),usage,latencyMs:Date.now()-started,provider};
}

// Backwards-compatible helpers used by chat and existing callers.
export async function anthropicText({key,model,effort='default',system,text,image=null,schema=null,fetchImpl=fetch,signal,maxTokens=16000}){
 assertProviderModel('anthropic',model);
 return (await callModel({key,model,effort,system,text,image,schema,maxTokens,fetchImpl,signal})).text;
}
export async function callAnthropicDecision({key,model,effort,context,fetchImpl=fetch,timeoutMs=6000,signal,loadKnowledge=knowledge}){
 const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),timeoutMs),abort=()=>ctrl.abort();
 signal?.addEventListener('abort',abort,{once:true});
 try{
  if(signal?.aborted)throw fail('AI_TIMEOUT');
  const {instructions,examples,brain}=await loadKnowledge(context);
  if(ctrl.signal.aborted)throw fail('AI_TIMEOUT');
  const r=await callModel({key,model,effort,system:instructions,text:JSON.stringify({apexBrain:brain,referenceExamples:examples,market:context}),schema:DECISION_SCHEMA,fetchImpl,signal:ctrl.signal,maxTokens:12000});
  let raw;try{raw=JSON.parse(r.text);}catch{throw fail('SCHEMA_FAILURE');}
  return Object.defineProperty(validateDecision(raw),'__usage',{value:r.usage,enumerable:false});
 }catch(e){if(ctrl.signal.aborted||e.name==='AbortError')throw fail('AI_TIMEOUT');throw e;}
 finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}
