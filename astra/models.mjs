// Supported reasoning models. IDs, vision, structured-output and effort support
// were read from the official provider documentation on 2026-11-25
// (developers.openai.com/api/docs/models/*, platform.claude.com/docs/en/about-claude/models/overview,
// platform.claude.com/docs/en/build-with-claude/effort). Connection tests in the
// product verify each one against the customer's own key.
export const MODELS=[
  {id:'gpt-6-luna',provider:'openai',label:'Luna',tier:'Fast / economical · default',efforts:['none','low','medium','high','xhigh','max'],vision:true,structured:true,recommended:true},
  {id:'gpt-6.2-astra',provider:'openai',label:'Astra',tier:'Flagship reasoning',efforts:['low','medium','high','xhigh','max'],vision:true,structured:true},
  {id:'gpt-6.2-sol',provider:'openai',label:'Sol',tier:'Balanced',efforts:['low','medium','high','xhigh','max'],vision:true,structured:true},
  {id:'gpt-6.1-terra',provider:'openai',label:'Terra',tier:'Visual reasoning',efforts:['none','low','medium','high','xhigh','max'],vision:true,structured:true},
  {id:'gpt-6-astra',provider:'openai',label:'Astra (previous)',tier:'Previous flagship',efforts:['low','medium','high','xhigh','max'],vision:true,structured:true,legacy:true},
  {id:'claude-opus-5-5',provider:'anthropic',label:'Opus',tier:'Most capable Opus',efforts:['low','medium','high','xhigh','max'],vision:true,structured:true,recommended:true},
  {id:'claude-fable-5-2',provider:'anthropic',label:'Fable',tier:'Frontier reasoning',efforts:['low','medium','high','xhigh','max'],vision:true,structured:true},
  {id:'claude-sonnet-5-5',provider:'anthropic',label:'Sonnet',tier:'Balanced',efforts:['low','medium','high','xhigh','max'],vision:true,structured:true},
  {id:'claude-haiku-5-5',provider:'anthropic',label:'Haiku',tier:'Fast / economical',efforts:['low','medium','high','xhigh','max'],vision:true,structured:true}
];
export const DEFAULT_MODEL_BY_PROVIDER={openai:'gpt-6-luna',anthropic:'claude-opus-5-5'};
export function modelInfo(id){return MODELS.find(m=>m.id===id)||null;}
export function modelsFor(provider){return MODELS.filter(m=>m.provider===provider);}
/** 'default' means "send no effort field" and lets the provider choose. */
export function effortAllowed(model,effort){
  if(effort==='default')return true;
  const m=modelInfo(model);
  // Unknown (custom) IDs keep the shared subset both providers accept.
  return m?m.efforts.includes(effort):['low','medium','high'].includes(effort);
}
/** The effort actually sent: invalid combinations fall back to the provider default instead of a 400. */
export function effectiveEffort(model,effort){return effort&&effort!=='default'&&effortAllowed(model,effort)?effort:'default';}
