import crypto from 'node:crypto';

export const KNOWLEDGE_VERSION = 'tradingcartel-breakfast-v1';
export const DEFAULT_MODEL = 'gpt-6-astra'; // verified 2026-10-16 at developers.openai.com/api/docs/models/gpt-6-astra
// Reasoning models spend latency before answering; decisions expire after 8s.
export const REASONING_EFFORTS = ['default','none','low','medium','high','xhigh'];
export const DEFAULT_REASONING_EFFORT = 'low';
// Every live request is billed to the user's own key. The server refuses to
// spend beyond this many model requests per UTC day; native Lifestyle trades on.
export const DEFAULT_DAILY_REQUEST_LIMIT = 500;
export function dailyRequestLimit(value=DEFAULT_DAILY_REQUEST_LIMIT) {
  if(!Number.isInteger(value)||value<10||value>5000) throw new Error('INVALID_DAILY_REQUEST_LIMIT');
  return value;
}
export const ACTIONS = ['WAIT','ENTER_BUY','ENTER_SELL','ADD','HOLD','STOP_ADDING','REDUCE','EXIT'];
export const STATES = ['NO_SETUP','WATCHING','APPROACH','IMPULSE','EXTREME_TEST','SWEEP','REJECTION_PENDING','REJECTION','FRESH_PROOF','ENTRY_READY','ENTRY_ACTIVE','CONTINUATION','ADD_READY','EXPANSION','THESIS_WEAKENING','INVALID','EXIT'];
const unit = { type:'number', minimum:0, maximum:1 };
const properties = {
  strategyVersion:{type:'string',enum:[KNOWLEDGE_VERSION]},
  state:{type:'string',enum:STATES}, action:{type:'string',enum:ACTIONS},
  direction:{type:'string',enum:['BUY','SELL','NONE']},
  setupFamily:{type:'string',enum:['NONE','UPPER_FAILURE_PROBE','LOWER_FAILURE_PROBE','UPPER_SWEEP_REJECTION','LOWER_SWEEP_REJECTION','FAILED_RECOVERY_CONTINUATION','FAILED_PULLBACK','CONTINUATION']},
  confidence:unit, setupQuality:unit, locationQuality:unit, freshness:unit,
  extensionRisk:unit, continuationQuality:unit, thesisValid:{type:'boolean'},
  invalidationPrice:{type:'number',minimum:0},
  reasonCodes:{type:'array',items:{type:'string',pattern:'^[A-Z][A-Z0-9_]{0,63}$'},minItems:1,maxItems:8}
};
export const DECISION_SCHEMA = {type:'object',additionalProperties:false,properties,required:Object.keys(properties)};

export function modelId(value=DEFAULT_MODEL) {
  if(typeof value!=='string'||!value.length||value.length>160||!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)) throw new Error('INVALID_MODEL');
  return value;
}

// Structured Outputs constrains API generation. This independent validator also
// rejects transport corruption, refusal, incomplete output and semantic mismatches.
export function reasoningEffort(value=DEFAULT_REASONING_EFFORT) {
  if(!REASONING_EFFORTS.includes(value)) throw new Error('INVALID_REASONING_EFFORT');
  return value;
}

export function validateDecision(value) {
  if(!value||typeof value!=='object'||Array.isArray(value)) throw new Error('SCHEMA_FAILURE');
  if(Object.keys(value).length!==Object.keys(properties).length) throw new Error('SCHEMA_FAILURE');
  for(const [name,spec] of Object.entries(properties)) {
    const item=value[name];
    if(spec.type==='array') {
      if(!Array.isArray(item)||item.length<1||item.length>8||item.some(x=>typeof x!=='string'||!/^[A-Z][A-Z0-9_]{0,63}$/.test(x))) throw new Error('SCHEMA_FAILURE');
    } else if(typeof item!==spec.type) throw new Error('SCHEMA_FAILURE');
    else if(spec.enum&&!spec.enum.includes(item)) throw new Error('SCHEMA_FAILURE');
    else if(spec.type==='number'&&(!Number.isFinite(item)||item<(spec.minimum??-Infinity)||item>(spec.maximum??Infinity))) throw new Error('SCHEMA_FAILURE');
  }
  if(value.action==='ENTER_BUY'&&value.direction!=='BUY') throw new Error('DIRECTION_MISMATCH');
  if(value.action==='ENTER_SELL'&&value.direction!=='SELL') throw new Error('DIRECTION_MISMATCH');
  if(['ENTER_BUY','ENTER_SELL','ADD'].includes(value.action)&&(!value.thesisValid||value.invalidationPrice<=0)) throw new Error('INVALID_THESIS');
  if(value.action==='ADD'&&value.state!=='ADD_READY'&&value.state!=='EXPANSION') throw new Error('ACTION_STATE_MISMATCH');
  if(value.action.startsWith('ENTER_')&&value.state!=='ENTRY_READY') throw new Error('ACTION_STATE_MISMATCH');
  return value;
}

export function bindDecision(raw,context,{now=Date.now(),ttlMs=8000,requestId=crypto.randomUUID()}={}) {
  const decision=validateDecision(raw), c=context.campaign;
  if(decision.action.startsWith('ENTER_')&&c.positions.length) throw new Error('CAMPAIGN_CONFLICT');
  if(['ADD','HOLD','STOP_ADDING','REDUCE','EXIT'].includes(decision.action)&&!c.positions.length) throw new Error('NO_CAMPAIGN');
  if(c.positions.length&&c.owner!=='ASTRA') throw new Error('NATIVE_CAMPAIGN_OWNS_STRATEGY');
  if(c.positions.length&&decision.direction!==c.direction) throw new Error('CAMPAIGN_DIRECTION_CONFLICT');
  if(decision.action==='ADD'&&c.basketProfit<=0) throw new Error('NO_WINNER_PROOF');
  if(['ENTER_BUY','ENTER_SELL','ADD'].includes(decision.action)) {
    const price=decision.direction==='BUY'?context.quote.ask:context.quote.bid;
    if(decision.direction==='BUY'?decision.invalidationPrice>=price:decision.invalidationPrice<=price) throw new Error('INVALIDATION_WRONG_SIDE');
  }
  // A trigger is a market-prefix identity, never a model-created arbitrary string.
  const triggerId=crypto.createHash('sha256').update(JSON.stringify({symbol:context.symbol,campaign:c.id,
    direction:decision.direction,family:decision.setupFamily,event:context.structure.eventKey})).digest('hex').slice(0,32);
  return {...decision,decisionId:requestId,requestId,snapshotId:context.snapshotId,
    createdAtMs:now,expiresAtMs:Math.min(now+ttlMs,context.observedAtMs+ttlMs),
    referenceBid:context.quote.bid,referenceAsk:context.quote.ask,maxDriftAtr:0.5,atr:context.structure.atr,
    expectedCampaignId:c.id,expectedLayers:c.layers,triggerId};
}
