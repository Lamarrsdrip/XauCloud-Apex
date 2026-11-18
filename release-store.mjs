import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const MAX_EX5_BYTES = 5_000_000;
const MIN_EX5_BYTES = 8_192;

function fail(message, httpStatus = 400) {
  return Object.assign(new Error(message), { httpStatus });
}

/**
 * Compiled releases live in DATA_DIR, never inside the deployed source checkout.
 * A new source version is NOT advertised until its matching EX5 is published.
 */
export function createReleaseStore({ dataDir, expectedVersion }) {
  const directory = path.join(dataDir, 'bot-releases');
  const manifestPath = path.join(directory, 'latest.json');
  const version = String(expectedVersion);

  async function readManifest() {
    let record;
    try { record = JSON.parse(await fs.readFile(manifestPath, 'utf8')); }
    catch (error) {
      if (error?.code === 'ENOENT') return null;
      throw fail('release_manifest_unavailable', 503);
    }
    if (!record || record.version !== version || !/^[a-f0-9]{64}$/.test(record.sha256 || '') ||
        record.file !== `XauCloud-Apex-v${version}-${record.sha256}.ex5`) return null;
    try { await fs.access(path.join(directory, record.file)); }
    catch { return null; }
    return record;
  }

  async function status() {
    const record = await readManifest();
    return record ? {
      available: true, version: record.version,
      filename: `XauCloud-Apex-v${version}.ex5`, sha256: record.sha256,
      sizeBytes: record.sizeBytes, publishedAt: record.publishedAt,
      downloadUrl: '/api/session/bot/download'
    } : { available: false, version, reason: 'compiled_release_not_published' };
  }

  async function publish({ version: incoming, fileBase64, confirmed }) {
    if (incoming !== version) throw fail('release_version_must_match_current_source');
    if (confirmed !== true) throw fail('compile_confirmation_required');
    if (typeof fileBase64 !== 'string' || !fileBase64 ||
        fileBase64.length > Math.ceil(MAX_EX5_BYTES / 3) * 4 + 4 ||
        !/^[A-Za-z0-9+/]+={0,2}$/.test(fileBase64))
      throw fail('invalid_ex5_upload');
    const file = Buffer.from(fileBase64, 'base64');
    if (file.toString('base64') !== fileBase64 ||
        file.length < MIN_EX5_BYTES || file.length > MAX_EX5_BYTES)
      throw fail('invalid_ex5_size_or_encoding');
    // Avoid inadvertently publishing a renamed source file or arbitrary text.
    if (file.subarray(0, 1024).toString('utf8').includes('#property'))
      throw fail('source_file_is_not_compiled_ex5');

    const sha256 = crypto.createHash('sha256').update(file).digest('hex');
    const name = `XauCloud-Apex-v${version}-${sha256}.ex5`;
    const record = { version, sha256, file: name, sizeBytes: file.length,
      publishedAt: new Date().toISOString() };

    await fs.mkdir(directory, { recursive: true });
    const tmpFile = path.join(directory, `.${crypto.randomUUID()}.upload`);
    try {
      await fs.writeFile(tmpFile, file, { flag: 'wx', mode: 0o600 });
      await fs.rename(tmpFile, path.join(directory, name));
    } finally { await fs.rm(tmpFile, { force: true }).catch(() => {}); }
    const tmpManifest = path.join(directory, `.${crypto.randomUUID()}.json`);
    try {
      await fs.writeFile(tmpManifest, JSON.stringify(record, null, 2), { flag: 'wx', mode: 0o600 });
      await fs.rename(tmpManifest, manifestPath);
    } finally { await fs.rm(tmpManifest, { force: true }).catch(() => {}); }
    return status();
  }

  async function binary() {
    const record = await readManifest();
    if (!record) throw fail('compiled_release_not_published', 404);
    let data;
    try { data = await fs.readFile(path.join(directory, record.file)); }
    catch { throw fail('compiled_release_missing', 503); }
    if (data.length !== record.sizeBytes ||
        crypto.createHash('sha256').update(data).digest('hex') !== record.sha256)
      throw fail('compiled_release_integrity_failed', 503);
    return { filename: `XauCloud-Apex-v${version}.ex5`, data, record };
  }

  return { status, publish, binary };
}
