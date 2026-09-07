import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('license/session persistence contract is deployment-safe', () => {
  const server = fs.readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
  const service = fs.readFileSync(new URL('../deploy/xaucloud-apex.service', import.meta.url), 'utf8');

  assert.match(server, /const LEGACY_DATA=path\.join\(__dirname,'data'\)/);
  assert.match(server, /process\.env\.DATA_DIR\|\|LEGACY_DATA/);
  assert.match(server, /SESSION_TTL_DAYS/);
  assert.match(server, /async function migrateLegacyData/);
  assert.match(server, /licenseStatusFor\(licenses\[s\.lic\]\)/);

  assert.match(service, /StateDirectory=xaucloud-apex/);
  assert.match(service, /DATA_DIR=\/var\/lib\/xaucloud-apex/);
  assert.match(service, /SESSION_TTL_DAYS=3650/);
});
