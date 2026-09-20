import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const ea=await fs.readFile(new URL('../ea/XauCloud-Apex.mq5',import.meta.url),'utf8');
const server=await fs.readFile(new URL('../server.mjs',import.meta.url),'utf8');

function section(start,end){
  const a=ea.indexOf(start); assert.ok(a>=0,`missing ${start}`);
  const b=end?ea.indexOf(end,a+start.length):ea.length; assert.ok(b>a,`missing end ${end}`);
  return ea.slice(a,b);
}

test('direction authority uses confirmed M5/M15 swing structure instead of slope alone',()=>{
  const fn=section('DirectionAuthority EvaluateDirectionAuthority','bool DirectionPermits');
  assert.match(fn,/SwingSequenceDir\(m5,38/);
  assert.match(fn,/SwingSequenceDir\(m15,30/);
  assert.match(fn,/d\.m5Bos=StructureBreakDir/);
  assert.match(fn,/d\.m15Bos=StructureBreakDir/);
  assert.match(fn,/seqConflict/);
  assert.match(fn,/freshConflict/);
  assert.match(fn,/d\.transition=seqConflict\|\|freshConflict/);
});

test('confirmed opposite structure cannot be overridden by one M1 pressure spike',()=>{
  const permit=section('bool DirectionPermits','bool StructuralBreakoutContext');
  assert.match(permit,/if\(d\.transition\)return false/);
  assert.match(permit,/if\(d\.dir==dir&&d\.tier>=2\)return true/);
  assert.match(permit,/if\(breakout&&d\.dir==0&&d\.tier<=1\)/);
  assert.match(permit,/bos&&pressure/);
  assert.doesNotMatch(permit,/return true;\s*\/\/.*pressure/i);
});

test('breakouts are anchored to structural M5/M15 barriers, not raw M1 extrema',()=>{
  const fn=section('bool StructuralBreakoutContext','bool ProfessionalTrendPullback');
  assert.match(fn,/SwingSequenceDir\(m5/);
  assert.match(fn,/SwingSequenceDir\(m15/);
  assert.match(fn,/nearby M15 structural level/i);
  assert.match(fn,/Math\.abs\(i-last\)>=2|MathAbs\(i-last\)>=2/);
});

test('trend continuation requires a real corrective pullback and intact M5 structure',()=>{
  const fn=section('bool ProfessionalTrendPullback','bool IgnitionPattern');
  assert.match(fn,/if\(d\.dir!=dir\|\|d\.tier<2\|\|d\.transition\)return false/);
  assert.match(fn,/if\(opposing<2\)return false/);
  assert.match(fn,/avgOpp>atr\*\.45/);
  assert.match(fn,/structLow/);
  assert.match(fn,/structHigh/);
});

test('live ignition rejects wick spikes and requires meaningful pressure dominance',()=>{
  const fn=section('bool IgnitionPattern','string SetupWaitReason');
  assert.match(fn,/if\(age<4\)return false/);
  assert.match(fn,/badWick>\.32/);
  assert.match(fn,/activePressure-oppositePressure<8\.0/);
  assert.match(fn,/quality>=58/);
});

test('an armed setup is cancelled when tactical direction flips or enters transition',()=>{
  const obs=section('Snap Observe\(\)','double ScoreFloorGivenMandatory');
  assert.match(obs,/directionFlipped=da\.transition\|\|\(da\.dir!=0&&da\.tier>=2&&da\.dir!=S\.dir\)/);
  assert.match(obs,/DIRECTION_AUTHORITY_FLIPPED/);
  assert.match(obs,/DIRECTION_AUTHORITY_NOT_ALIGNED/);
});

test('L2/L3 cannot keep scaling after current market direction disagrees',()=>{
  const add=section('AddCandidate BuildAddCandidate','\/\/====================== basket management');
  assert.match(add,/EvaluateDirectionAuthority/);
  assert.match(add,/da\.transition\|\|da\.dir!=campDir\|\|da\.tier<2/);
  assert.match(add,/DIRECTION_AUTHORITY_NO_LONGER_CONFIRMS_CAMPAIGN/);
});

test('dashboard receives the same Direction Authority evidence emitted by the EA',()=>{
  for(const field of ['directionBias','directionTier','m5Structure','m15Structure','m5Bos','m15Bos','directionScoreGap','pressureGap','directionReason']){
    assert.ok(ea.includes(field),`EA missing ${field}`);
    assert.ok(server.includes(field),`server projection missing ${field}`);
  }
  assert.match(server,/BREAKOUT_TREND_DIRECTION_AUTHORITY/);
});
