import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createReleaseStore } from '../release-store.mjs';

test('a release is not advertised until a matching compiled binary is published', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'apex-release-'));
  try {
    const store = createReleaseStore({ dataDir, expectedVersion: '3.10.0' });
    assert.deepEqual(await store.status(), {
      available: false, version: '3.10.0', reason: 'compiled_release_not_published'
    });
    const binary = crypto.randomBytes(20_000);
    await assert.rejects(() => store.publish({
      version: '2.2.0', confirmed: true, fileBase64: binary.toString('base64')
    }), /release_version_must_match_current_source/);
    await assert.rejects(() => store.publish({
      version: '3.10.0', confirmed: false, fileBase64: binary.toString('base64')
    }), /compile_confirmation_required/);
    const release = await store.publish({
      version: '3.10.0', confirmed: true, fileBase64: binary.toString('base64')
    });
    assert.equal(release.available, true);
    assert.equal(release.filename, 'XauCloud-Apex-v3.10.0.ex5');
    assert.equal(release.sha256, crypto.createHash('sha256').update(binary).digest('hex'));
    assert.deepEqual((await store.binary()).data, binary);

    // Disk tampering must fail closed, not serve an unverified file.
    const meta = JSON.parse(await fs.readFile(path.join(dataDir, 'bot-releases/latest.json'), 'utf8'));
    await fs.writeFile(path.join(dataDir, 'bot-releases', meta.file), Buffer.alloc(binary.length));
    await assert.rejects(() => store.binary(), /compiled_release_integrity_failed/);
    assert.equal((await createReleaseStore({ dataDir, expectedVersion: '3.10.1' }).status()).available, false);
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test('compiled EX5 downloads require an active license; upload and email are admin-only', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'apex-release-http-'));
  const adminToken = 'local-test-admin-token-for-release-only';
  Object.assign(process.env, {
    NODE_ENV: 'test', DATA_DIR: dataDir, ADMIN_TOKEN: adminToken,
    SESSION_SECRET: 'long-local-release-test-session-secret-that-is-not-live'
  });
  const mod = await import('../server.mjs?release-test-' + crypto.randomUUID());
  const key = 'APEX-ABCDEF-123456-789ABC';
  await fs.writeFile(path.join(dataDir, 'licenses.json'), JSON.stringify({
    [key]: { status: 'ACTIVE', account: '', createdAt: new Date().toISOString() }
  }));
  await new Promise(resolve => mod.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${mod.server.address().port}`;
  const auth = { authorization: 'Bearer ' + adminToken, 'content-type': 'application/json' };
  try {
    let response = await fetch(base + '/api/admin/release');
    assert.equal(response.status, 401);
    response = await fetch(base + '/api/admin/release', { headers: auth });
    assert.equal((await response.json()).release.available, false);

    const binary = crypto.randomBytes(24_000);
    response = await fetch(base + '/api/admin/release', {
      method: 'POST', headers: auth,
      body: JSON.stringify({ version: '3.10.0', fileBase64: binary.toString('base64'), confirmed: true })
    });
    assert.equal(response.status, 200);

    response = await fetch(base + '/api/session/bot/download');
    assert.equal(response.status, 401);

    response = await fetch(base + '/api/auth/login', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ license: key })
    });
    assert.equal(response.status, 200);
    const cookie = response.headers.get('set-cookie').split(';')[0];
    response = await fetch(base + '/api/session/bot/download', { headers: { cookie } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'application/octet-stream');
    assert.match(response.headers.get('content-disposition'), /XauCloud-Apex-v3.10.0.ex5/);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), binary);

    // Email must never be attempted without the verified XauCloud bridge.
    response = await fetch(base + '/api/admin/install-email', {
      method: 'POST', headers: auth, body: JSON.stringify({ recipient: 'customer@example.com', license: key })
    });
    assert.equal(response.status, 503);

    response = await fetch(base + '/api/admin/licenses', {
      method: 'POST', headers: auth, body: JSON.stringify({ key, status: 'DISABLED' })
    });
    assert.equal(response.status, 200);
    response = await fetch(base + '/api/session/bot/download', { headers: { cookie } });
    assert.equal(response.status, 401);
  } finally {
    await new Promise(resolve => mod.server.close(resolve));
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});
