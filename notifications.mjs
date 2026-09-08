import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const DEFAULT_PREFS = Object.freeze({
  setupDetected: true,
  tradeFired: true,
  newLayers: true,
  campaignClosed: true,
  criticalAlerts: true,
  setupCancelled: false,
  profitFloorUpdates: false,
  masterSlUpdates: false
});

const TEMPORARY_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
const PERMANENT_GONE_STATUS = new Set([404, 410]);
const MAX_DELIVERY_ATTEMPTS = 8;
const RETRY_DELAYS_MS = [15_000, 60_000, 5 * 60_000, 15 * 60_000, 30 * 60_000, 60 * 60_000, 2 * 60 * 60_000, 4 * 60 * 60_000];
const WATCH_FALLBACK_DEDUPE_MS = 3 * 60_000;
const MAX_PROCESSED = 20_000;

function nowIso() { return new Date().toISOString(); }
function normalizeLicense(v) { return String(v || '').trim().toUpperCase().replace(/ /g, ''); }
function maskLicense(v) {
  const s = normalizeLicense(v);
  return s.length <= 8 ? '***' : `${s.slice(0, 5)}...${s.slice(-4)}`;
}
function cleanText(v, n = 220) { return String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n); }
function finite(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }
function money(v) {
  const n = finite(v);
  if (n === null) return null;
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(2)}`;
}
function number(v, digits = 2) {
  const n = finite(v);
  return n === null ? null : n.toFixed(digits);
}
function direction(e) {
  const d = Number(e.direction ?? e.dir ?? e.watchDir ?? 0);
  return d > 0 ? 'BUY' : d < 0 ? 'SELL' : cleanText(e.directionText || e.side || '', 8).toUpperCase();
}
function symbol(e) { return cleanText(e.symbol || e.symbolName || e.instrument || 'XAUUSD', 32); }
function eventId(e) {
  if (e.eventId) return cleanText(e.eventId, 160);
  if (e.id) return cleanText(e.id, 160);
  return crypto.createHash('sha1').update([
    e.ts || e.emittedAt || '', e.type || '', e.campaignId || '', e.layer ?? '',
    e.setupId || e.watchId || e.signature || '', e.account || '', e.price ?? ''
  ].join('|')).digest('hex');
}
function setupIdentity(e) {
  const explicit = e.setupId || e.watchId || e.watch_id || e.signature || e.sig;
  if (explicit) return `watch:${cleanText(explicit, 180)}`;
  const trigger = e.triggerBarTime || e.trigger_bar_time || e.triggerTime || e.barTime || '';
  const extreme = number(e.extreme ?? e.sweepExtreme ?? e.referencePrice ?? e.price, 3) || '';
  const d = direction(e) || 'UNKNOWN';
  return `watch-fallback:${symbol(e)}:${d}:${trigger}:${extreme}`;
}
function preferenceKeyForType(type, e) {
  switch (type) {
    case 'WATCH_ARMED': return 'setupDetected';
    case 'LAYER_OPEN': return Number(e.layer || 0) <= 1 ? 'tradeFired' : 'newLayers';
    case 'CAMPAIGN_END': return 'campaignClosed';
    case 'ORDER_REJECTED':
    case 'ORDER_UNCONFIRMED':
    case 'CLOSE_STALLED':
    case 'MASTER_SL_MOVE_FAIL':
    case 'SIZING_MODEL_REJECTED': return 'criticalAlerts';
    case 'SETUP_CANCELLED': return 'setupCancelled';
    case 'PROFIT_FLOOR_EARNED': return 'profitFloorUpdates';
    case 'MASTER_SL_MOVED': return 'masterSlUpdates';
    default: return null;
  }
}

export function notificationForEvent(e) {
  const type = String(e?.type || '');
  const d = direction(e);
  const sym = symbol(e);
  const score = finite(e.score);
  const px = number(e.price ?? e.entryPrice ?? e.triggerPrice, 3);
  const vol = number(e.volume ?? e.lots ?? e.volumeOpened ?? e.layerVolume, 2);
  const basketVol = number(e.basketVolume ?? e.basket_volume, 2);
  const layer = Number(e.layer || 0);
  const lines = [];

  if (type === 'WATCH_ARMED') {
    lines.push(`Potential ${d || ''} reversal detected`.trim(), sym, 'Watching for confirmation');
    if (score !== null) lines.push(`Score: ${score.toFixed(0)}`);
    if (px) lines.push(`Price: ${px}`);
    return { preference: 'setupDetected', title: '🔍 Apex Setup Detected', body: lines.join('\n'), urgency: 'normal' };
  }

  // IMPORTANT: FIRED is based on broker-confirmed LAYER_OPEN L1, not CAMPAIGN_START.
  if (type === 'LAYER_OPEN' && layer <= 1) {
    lines.push(`${d || 'Trade'} ${sym}`, 'L1 opened');
    if (px) lines.push(`Entry: ${px}`);
    if (vol) lines.push(`Volume: ${vol} lots`);
    if (score !== null) lines.push(`Score: ${score.toFixed(0)}`);
    return { preference: 'tradeFired', title: `🚀 APEX FIRED${d ? ` — ${d}` : ''}`, body: lines.join('\n'), urgency: 'high' };
  }

  if (type === 'LAYER_OPEN' && layer > 1) {
    lines.push(`${d || 'Trade'} ${sym}`);
    if (px) lines.push(`Entry: ${px}`);
    if (vol) lines.push(`Volume: ${vol} lots`);
    if (basketVol) lines.push(`Basket: ${basketVol} lots`);
    return { preference: 'newLayers', title: `⚡ Apex Added L${layer}`, body: lines.join('\n'), urgency: 'high' };
  }

  if (type === 'CAMPAIGN_END') {
    lines.push(`${d || 'Campaign'} ${sym}`);
    if (e.outcome) lines.push(`Outcome: ${cleanText(e.outcome, 80)}`);
    const pnl = money(e.realisedNet ?? e.realizedNet ?? e.pnl ?? e.profit);
    if (pnl) lines.push(`Realised P/L: ${pnl}`);
    if (finite(e.layers) !== null) lines.push(`Layers: ${Number(e.layers)}`);
    if (finite(e.durationSec) !== null) lines.push(`Duration: ${Math.round(Number(e.durationSec) / 60)} min`);
    return { preference: 'campaignClosed', title: '✅ Apex Campaign Closed', body: lines.join('\n'), urgency: 'high' };
  }

  if (['ORDER_REJECTED', 'ORDER_UNCONFIRMED', 'CLOSE_STALLED', 'MASTER_SL_MOVE_FAIL', 'SIZING_MODEL_REJECTED'].includes(type)) {
    if (type === 'ORDER_REJECTED') {
      lines.push(`Broker rejected ${d || ''} order`.trim());
      if (e.retcode !== undefined) lines.push(`Retcode: ${cleanText(e.retcode, 50)}`);
      if (e.reason || e.detail) lines.push(cleanText(e.reason || e.detail));
    } else if (type === 'ORDER_UNCONFIRMED') {
      lines.push('Order was not confirmed by the broker');
      if (e.detail || e.reason) lines.push(cleanText(e.detail || e.reason));
    } else if (type === 'CLOSE_STALLED') {
      lines.push('Basket close is still failing');
      if (finite(e.remainingPositions) !== null) lines.push(`${Number(e.remainingPositions)} position(s) still open`);
    } else if (type === 'MASTER_SL_MOVE_FAIL') {
      lines.push('Master stop change was refused by the broker');
      if (e.retcode !== undefined) lines.push(`Retcode: ${cleanText(e.retcode, 50)}`);
    } else {
      lines.push('NORMAL sizing model disagreed with the live trade server');
      if (e.marginPct !== undefined) lines.push(`Intended tier: ${cleanText(e.marginPct, 30)}%`);
      if (e.rejectedVolume !== undefined) lines.push(`Rejected volume: ${cleanText(e.rejectedVolume, 30)} lots`);
      if (e.retcode !== undefined) lines.push(`Retcode: ${cleanText(e.retcode, 50)}`);
      lines.push('Apex refused to silently step down and change the intended NORMAL percentage.');
    }
    return { preference: 'criticalAlerts', title: '⚠️ APEX EXECUTION WARNING', body: lines.join('\n'), urgency: 'critical' };
  }

  if (type === 'SETUP_CANCELLED') {
    lines.push(`${sym} setup cancelled`, cleanText(e.cancelReason || e.reason || 'No longer valid'));
    return { preference: 'setupCancelled', title: 'Apex Setup Cancelled', body: lines.join('\n'), urgency: 'normal' };
  }

  if (type === 'PROFIT_FLOOR_EARNED') {
    const floor = number(e.earnedFloorPct ?? e.floorPct, 1);
    lines.push(`${d || ''} ${sym}`.trim(), floor ? `Protected profit floor: +${floor}%` : 'Profit floor raised');
    return { preference: 'profitFloorUpdates', title: '🛡️ Apex Profit Floor Raised', body: lines.join('\n'), urgency: 'normal' };
  }

  if (type === 'MASTER_SL_MOVED') {
    lines.push(`${d || ''} ${sym}`.trim(), 'Master stop moved and verified at broker');
    const sl = number(e.sl ?? e.stopPrice ?? e.brokerSL, 3);
    if (sl) lines.push(`SL: ${sl}`);
    return { preference: 'masterSlUpdates', title: '🛡️ Apex Master SL Updated', body: lines.join('\n'), urgency: 'normal' };
  }

  return null;
}

const REMOTE_STATE_KIND = Object.freeze({
  'push-subscriptions.json':'push-subscriptions',
  'notification-preferences.json':'notification-preferences',
  'notification-outbox.json':'notification-outbox',
  'notification-delivery-state.json':'notification-delivery-state',
  'vapid.json':'vapid'
});
function remoteStateKind(file){ return REMOTE_STATE_KIND[path.basename(file)] || null; }
function remoteStateConfigured(){ return Boolean(String(process.env.XAUCLOUD_BASE_URL||'').trim() && String(process.env.APEX_BRIDGE_SECRET||'').trim()); }
async function remoteStateRequest(route,{method='GET',body}={}){
  if(!remoteStateConfigured()) return null;
  const base=String(process.env.XAUCLOUD_BASE_URL||'https://xaucloud.io').trim().replace(/\/+$/,'');
  const r=await fetch(base+route,{method,headers:{'accept':'application/json','content-type':'application/json','x-apex-bridge-secret':String(process.env.APEX_BRIDGE_SECRET||'')},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(3000)});
  const text=await r.text();let data={};try{data=text?JSON.parse(text):{}}catch{}
  if(!r.ok||data?.ok===false) throw new Error(String(data?.error||`REMOTE_STATE_HTTP_${r.status}`));
  return data;
}
async function atomicJsonLocal(file,value,mode=null){
  await fs.mkdir(path.dirname(file),{recursive:true});
  const tmp=`${file}.tmp-${process.pid}-${crypto.randomUUID()}`;
  await fs.writeFile(tmp,JSON.stringify(value,null,2),mode?{mode}:undefined);
  await fs.rename(tmp,file);if(mode)await fs.chmod(file,mode).catch(()=>{});
}
async function readJson(file, fallback) {
  try {
    const raw = await fs.readFile(file, 'utf8');
    if (!raw.trim()) return structuredClone(fallback);
    return JSON.parse(raw);
  } catch (e) {
    if (e?.code !== 'ENOENT') throw new Error(`APEX_NOTIFICATION_STORAGE_ERROR ${path.basename(file)}: ${e?.message || e}`);
    const kind=remoteStateKind(file);
    if(kind&&remoteStateConfigured()){
      try{
        const remote=await remoteStateRequest('/api/cloud/apex/bridge/state?kind='+encodeURIComponent(kind));
        if(remote?.exists){await atomicJsonLocal(file,remote.value);return structuredClone(remote.value);}
      }catch(err){console.error(`APEX_NOTIFICATION_REMOTE_RESTORE_FAILED kind=${kind} error=${cleanText(err?.message||err,180)}`);}
    }
    return structuredClone(fallback);
  }
}
async function atomicJson(file, value, mode = null) {
  await atomicJsonLocal(file,value,mode);
  const kind=remoteStateKind(file);
  if(kind&&remoteStateConfigured()){
    try{await remoteStateRequest('/api/cloud/apex/bridge/state/upsert',{method:'POST',body:{kind,value}});}
    catch(err){console.error(`APEX_NOTIFICATION_REMOTE_MIRROR_FAILED kind=${kind} error=${cleanText(err?.message||err,180)}`);}
  }
}
function validSubscription(s) {
  return Boolean(s && typeof s === 'object' && typeof s.endpoint === 'string' && s.endpoint.startsWith('https://') &&
    s.keys && typeof s.keys.p256dh === 'string' && typeof s.keys.auth === 'string');
}
function safeSubscription(s) {
  return {
    endpoint: String(s.endpoint).slice(0, 2048),
    keys: { p256dh: String(s.keys.p256dh).slice(0, 512), auth: String(s.keys.auth).slice(0, 256) }
  };
}
function endpointHash(endpoint) { return crypto.createHash('sha256').update(String(endpoint)).digest('hex').slice(0, 24); }
function isTemporaryPushError(e) {
  const code = Number(e?.statusCode ?? e?.status ?? 0);
  return !code || TEMPORARY_STATUS.has(code);
}
function isGonePushError(e) {
  const code = Number(e?.statusCode ?? e?.status ?? 0);
  return PERMANENT_GONE_STATUS.has(code);
}

export function createNotificationEngine({ dataDir, origin = 'https://apex.xaucloud.io', webPushAdapter = null, logger = console } = {}) {
  if (!dataDir) throw new Error('notification dataDir required');
  const dir = path.resolve(dataDir);
  const FILES = {
    subscriptions: path.join(dir, 'push-subscriptions.json'),
    preferences: path.join(dir, 'notification-preferences.json'),
    outbox: path.join(dir, 'notification-outbox.json'),
    state: path.join(dir, 'notification-delivery-state.json'),
    vapid: path.join(dir, 'vapid.json')
  };
  let adapter = webPushAdapter;
  let vapid = null;
  let worker = null;
  let busy = false;
  let chain = Promise.resolve();

  function serial(fn) {
    const run = chain.then(fn, fn);
    chain = run.catch(() => {});
    return run;
  }

  async function loadAdapter() {
    if (adapter) return adapter;
    const mod = await import('web-push');
    adapter = mod.default || mod;
    return adapter;
  }

  async function ensureVapid() {
    if (vapid) return vapid;
    const wp = await loadAdapter();
    const envPublic = cleanText(process.env.VAPID_PUBLIC_KEY, 1024);
    const envPrivate = cleanText(process.env.VAPID_PRIVATE_KEY, 1024);
    const subject = cleanText(process.env.VAPID_SUBJECT || origin, 1024) || origin;
    if (envPublic && envPrivate) {
      vapid = { publicKey: envPublic, privateKey: envPrivate, subject, source: 'ENV' };
    } else {
      const stored = await readJson(FILES.vapid, null);
      if (stored?.publicKey && stored?.privateKey) {
        vapid = { ...stored, subject: stored.subject || subject, source: 'PERSISTENT_DATA' };
      } else {
        const keys = wp.generateVAPIDKeys();
        vapid = { publicKey: keys.publicKey, privateKey: keys.privateKey, subject, createdAt: nowIso(), source: 'GENERATED_PERSISTENT_DATA' };
        await atomicJson(FILES.vapid, vapid, 0o600);
        logger.info?.('APEX_PUSH_VAPID_CREATED persistent=true');
      }
    }
    wp.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);
    return vapid;
  }

  async function ensure() {
    await fs.mkdir(dir, { recursive: true });
    const defaults = [
      [FILES.subscriptions, {}], [FILES.preferences, {}], [FILES.outbox, []],
      [FILES.state, { processed: {}, watchSemantic: {}, bridgeBaseline: {} }]
    ];
    for (const [file, fallback] of defaults) {
      try {
        await fs.access(file);
        const current=await readJson(file,fallback);
        await atomicJson(file,current);
      } catch { await atomicJson(file, fallback); }
    }
    const vv=await ensureVapid();
    if(vv?.source!=='ENV'){const stored=await readJson(FILES.vapid,null);if(stored)await atomicJson(FILES.vapid,stored,0o600);}
    return status();
  }

  async function status() {
    try {
      const v = await ensureVapid();
      const subs = await readJson(FILES.subscriptions, {});
      return { configured: true, publicKey: v.publicKey, vapidSource: v.source, subscriptions: Object.values(subs).reduce((n, a) => n + (Array.isArray(a) ? a.length : 0), 0), dataDir: dir };
    } catch (e) {
      return { configured: false, publicKey: null, error: cleanText(e?.message || e, 180), dataDir: dir };
    }
  }

  async function publicKey() {
    const v = await ensureVapid();
    return v.publicKey;
  }

  async function getPreferences(license) {
    const key = normalizeLicense(license);
    const all = await readJson(FILES.preferences, {});
    return { ...DEFAULT_PREFS, ...(all[key] || {}) };
  }

  async function setPreferences(license, patch = {}) {
    const key = normalizeLicense(license);
    if (!key) throw new Error('license_required');
    const allowed = Object.keys(DEFAULT_PREFS);
    const clean = {};
    for (const k of allowed) if (k in patch) {
      if (typeof patch[k] !== 'boolean') throw new Error(`invalid_notification_preference:${k}`);
      clean[k] = patch[k];
    }
    return serial(async () => {
      const all = await readJson(FILES.preferences, {});
      all[key] = { ...DEFAULT_PREFS, ...(all[key] || {}), ...clean, updatedAt: nowIso() };
      await atomicJson(FILES.preferences, all);
      return { ...DEFAULT_PREFS, ...all[key] };
    });
  }

  async function subscribe(license, subscription, meta = {}) {
    const key = normalizeLicense(license);
    if (!key) throw new Error('license_required');
    if (!validSubscription(subscription)) throw new Error('invalid_push_subscription');
    const sub = safeSubscription(subscription);
    return serial(async () => {
      const all = await readJson(FILES.subscriptions, {});
      const list = Array.isArray(all[key]) ? all[key] : [];
      const idx = list.findIndex(x => x.endpoint === sub.endpoint);
      const row = {
        ...sub,
        endpointHash: endpointHash(sub.endpoint),
        userAgent: cleanText(meta.userAgent, 220),
        createdAt: idx >= 0 ? list[idx].createdAt : nowIso(),
        updatedAt: nowIso(),
        lastSuccessAt: idx >= 0 ? list[idx].lastSuccessAt || null : null
      };
      if (idx >= 0) list[idx] = row; else list.push(row);
      all[key] = list.slice(-20); // multiple devices, bounded per license
      await atomicJson(FILES.subscriptions, all);
      return { ok: true, devices: all[key].length, endpointHash: row.endpointHash };
    });
  }

  async function unsubscribe(license, endpoint) {
    const key = normalizeLicense(license);
    return serial(async () => {
      const all = await readJson(FILES.subscriptions, {});
      const before = Array.isArray(all[key]) ? all[key] : [];
      const after = before.filter(x => x.endpoint !== endpoint);
      all[key] = after;
      await atomicJson(FILES.subscriptions, all);
      return { ok: true, removed: before.length - after.length, devices: after.length };
    });
  }

  async function listDeviceSummary(license) {
    const key = normalizeLicense(license);
    const all = await readJson(FILES.subscriptions, {});
    const list = Array.isArray(all[key]) ? all[key] : [];
    return list.map(x => ({ endpointHash: x.endpointHash || endpointHash(x.endpoint), createdAt: x.createdAt || null, lastSuccessAt: x.lastSuccessAt || null }));
  }

  async function markProcessed(state, id, detail) {
    state.processed[id] = { at: nowIso(), ...detail };
    const keys = Object.keys(state.processed);
    if (keys.length > MAX_PROCESSED) {
      keys.sort((a, b) => Date.parse(state.processed[a]?.at || 0) - Date.parse(state.processed[b]?.at || 0));
      for (const k of keys.slice(0, keys.length - MAX_PROCESSED)) delete state.processed[k];
    }
  }

  async function ingest(event) {
    const license = normalizeLicense(event?.license || event?.license_key);
    if (!license || !event?.type) return { queued: false, reason: 'missing_identity' };

    // A setup cancellation also unlocks semantic setup dedupe so a genuinely fresh
    // setup can notify immediately even in the same direction.
    if (event.type === 'SETUP_CANCELLED') {
      await serial(async () => {
        const state = await readJson(FILES.state, { processed: {}, watchSemantic: {}, bridgeBaseline: {} });
        const prefix = `${license}|watch:`;
        for (const k of Object.keys(state.watchSemantic || {})) if (k.startsWith(prefix)) delete state.watchSemantic[k];
        await atomicJson(FILES.state, state);
      });
    }

    const spec = notificationForEvent(event);
    if (!spec) return { queued: false, reason: 'not_notifiable' };
    const eid = eventId(event);
    const queueId = `${license}|${eid}|${spec.preference}`;

    return serial(async () => {
      const [state, outbox, prefs] = await Promise.all([
        readJson(FILES.state, { processed: {}, watchSemantic: {}, bridgeBaseline: {} }),
        readJson(FILES.outbox, []),
        getPreferences(license)
      ]);
      state.processed ||= {};
      state.watchSemantic ||= {};
      if (state.processed[queueId] || outbox.some(x => x.id === queueId)) return { queued: false, reason: 'duplicate_event' };

      if (event.type === 'WATCH_ARMED') {
        const semantic = `${license}|${setupIdentity(event)}`;
        const prior = state.watchSemantic[semantic];
        const fallback = semantic.includes('|watch-fallback:');
        const ttl = fallback ? WATCH_FALLBACK_DEDUPE_MS : 24 * 60 * 60_000;
        if (prior && Date.now() - Date.parse(prior.at || 0) < ttl) {
          await markProcessed(state, queueId, { status: 'SUPPRESSED_SEMANTIC_DUPLICATE', semantic });
          await atomicJson(FILES.state, state);
          return { queued: false, reason: 'duplicate_setup' };
        }
        state.watchSemantic[semantic] = { at: event.ts || nowIso(), eventId: eid };
      }

      if (!prefs[spec.preference]) {
        await markProcessed(state, queueId, { status: 'SUPPRESSED_BY_PREFERENCE', preference: spec.preference });
        await atomicJson(FILES.state, state);
        return { queued: false, reason: 'preference_disabled' };
      }

      const url = `${origin.replace(/\/$/, '')}/?event=${encodeURIComponent(eid)}`;
      outbox.push({
        id: queueId, license, eventId: eid, eventType: String(event.type), preference: spec.preference,
        payload: {
          title: spec.title,
          body: spec.body,
          tag: `apex-${eid}`.slice(0, 128),
          renotify: spec.urgency === 'critical',
          requireInteraction: spec.urgency === 'critical',
          data: { url, eventId: eid, eventType: String(event.type), license: maskLicense(license) }
        },
        targets: null,
        attempts: 0,
        createdAt: nowIso(),
        nextAttemptAt: nowIso(),
        lastError: null
      });
      await Promise.all([atomicJson(FILES.outbox, outbox), atomicJson(FILES.state, state)]);
      // Delivery is handled by the background worker (or an explicit drain in tests/admin).
      // Event ingestion never waits for push-provider I/O.
      return { queued: true, eventId: eid, type: event.type };
    });
  }

  async function pruneSubscription(license, endpoint) {
    const all = await readJson(FILES.subscriptions, {});
    const list = Array.isArray(all[license]) ? all[license] : [];
    all[license] = list.filter(x => x.endpoint !== endpoint);
    await atomicJson(FILES.subscriptions, all);
  }

  async function stampSuccess(license, endpoint) {
    const all = await readJson(FILES.subscriptions, {});
    const list = Array.isArray(all[license]) ? all[license] : [];
    const row = list.find(x => x.endpoint === endpoint);
    if (row) { row.lastSuccessAt = nowIso(); row.updatedAt = nowIso(); await atomicJson(FILES.subscriptions, all); }
  }

  async function reconcileCanonicalEvents(license, remoteEvents = []) {
    const key = normalizeLicense(license);
    if (!key) return { bootstrapped: false, queued: 0, reason: 'license_required' };
    const events = Array.isArray(remoteEvents) ? remoteEvents : [];

    const baseline = await serial(async () => {
      const state = await readJson(FILES.state, { processed: {}, watchSemantic: {}, bridgeBaseline: {} });
      state.processed ||= {}; state.watchSemantic ||= {}; state.bridgeBaseline ||= {};
      if (state.bridgeBaseline[key]) return { exists: true };

      // First contact is a BASELINE, not a notification replay. The bridge may return
      // its latest historical page; marking that page as seen prevents a redeploy or a
      // newly-enabled phone from receiving stale setup/trade alerts.
      let marked = 0;
      for (const raw of events) {
        const e = { ...raw, license: key, ts: raw.ts || raw.emittedAt || nowIso() };
        const spec = notificationForEvent(e);
        if (!spec) continue;
        const qid = `${key}|${eventId(e)}|${spec.preference}`;
        if (!state.processed[qid]) {
          await markProcessed(state, qid, { status: 'BRIDGE_BOOTSTRAP_EXISTING_EVENT', eventType: String(e.type || '') });
          marked++;
        }
        if (e.type === 'WATCH_ARMED') state.watchSemantic[`${key}|${setupIdentity(e)}`] = { at: e.ts, eventId: eventId(e) };
      }
      state.bridgeBaseline[key] = { at: nowIso(), visibleEvents: events.length, marked };
      await atomicJson(FILES.state, state);
      return { exists: false, marked };
    });

    if (!baseline.exists) return { bootstrapped: true, queued: 0, marked: baseline.marked || 0 };
    let queued = 0;
    for (const raw of events) {
      const r = await ingest({ ...raw, license: key, ts: raw.ts || raw.emittedAt || nowIso() });
      if (r.queued) queued++;
    }
    return { bootstrapped: false, queued, seen: events.length };
  }

  async function processOne(item, state) {
    const wp = await loadAdapter();
    await ensureVapid();
    const subsAll = await readJson(FILES.subscriptions, {});
    const current = Array.isArray(subsAll[item.license]) ? subsAll[item.license] : [];

    if (!Array.isArray(item.targets)) {
      item.targets = current.map(s => ({ endpoint: s.endpoint, subscription: { endpoint: s.endpoint, keys: s.keys } }));
    }
    if (!item.targets.length) {
      await markProcessed(state, item.id, { status: 'NO_SUBSCRIPTIONS' });
      return { done: true };
    }

    const remaining = [];
    const errors = [];
    for (const target of item.targets) {
      try {
        await wp.sendNotification(target.subscription, JSON.stringify(item.payload), { TTL: item.preference === 'criticalAlerts' ? 180 : 900, urgency: item.preference === 'criticalAlerts' ? 'high' : 'normal' });
        await stampSuccess(item.license, target.endpoint);
      } catch (e) {
        if (isGonePushError(e)) {
          await pruneSubscription(item.license, target.endpoint);
          logger.info?.(`APEX_PUSH_SUBSCRIPTION_PRUNED license=${maskLicense(item.license)} endpoint=${endpointHash(target.endpoint)}`);
          continue;
        }
        if (isTemporaryPushError(e)) {
          remaining.push(target);
          errors.push(cleanText(e?.message || `HTTP_${e?.statusCode || e?.status || 0}`, 160));
          continue;
        }
        // Unknown explicit non-retryable provider rejection: don't loop forever.
        errors.push(cleanText(e?.message || 'permanent_push_failure', 160));
      }
    }

    if (!remaining.length) {
      await markProcessed(state, item.id, { status: 'DELIVERED_OR_PERMANENTLY_RESOLVED', attempts: Number(item.attempts || 0) + 1 });
      return { done: true };
    }

    item.targets = remaining;
    item.attempts = Number(item.attempts || 0) + 1;
    item.lastError = errors.join(' | ').slice(0, 400);
    if (item.attempts >= MAX_DELIVERY_ATTEMPTS) {
      await markProcessed(state, item.id, { status: 'RETRY_EXHAUSTED', attempts: item.attempts, lastError: item.lastError });
      return { done: true };
    }
    const delay = RETRY_DELAYS_MS[Math.min(item.attempts - 1, RETRY_DELAYS_MS.length - 1)];
    item.nextAttemptAt = new Date(Date.now() + delay).toISOString();
    return { done: false, item };
  }

  async function drain({ max = 20 } = {}) {
    if (busy) return { processed: 0, pending: null, skipped: 'already_running' };
    busy = true;
    try {
      return await serial(async () => {
        const outbox = await readJson(FILES.outbox, []);
        const state = await readJson(FILES.state, { processed: {}, watchSemantic: {}, bridgeBaseline: {} });
        const keep = [];
        let processed = 0;
        for (const item of outbox) {
          if (processed >= max || Date.parse(item.nextAttemptAt || 0) > Date.now()) { keep.push(item); continue; }
          try {
            const r = await processOne(item, state);
            processed++;
            if (!r.done) keep.push(r.item);
          } catch (e) {
            item.attempts = Number(item.attempts || 0) + 1;
            item.lastError = cleanText(e?.message || e, 300);
            const delay = RETRY_DELAYS_MS[Math.min(Math.max(0, item.attempts - 1), RETRY_DELAYS_MS.length - 1)];
            item.nextAttemptAt = new Date(Date.now() + delay).toISOString();
            keep.push(item);
            logger.error?.(`APEX_PUSH_DELIVERY_ERROR license=${maskLicense(item.license)} type=${item.eventType} error=${item.lastError}`);
          }
        }
        await Promise.all([atomicJson(FILES.outbox, keep), atomicJson(FILES.state, state)]);
        return { processed, pending: keep.length };
      });
    } finally { busy = false; }
  }

  async function sendTest(license) {
    const key = normalizeLicense(license);
    const subsAll = await readJson(FILES.subscriptions, {});
    const list = Array.isArray(subsAll[key]) ? subsAll[key] : [];
    if (!list.length) throw new Error('no_push_subscription');
    const wp = await loadAdapter();
    await ensureVapid();
    const payload = JSON.stringify({
      title: '🔔 Apex Notifications Active',
      body: 'Your device is connected. Setup and execution alerts are ready.',
      tag: `apex-test-${Date.now()}`,
      data: { url: `${origin.replace(/\/$/, '')}/`, eventType: 'TEST' }
    });
    let sent = 0, pruned = 0;
    for (const s of list) {
      try { await wp.sendNotification({ endpoint: s.endpoint, keys: s.keys }, payload, { TTL: 120, urgency: 'high' }); sent++; await stampSuccess(key, s.endpoint); }
      catch (e) {
        if (isGonePushError(e)) { await pruneSubscription(key, s.endpoint); pruned++; }
        else throw e;
      }
    }
    return { ok: true, sent, pruned };
  }

  function start({ intervalMs = 5_000 } = {}) {
    if (worker) return worker;
    worker = setInterval(() => drain().catch(e => logger.error?.('APEX_PUSH_WORKER_ERROR', cleanText(e?.message || e))), Math.max(2_000, intervalMs));
    worker.unref?.();
    return worker;
  }
  function stop() { if (worker) clearInterval(worker); worker = null; }

  return {
    files: FILES,
    ensure, status, publicKey,
    getPreferences, setPreferences,
    subscribe, unsubscribe, listDeviceSummary,
    ingest, reconcileCanonicalEvents, drain, sendTest,
    start, stop,
    defaults: { ...DEFAULT_PREFS }
  };
}

export { DEFAULT_PREFS };
