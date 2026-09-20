import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const ea=await fs.readFile(new URL('../ea/XauCloud-Apex.mq5',import.meta.url),'utf8');
const server=await fs.readFile(new URL('../server.mjs',import.meta.url),'utf8');
const ui=await fs.readFile(new URL('../public/index.html',import.meta.url),'utf8');

function section(start,end){
  const a=ea.indexOf(start); assert.ok(a>=0,`missing ${start}`);
  const b=end?ea.indexOf(end,a+start.length):ea.length; assert.ok(b>a,`missing end ${end}`);
  return ea.slice(a,b);
}

test('v3.9.2 separates slow structure from fresh M5/M15/M30 flow',()=>{
  assert.match(ea,/XauCloud-Apex_v3\.9\.2-FreshDirection/);
  assert.match(ea,/PERIOD_M30/);
  const fresh=section('int FreshFlowDir','void ResolveFreshConsensus');
  for(const x of ['ClosedEMA(r,8,1)','ClosedEMA(r,21,1)','move4','move8','bullPts','bearPts']) assert.ok(fresh.includes(x),x);
  const consensus=section('void ResolveFreshConsensus','DirectionAuthority EvaluateDirectionAuthority');
  assert.match(consensus,/d\.m5Flow=FreshFlowDir/);
  assert.match(consensus,/d\.m15Flow=FreshFlowDir/);
  assert.match(consensus,/d\.m30Flow=FreshFlowDir/);
});

test('slow structural bias cannot authorize an entry when fresh direction disagrees',()=>{
  const fn=section('DirectionAuthority EvaluateDirectionAuthority','bool DirectionPermits');
  assert.match(fn,/d\.structuralDir==d\.freshDir/);
  assert.match(fn,/SLOW_FRESH_CONFLICT_WAIT/);
  assert.match(fn,/FRESH_DIRECTION_WAIT/);
  assert.match(fn,/freshBos&&d\.freshTier>=3/);
  assert.match(fn,/FRESH_REVERSAL_CONFIRMED_/);
});

test('neutral slow structure requires full three-timeframe fresh consensus',()=>{
  const fn=section('DirectionAuthority EvaluateDirectionAuthority','bool DirectionPermits');
  assert.match(fn,/d\.structuralDir==0&&!structuralTransition&&d\.freshTier>=3/);
  assert.match(fn,/FULL_FRESH_/);
});

test('DirectionPermits requires the final authority and fresh flow to name the same side',()=>{
  const permit=section('bool DirectionPermits','bool StructuralBreakoutContext');
  assert.match(permit,/d\.transition\|\|d\.dir!=dir\|\|d\.tier<2/);
  assert.match(permit,/d\.freshDir!=dir\|\|d\.freshTier<2/);
  assert.match(permit,/d\.pressureGap<8\.0/);
  assert.match(permit,/d\.pressureGap>-8\.0/);
  assert.doesNotMatch(permit,/d\.dir==0.*breakout/);
});

test('breakouts remain anchored to structural M5/M15 barriers, not raw M1 extrema',()=>{
  const fn=section('bool StructuralBreakoutContext','bool ProfessionalTrendPullback');
  assert.match(fn,/SwingSequenceDir\(m5/);
  assert.match(fn,/SwingSequenceDir\(m15/);
  assert.match(fn,/nearby M15 structural level/i);
  assert.match(fn,/MathAbs\(i-last\)>=2/);
});

test('trend continuation still requires corrective pullback with intact M5 structure',()=>{
  const fn=section('bool ProfessionalTrendPullback','bool IgnitionPattern');
  assert.match(fn,/if\(d\.dir!=dir\|\|d\.tier<2\|\|d\.transition\)return false/);
  assert.match(fn,/if\(opposing<2\)return false/);
  assert.match(fn,/avgOpp>atr\*\.45/);
  assert.match(fn,/structLow/);
  assert.match(fn,/structHigh/);
});

test('live ignition rejects wick spikes and requires pressure dominance',()=>{
  const fn=section('bool IgnitionPattern','string SetupWaitReason');
  assert.match(fn,/if\(age<4\)return false/);
  assert.match(fn,/badWick>\.32/);
  assert.match(fn,/activePressure-oppositePressure<8\.0/);
  assert.match(fn,/quality>=58/);
});

test('an armed setup is invalidated by a fresh opposite direction',()=>{
  const obs=section('Snap Observe()','double ScoreFloorGivenMandatory');
  assert.match(obs,/da\.freshDir!=0&&da\.freshTier>=2&&da\.freshDir!=S\.dir/);
  assert.match(obs,/DIRECTION_AUTHORITY_FLIPPED/);
  assert.match(obs,/DIRECTION_AUTHORITY_NOT_ALIGNED/);
});

test('L2/L3 cannot scale after fresh market direction stops confirming the campaign',()=>{
  const add=section('AddCandidate BuildAddCandidate','//====================== basket management');
  assert.match(add,/PERIOD_M30/);
  assert.match(add,/EvaluateDirectionAuthority\(m5,m15,m30/);
  assert.match(add,/da\.freshDir!=campDir\|\|da\.freshTier<2/);
  assert.match(add,/FRESH_DIRECTION_NO_LONGER_CONFIRMS_CAMPAIGN/);
});

test('signal-to-execution direction contract fails closed on any mismatch',()=>{
  const start=section('void Start(Snap &s)','//====================== add candidates');
  assert.match(start,/s\.dir!=s\.directionBias\|\|s\.freshDirection!=s\.dir/);
  assert.match(start,/DIRECTION_CONTRACT_BLOCK/);
  const open=section('bool OpenLayer(','//====================== closing');
  assert.match(open,/campDir!=0&&dir!=campDir/);
  assert.match(open,/layers==0&&S\.dir!=0&&dir!=S\.dir/);
  assert.match(open,/OPEN_LAYER_DIRECTION_MISMATCH/);
});

test('dashboard receives slow and fresh direction evidence from the same EA telemetry',()=>{
  for(const field of ['directionBias','directionTier','structuralBias','freshDirection','freshDirectionTier','m5Flow','m15Flow','m30Flow','m5FlowStrength','m15FlowStrength','m30FlowStrength','directionReason','freshDirectionReason']){
    assert.ok(ea.includes(field),`EA missing ${field}`);
    assert.ok(server.includes(field),`server missing ${field}`);
  }
  assert.match(server,/FRESH_DIRECTION_BREAKOUT_TREND/);
  assert.match(ui,/Fresh M5 \/ M15 \/ M30/);
  assert.match(ui,/Slow structure bias/);
  assert.match(ui,/Fresh-flow reason/);
});
