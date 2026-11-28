import fs from 'node:fs/promises';
import path from 'node:path';
import { canonicalM10Signal } from './xaucloud/marketOutlookEvidence.ts';

export const canonicalSourceCommit = 'fc91b97e2ee88eae6b9d4e24c6d74ef522c1ec4c';
export const canonicalSourceSha256 = '5be1ef095d7bf3d23c1d2cc7ee482368700bfff871a08e8f8f340a932d686d71';
const object = v => !!v && typeof v === 'object' && !Array.isArray(v);

export function normalizeNativeEvidence(packet, context) {
  const { account, brokerServer, quote, now, environment = 'DEMO' } = context ?? {};
  if (account == null || typeof brokerServer !== 'string' || !brokerServer || !Number.isFinite(now) ||
      !object(quote) || !Number.isFinite(quote.bid) || !Number.isFinite(quote.ask) ||
      quote.bid <= 0 || quote.ask < quote.bid || !['DEMO', 'TESTER'].includes(environment)) return undefined;
  if (!object(packet) || packet.schema !== 'XAUCLOUD_CANONICAL_M10_EVIDENCE_V1' ||
      packet.sourceCommit !== canonicalSourceCommit || packet.sourceSha256 !== canonicalSourceSha256 ||
      packet.environment !== environment || String(packet.account) !== String(account) ||
      packet.symbol !== 'XAUUSD' || !/^(XAUUSD|GOLD)/i.test(packet.brokerSymbol ?? '') ||
      typeof packet.brokerServer !== 'string' || packet.brokerServer.toLowerCase() !== brokerServer.toLowerCase() ||
      packet.htfComplete !== true || !object(packet.thesis) || !object(packet.m10Signal)) return undefined;

  const m10 = packet.m10Signal, rawQuote = packet.quote;
  if (m10.primary_timeframe !== 'M10' || m10.freshness_state !== 'FRESH' ||
      m10.build_hash !== 'xaucloud-v6291-signal-plan-execution-20261127' ||
      String(m10.account) !== String(account) || m10.symbol !== packet.brokerSymbol ||
      !Number.isSafeInteger(m10.evidence_id) || m10.evidence_id < 1 ||
      !object(rawQuote) || !Number.isSafeInteger(rawQuote.atMs) || rawQuote.atMs !== packet.observedAt ||
      rawQuote.atMs > now + 2000 || now - rawQuote.atMs > 3000 ||
      !Number.isFinite(rawQuote.bid) || !Number.isFinite(rawQuote.ask) || rawQuote.bid <= 0 || rawQuote.ask < rawQuote.bid ||
      Math.abs(rawQuote.bid - quote.bid) > .05 || Math.abs(rawQuote.ask - quote.ask) > .05) return undefined;

  const readiness = object(packet.entryReadiness) ? packet.entryReadiness : {};
  return {
    canonicalM10: canonicalM10Signal({ m10_signal: m10, entry_readiness: readiness, market_thesis: packet.thesis }),
    thesis: { ...m10, ...readiness, ...packet.thesis },
    quote: { bid: rawQuote.bid, ask: rawQuote.ask, at: new Date(rawQuote.atMs).toISOString() },
    htfComplete: true,
    observedAt: packet.observedAt,
    producer: packet.sourceCommit,
  };
}

export async function readNativeEvidence(id, context) {
  const root = process.env.APEX4_LOCAL_EVIDENCE_DIR;
  if (!root || !/^[a-f0-9]{64}$/.test(id) || process.env.APEX4_CANONICAL_SOURCE_COMMIT !== canonicalSourceCommit) return undefined;
  try {
    const file = path.join(root, id + '.json');
    const info = await fs.lstat(file);
    if (!info.isFile() || info.size > 256000) return undefined;
    return normalizeNativeEvidence(JSON.parse(await fs.readFile(file, 'utf8')), context);
  } catch {
    return undefined;
  }
}
