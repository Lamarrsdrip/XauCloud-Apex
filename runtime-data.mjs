import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

function stamp() { return new Date().toISOString().replace(/[:.]/g, '-'); }
async function exists(p) { try { await fs.access(p); return true; } catch { return false; } }
async function readJson(p) {
  const raw = await fs.readFile(p, 'utf8');
  if (!raw.trim()) return {};
  try { return JSON.parse(raw); }
  catch { throw new Error(`PERSISTENCE_CORRUPT:${path.basename(p)}`); }
}
async function atomicJson(file, obj) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${crypto.randomUUID()}`;
  await fs.writeFile(tmp, JSON.stringify(obj, null, 2));
  await fs.rename(tmp, file);
}

export function resolvePersistentDataDir({ legacyDataDir, env = process.env, isProduction = env.NODE_ENV === 'production' } = {}) {
  const configured = String(env.DATA_DIR || '').trim();
  // In production, only an ABSOLUTE DATA_DIR is treated as an intentional persistent
  // mount. Historical `DATA_DIR=./data` resolves inside the release checkout and is
  // therefore migrated to the stable per-user store instead of being trusted forever.
  if (configured && (!isProduction || path.isAbsolute(configured))) return path.resolve(configured);
  if (!isProduction) return path.resolve(legacyDataDir);
  const home = String(env.HOME || env.USERPROFILE || '').trim();
  return home ? path.resolve(home, '.xaucloud-apex') : path.resolve(legacyDataDir);
}

async function copyIfMissing(src, dst) {
  if (!(await exists(src)) || (await exists(dst))) return false;
  await fs.mkdir(path.dirname(dst), { recursive: true });
  await fs.copyFile(src, dst);
  return true;
}

async function mergeObjectJson(src, dst) {
  if (!(await exists(src))) return { changed: false, sourceEntries: 0, destEntries: 0 };
  const source = await readJson(src);
  const current = (await exists(dst)) ? await readJson(dst) : {};
  if (!source || Array.isArray(source) || typeof source !== 'object') throw new Error(`PERSISTENCE_INVALID_OBJECT:${path.basename(src)}`);
  if (!current || Array.isArray(current) || typeof current !== 'object') throw new Error(`PERSISTENCE_INVALID_OBJECT:${path.basename(dst)}`);
  // Persistent destination ALWAYS wins conflicts. Legacy only fills missing keys.
  const merged = { ...source, ...current };
  const changed = JSON.stringify(merged) !== JSON.stringify(current);
  if (changed) await atomicJson(dst, merged);
  return { changed, sourceEntries: Object.keys(source).length, destEntries: Object.keys(merged).length };
}

export async function backupRuntimeData({ dataDir, reason = 'startup' } = {}) {
  const files = [
    'licenses.json', 'license-configs.json', 'config.json', 'events.ndjson', 'bridge-outbox.ndjson',
    'push-subscriptions.json', 'notification-preferences.json', 'notification-outbox.json',
    'notification-delivery-state.json', 'vapid.json'
  ];
  const backupDir = path.join(dataDir, 'backups', `${stamp()}-${reason.replace(/[^a-z0-9_-]+/gi, '-')}`);
  let copied = 0;
  for (const name of files) {
    const src = path.join(dataDir, name);
    if (!(await exists(src))) continue;
    await fs.mkdir(backupDir, { recursive: true });
    await fs.copyFile(src, path.join(backupDir, name));
    copied++;
  }
  return copied ? { created: true, backupDir, files: copied } : { created: false, backupDir: null, files: 0 };
}

export async function preparePersistentRuntimeData({ dataDir, legacyDataDir, logger = console } = {}) {
  const dest = path.resolve(dataDir);
  const legacy = path.resolve(legacyDataDir);
  await fs.mkdir(dest, { recursive: true });

  // Snapshot any already-persistent production state before migration/merge.
  const backup = await backupRuntimeData({ dataDir: dest, reason: 'pre-migration' });

  if (dest !== legacy && await exists(legacy)) {
    // Merge identity/config DBs; destination wins all conflicts. This protects existing
    // production licenses from bundled/legacy seed data and preserves newly-created keys.
    const licenses = await mergeObjectJson(path.join(legacy, 'licenses.json'), path.join(dest, 'licenses.json'));
    const licenseConfigs = await mergeObjectJson(path.join(legacy, 'license-configs.json'), path.join(dest, 'license-configs.json'));

    // Copy append-only/supporting files only if persistent copy is absent.
    for (const name of ['config.json', 'events.ndjson', 'bridge-outbox.ndjson', 'push-subscriptions.json',
      'notification-preferences.json', 'notification-outbox.json', 'notification-delivery-state.json', 'vapid.json']) {
      await copyIfMissing(path.join(legacy, name), path.join(dest, name));
    }
    logger.info?.(`APEX_PERSISTENT_DATA_READY path=${dest} legacy=${legacy} licenses=${licenses.destEntries} configs=${licenseConfigs.destEntries}`);
  } else {
    logger.info?.(`APEX_PERSISTENT_DATA_READY path=${dest} legacy=same`);
  }

  return { dataDir: dest, legacyDataDir: legacy, backup };
}
