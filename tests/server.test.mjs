import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {clean,learn} from '../server.mjs';

test('defaults match aggressive requested ladder',()=>{const c=JSON.parse(fs.readFileSync(new URL('../data/config.json',import.meta.url)));assert.equal(c.baseMarginPct,15);assert.equal(c.layerMultiplier,2);assert.equal(c.maxLayers,0);assert.equal(c.cooldownMinutes,0)});

test('clean() bounds and defaults untrusted input',()=>{
 const c=clean({baseMarginPct:'not a number',layerMultiplier:999,maxLayers:-5,targetMode:'BOGUS'});
 assert.equal(c.baseMarginPct,15);
 assert.equal(c.layerMultiplier,10);
 assert.equal(c.maxLayers,0);
 assert.equal(c.targetMode,'MULTIPLIER');
});

const cfg=clean({learningEnabled:true,learningMinCampaigns:8,learningMaxScoreAdjustment:5});

function campaign(id,{outcome,impulseMult,wickRatio,m3,m5}){
 return [
  {type:'CAMPAIGN_START',campaignId:id,signature:'SELL_UPSIDE_LIQUIDITY_EXHAUST',impulseMult,wickRatio,m3,m5},
  {type:'CAMPAIGN_END',campaignId:id,signature:'SELL_UPSIDE_LIQUIDITY_EXHAUST',outcome,mfe:100,mae:-20,layers:3},
 ];
}

test('learn() stays OBSERVATION_ONLY below the minimum sample and applies no score adjustment',()=>{
 const events=[...campaign('c1',{outcome:'TARGET_HIT',impulseMult:2.5,wickRatio:3.5,m3:true,m5:true})];
 const model=learn(events,cfg);
 assert.equal(model.authority,'OBSERVATION_ONLY');
 assert.equal(model.entryScoreAdjustment,0);
 assert.equal(model.addScoreAdjustment,0);
 assert.equal(model.completedCampaigns,1);
});

test('learn() switches to BOUNDED_ADAPTIVE only once the minimum sample is met',()=>{
 const events=[];
 for(let i=0;i<8;i++)events.push(...campaign('c'+i,{outcome:i<5?'TARGET_HIT':'STOPPED_OUT',impulseMult:2.5,wickRatio:3.5,m3:true,m5:true}));
 const model=learn(events,cfg);
 assert.equal(model.completedCampaigns,8);
 assert.equal(model.targetHits,5);
 assert.equal(model.authority,'BOUNDED_ADAPTIVE');
 assert.ok(Math.abs(model.entryScoreAdjustment)<=cfg.learningMaxScoreAdjustment);
});

test('learn() joins CAMPAIGN_START features to CAMPAIGN_END outcome by campaignId, bucketed and sample-gated',()=>{
 const events=[];
 // 6 high-impulse wins -> enough samples to report a real winRate for the high bucket
 for(let i=0;i<6;i++)events.push(...campaign('hi'+i,{outcome:'TARGET_HIT',impulseMult:2.5,wickRatio:3.5,m3:true,m5:true}));
 // 2 low-impulse losses -> below FEATURE_MIN_SAMPLE, must not report a confident winRate
 for(let i=0;i<2;i++)events.push(...campaign('lo'+i,{outcome:'STOPPED_OUT',impulseMult:0.5,wickRatio:1.0,m3:false,m5:false}));
 const model=learn(events,cfg);
 const hi=model.featureInsights.impulseMult['impulse_high(>=2x_ATR)'];
 assert.equal(hi.campaigns,6);
 assert.equal(hi.winRate,1);
 const lo=model.featureInsights.impulseMult['impulse_low(<1.0x_ATR)'];
 assert.equal(lo.campaigns,2);
 assert.equal(lo.winRate,null);
 assert.match(lo.note,/insufficient_sample/);
});

test('learn() ignores a CAMPAIGN_END with no matching CAMPAIGN_START for feature bucketing but still counts it in the aggregate rate',()=>{
 const orphanEnd=[{type:'CAMPAIGN_END',campaignId:'no-start-here',signature:'X',outcome:'TARGET_HIT',mfe:1,mae:-1,layers:1}];
 const model=learn(orphanEnd,cfg);
 assert.equal(model.completedCampaigns,1);
 assert.deepEqual(model.featureInsights,{});
});
