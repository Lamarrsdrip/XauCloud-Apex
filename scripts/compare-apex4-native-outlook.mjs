import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { normalizeNativeEvidence } from '../intelligence/apex4-canonical-evidence.mjs';
import { outlookFromCanonicalEvidence } from '../intelligence/apex4-engine.ts';
import { resolveHourlyBias } from '../intelligence/xaucloud/marketOutlookSignal.ts';
import { assessOutlookQuality } from '../intelligence/xaucloud/aiOutlookQuality.ts';
import { isMarketOpen } from '../intelligence/xaucloud/marketCalendar.ts';

const [capturePath, xauBackend, qualityPath] = process.argv.slice(2);
if (!capturePath || !xauBackend) throw Error('Usage: node scripts/compare-apex4-native-outlook.mjs <native capture JSONL> <XauCloud backend_node> [already trained knowledge JSON]');
const load = name => import(pathToFileURL(resolve(xauBackend, 'dist/services', name+'.js')).href);
const [original, evidence, core, zone, quality] = await Promise.all([
  load('marketOutlookSignal'), load('marketOutlookEvidence'), load('marketOutlookCore'),
  load('marketOutlookConfidence'), load('aiOutlookQuality'),
]);
const k = qualityPath ? JSON.parse(await readFile(qualityPath, 'utf8')) : null;
const stats = { lines: 0, accepted: 0, neutralOrBlocked: 0, executable: 0, classified: 0,
  differences: { direction: 0, confidence: 0, eligibility: 0, entry: 0, sl: 0, tp1: 0, tp2: 0, classification: 0 } };
const r2 = x => Math.round(x*100)/100;
const safeEqual = (a,b) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a-b) < 1e-8;

for await (const line of createInterface({input: createReadStream(capturePath, 'utf8'), crlfDelay: Infinity})) {
  if (!line.trim()) continue;
  stats.lines++;
  const row = JSON.parse(line.trim().replace(/^\uFEFF/,'')), now = row.observedAt;
  const source = normalizeNativeEvidence(row, { account: row.account, brokerServer: row.brokerServer,
    environment: row.environment, now, quote: row.quote });
  if (!source) continue;
  stats.accepted++;
  const fields = { m10_signal: row.m10Signal, entry_readiness: row.entryReadiness, market_thesis: row.thesis };
  const actualBias = resolveHourlyBias(source.canonicalM10, source.thesis);
  const referenceM10 = evidence.canonicalM10Signal(fields);
  const referenceThesis = { ...row.m10Signal, ...row.entryReadiness, ...row.thesis };
  const expectedBias = original.resolveHourlyBias(referenceM10, referenceThesis);
  if (actualBias.direction_label !== expectedBias.direction_label) stats.differences.direction++;
  if (actualBias.confidence !== expectedBias.confidence) stats.differences.confidence++;

  // Reuse XauCloud's actual quote/SL geometry helpers. This comparison omits
  // production DB lookups, recent-price freeze gates, and global brain vetoes.
  const { bid, ask } = row.quote, mid = (bid+ask)/2;
  const dir = expectedBias.direction, side = expectedBias.direction_label;
  const atr = Number(referenceThesis.atr_m5) || 0;
  const entry = Number(referenceThesis.structural_entry), sl = Number(referenceThesis.structural_sl);
  const structural = entry>0 && sl>0 && atr>0;
  const levels = structural ? {suggested_sl: core.clampGoldStopToMaxDistance(entry, sl, dir),
    preferred_entry_zone_low:r2(entry-atr*.15), preferred_entry_zone_high:r2(entry+atr*.15)} :
    zone.computeZoneAndTargets(dir, mid, referenceThesis, atr || mid*.0035);
  const zoneMid = (levels.preferred_entry_zone_low + levels.preferred_entry_zone_high)/2;
  const canCalculate = isMarketOpen(new Date(now)) && Math.abs(zoneMid-mid) <= Math.max((atr || Math.max(1,mid*.005))*5,mid*.02) && core.evaluateOwnerPolicy(referenceM10).allowed;
  const expectedAnchor = canCalculate ? original.buildTrackingAnchor(side,bid,ask,levels.suggested_sl) : null;
  const targets = expectedAnchor ? original.fixedTpPrices(side,expectedAnchor.tracking_entry_price) : [];
  const actualPlan = outlookFromCanonicalEvidence(source,now);
  if (!!expectedAnchor !== !!actualPlan) stats.differences.eligibility++;
  if (expectedAnchor && actualPlan) {
    stats.executable++;
    for (const [key,expected] of Object.entries({entry:expectedAnchor.tracking_entry_price,sl:levels.suggested_sl,tp1:targets[0],tp2:targets[1]})) {
      if (!safeEqual(actualPlan[key],expected)) stats.differences[key]++;
    }
  } else stats.neutralOrBlocked++;
  // Classification needs independently aligned closed M1 features and the
  // identical already-trained rule artifact for the two engines.
  if (k && row.caseFeatures) {
    stats.classified++;
    if (assessOutlookQuality(row.caseFeatures,k.rules,k.history).grade !==
        quality.assessOutlookQuality(row.caseFeatures,k.rules,k.history).grade) stats.differences.classification++;
  }
}
console.log(JSON.stringify({ ...stats, scope: 'Same native telemetry packet, deterministic normalization, bias, and quote/SL/target geometry only. No claims about DB-dependent behavior, live campaigns, execution, or historical profitability.' },null,2));
if (!stats.accepted || Object.values(stats.differences).some(n=>n)) process.exitCode = 1;
