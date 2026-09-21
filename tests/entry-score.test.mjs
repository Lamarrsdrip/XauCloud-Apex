// Proves that the dashboard Entry Score setting really changes the live EA threshold,
// and that the score is a THRESHOLD -- never permission to bypass the setup structure.
//
// The truth table below is evaluated against the decision expression READ OUT OF THE
// REAL ea/XauCloud-Apex.mq5, so it fails if that line is ever rewritten.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const ea = fs.readFileSync(new URL('../ea/XauCloud-Apex.mq5', import.meta.url), 'utf8');
const server = fs.readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');

// ---- the two lines that decide an entry, lifted verbatim -------------------
// NB: `s.valid=false;` appears earlier as an initialiser -- anchor on the decision.
const validLine = ea.match(/s\.valid=(s\.rejected[^;]+);/)?.[1];
// NB: the ADD threshold (C.addScore) appears later -- anchor on the ENTRY one.
const thresholdLine = ea.match(/double threshold=(C\.entryScore[^;]+);/)?.[1];

test('SCORE: the EA decision line is the documented rule', () => {
  assert.ok(validLine, 's.valid=... must exist');
  assert.equal(
    validLine.replace(/\s+/g, ''),
    's.rejected&&s.microBreak&&m3Gate&&m5Gate&&s.score>=threshold',
    'entry requires rejection AND BOS AND M3 gate AND M5 gate AND score>=threshold');
  assert.equal(
    thresholdLine.replace(/\s+/g, ''),
    'C.entryScore+(C.learningEnabled?C.learnEntryAdj:0)',
    'effective threshold = configured entryScore + learning adjustment');
});

// Evaluate the REAL expression rather than a paraphrase of it.
function decide({ rejected, microBreak, m3Gate, m5Gate, score, entryScore,
                  learningEnabled = false, learnEntryAdj = 0 }) {
  const C = { entryScore, learningEnabled, learnEntryAdj };
  const threshold = eval(thresholdLine.replace(/C\./g, 'C.'));
  const s = { rejected, microBreak, score };
  const valid = eval(validLine);
  const waitReason = !s.rejected ? 'REJECTION'
    : !s.microBreak ? 'BOS'
    : !m3Gate ? 'M3'
    : !m5Gate ? 'M5'
    : s.score < threshold ? 'SCORE' : '';
  return { valid, threshold, waitReason };
}

test('SCORE: entryScore=60 with score=70 PASSES the score gate', () => {
  const r = decide({ rejected: true, microBreak: true, m3Gate: true, m5Gate: true,
                     score: 70, entryScore: 60 });
  assert.equal(r.threshold, 60, 'the configured 60 must be the effective threshold');
  assert.equal(r.valid, true);
  assert.equal(r.waitReason, '');
});

test('SCORE: 70/60 still WAITS when the mandatory REJECTION gate is missing', () => {
  // This is the exact terminal line the owner saw:
  //   score=70.0/60.0 rejection=WAIT bos=PASS m3=PASS m5=OPTIONAL waiting=REJECTION
  const r = decide({ rejected: false, microBreak: true, m3Gate: true, m5Gate: true,
                     score: 70, entryScore: 60 });
  assert.equal(r.threshold, 60);
  assert.equal(r.valid, false, 'a passing score must NOT bypass the setup structure');
  assert.equal(r.waitReason, 'REJECTION');
});

test('SCORE: a passing score never bypasses BOS or a required M3/M5 gate', () => {
  assert.equal(decide({ rejected: true, microBreak: false, m3Gate: true, m5Gate: true,
                        score: 99, entryScore: 60 }).valid, false);
  assert.equal(decide({ rejected: true, microBreak: true, m3Gate: false, m5Gate: true,
                        score: 99, entryScore: 60 }).valid, false);
  assert.equal(decide({ rejected: true, microBreak: true, m3Gate: true, m5Gate: false,
                        score: 99, entryScore: 60 }).valid, false);
});

test('SCORE: entryScore=76 with score=70 blocks on SCORE once every gate passes', () => {
  const r = decide({ rejected: true, microBreak: true, m3Gate: true, m5Gate: true,
                     score: 70, entryScore: 76 });
  assert.equal(r.threshold, 76);
  assert.equal(r.valid, false);
  assert.equal(r.waitReason, 'SCORE', 'the default 76 must genuinely bind when configured');
});

test('SCORE: the learning adjustment is transparent and additive', () => {
  const off = decide({ rejected: true, microBreak: true, m3Gate: true, m5Gate: true,
                       score: 62, entryScore: 60, learningEnabled: false, learnEntryAdj: 3 });
  assert.equal(off.threshold, 60, 'disabled learning must not move the threshold');
  assert.equal(off.valid, true);

  const on = decide({ rejected: true, microBreak: true, m3Gate: true, m5Gate: true,
                      score: 62, entryScore: 60, learningEnabled: true, learnEntryAdj: 3 });
  assert.equal(on.threshold, 63, 'configured 60 + adjustment 3 == effective 63');
  assert.equal(on.valid, false, 'score 62 is below the effective 63');
  assert.equal(on.waitReason, 'SCORE');
});

// ---- the configuration path the owner asked to be proven ------------------
test('SCORE: entryScore reaches the EA as a FLAT config key, not nested', () => {
  // Server: validated in the schema...
  assert.match(server, /entryScore:\{t:'num',d:76,min:40,max:100\}/);
  // ...and configEnvelope spreads the config flat, which is what the EA parses.
  assert.match(server, /function configEnvelope\(cfg,\{[^)]*\)\{\s*return \{\.\.\.clean\(cfg\)/);
  // EA: reads that flat key, seeded by the compiled-in default only when absent.
  assert.match(ea, /out\.entryScore\s*=CfgNum\("entryScore",out\.entryScore\)/);
  assert.match(ea, /C\.entryScore=76/, 'the compiled-in default must remain 76');
});

test('SCORE: the learning adjustment is currently hard zero at the server', () => {
  // APEX-AUDIT-026: observation only, no trained model, adjustments forced to zero.
  assert.match(server, /entryScoreAdjustment:0,addScoreAdjustment:0,authority:'OBSERVATION_ONLY'/);
  assert.match(server, /adaptationImplemented:false/);
  // ...so with the shipped server, effective threshold == configured entryScore.
  assert.match(ea, /C\.learnEntryAdj=0/, 'the EA default adjustment must also be zero');
});

test('SCORE: telemetry exposes score, threshold and every gate separately', () => {
  // The owner must be able to see WHY a 70/60 setup is still waiting.
  for (const field of ['requiredScore', 'scoreFloorGivenMandatory']) {
    assert.ok(ea.includes(field), `setup telemetry must expose ${field}`);
  }
  assert.match(ea, /EmitSetupTelemetry\(s,m3Available,m5Available,m3Gate,m5Gate,threshold\)/);
});
