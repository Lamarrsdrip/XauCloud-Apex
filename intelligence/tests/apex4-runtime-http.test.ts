import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('candidate routes commit demo events before acknowledging them and keep account scope and arming', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'apex4-http-test-'));
  process.env.NODE_ENV = 'test';
  process.env.DATA_DIR = dir;
  process.env.APEX4_CANDIDATE = '1';
  delete process.env.APEX_BRIDGE_SECRET;
  delete process.env.XAUCLOUD_BASE_URL;
  delete process.env.APEX4_LOCAL_EVIDENCE_DIR;
  delete process.env.APEX4_KNOWLEDGE_FILE;
  const { server } = await import('../../server.mjs');
  const license = 'APEX-000000-001000-000000';
  const account = '123456';
  await fs.writeFile(path.join(dir, 'licenses.json'), JSON.stringify({ [license]: { status: 'ACTIVE', account } }));
  await fs.writeFile(path.join(dir, 'config.json'), JSON.stringify({ armed: false }));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await fs.rm(dir, { recursive: true, force: true });
  });
  const address = server.address();
  const base = 'http://127.0.0.1:' + (typeof address === 'object' ? address?.port : 0);
  const post = (route: string, payload: unknown) => fetch(base + route, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload)
  });
  const now = Date.now();
  const opening = { kind: 'DEAL', dealId: '11', positionId: '22', atMs: now, entry: 'IN', direction: 'BUY',
    price: 3500.2, volume: .01, commission: -.01, swap: 0, profit: 0, fee: 0, reason: 'EXPERT' };
  const payload = { license, account, environment: 'DEMO', events: [opening], quote: { bid: 3500, ask: 3500.2, atMs: now },
    bars: [], brokerServer: 'EXNESS-DEMO' };
  const invalid = await post('/api/apex/v4/market', { ...payload, events: [{ ...opening, price: 'invalid' }] });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.headers.get('x-apex-events'), null);
  const wrongAccount = await post('/api/apex/v4/market', { ...payload, account: 'other' });
  assert.equal(wrongAccount.status, 403);
  assert.equal(wrongAccount.headers.get('x-apex-events'), null);
  const live = await post('/api/apex/v4/market', { ...payload, environment: 'REAL' });
  assert.equal(live.status, 403);
  assert.equal(live.headers.get('x-apex-events'), null);
  const disarmed = await post('/api/apex/v4/market', { ...payload, quote: { ...payload.quote, atMs: Date.now() } });
  assert.equal(disarmed.headers.get('x-apex-events'), 'committed');
  assert.equal(await disarmed.text(), 'NONE|NOT_ARMED');
  const replay = await post('/api/apex/v4/events', payload);
  assert.deepEqual(await replay.json(), { accepted: 1, stored: 0 });
  const login = await post('/api/auth/login', { license });
  assert.equal(login.status, 200);
  const session = login.headers.get('set-cookie')?.split(';')[0] ?? '';
  const readDashboard = async () => (await fetch(base + '/api/auth/me', { headers: { cookie: session } })).json();
  const me = await readDashboard();
  assert.equal(me.candidate.learning.observations, 1);
  assert.equal(me.candidate.learning.decisions, 1);
  assert.equal(me.candidate.learning.brokerDeals, 0, 'unlinked broker events do not become confirmed Apex fills');
  assert.equal(me.candidate.latestDecision.status, 'NEED_HISTORY');
  assert.equal(me.candidate.m10.status, 'NOT_CONFIGURED');
  assert.equal(me.candidate.modelExecution, false);
  const promotion = await post('/api/admin/apex4/knowledge', { license, account, action: 'PROMOTE', versionId: 'a'.repeat(24) });
  assert.equal(promotion.status, 401);

  const { canonicalSourceCommit, canonicalSourceSha256 } = await import('../apex4-canonical-evidence.mjs');
  process.env.APEX4_LOCAL_EVIDENCE_DIR = dir;
  process.env.APEX4_CANONICAL_SOURCE_COMMIT = canonicalSourceCommit;
  const scope = createHash('sha256').update(license + '|' + account).digest('hex');
  const observedAt = Date.now();
  const freshQuote = { ...payload.quote, atMs: observedAt };
  await fs.writeFile(path.join(dir, scope + '.json'), JSON.stringify({
    schema: 'XAUCLOUD_CANONICAL_M10_EVIDENCE_V1', sourceCommit: canonicalSourceCommit, sourceSha256: canonicalSourceSha256,
    environment: 'DEMO', account, symbol: 'XAUUSD', brokerSymbol: 'XAUUSDm', brokerServer: 'EXNESS-DEMO',
    htfComplete: true, thesis: {}, quote: freshQuote, observedAt,
    m10Signal: { primary_timeframe: 'M10', freshness_state: 'FRESH', build_hash: 'xaucloud-v6291-signal-plan-execution-20261127',
      account, symbol: 'XAUUSDm', evidence_id: 7, confidence: 72, decision: 'BUY_CANDIDATE' }
  }));
  assert.equal((await post('/api/apex/v4/market', { ...payload, quote: freshQuote })).status, 200);
  const dashboard = await readDashboard();
  assert.equal(dashboard.candidate.knowledge.loaded, false);
  assert.equal(dashboard.candidate.m10.sourceCommit, canonicalSourceCommit);
  assert.equal(dashboard.candidate.m10.evidenceId, 7);
  assert.equal(dashboard.candidate.m10.confidence, 72);
  assert.equal(dashboard.candidate.m10.direction, 'BUY');
  assert.equal(dashboard.candidate.plan, null);
});
