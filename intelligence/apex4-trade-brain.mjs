import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { buildLearningCandidate, evaluateLearningCandidate, quoteResearchStats } from './apex4-learning.mjs';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const QUOTE_GAP_MS = 15_000;
const MAX_SAMPLE_PRICE = 100_000;
const utc = ms => new Date(ms).toISOString();
const finite = (n, minimum, maximum) => typeof n === 'number' && Number.isFinite(n) && n >= minimum && n <= maximum;
const isId = value => typeof value === 'string' && /^[0-9a-f]{24}$/.test(value);
const isTicket = value => typeof value === 'string' && /^[1-9]\d{0,19}$/.test(value);
const hash = value => createHash('sha256').update(value).digest('hex');
export const brainScope = (license, account) => hash(license + '|' + account);
const packed = value => JSON.stringify(value ?? null);
const unpacked = json => JSON.parse(json ?? 'null');

function marketProvenance(input) {
  const out = {};
  for (const field of ['broker', 'brokerServer', 'symbol', 'brokerSymbol']) {
    if (typeof input[field] === 'string' && input[field].length <= 120 && /^[A-Za-z0-9_:.()+ /-]+$/.test(input[field])) out[field] = input[field];
  }
  for (const field of ['leverage', 'equity', 'balance', 'margin', 'freeMargin', 'marginLevel', 'stopOutLevel', 'stopOutMode']) {
    if (finite(input[field], -1e12, 1e12)) out[field] = input[field];
  }
  return out;
}

function brokerEvent(event, now) {
  if (!event || !Number.isSafeInteger(event.atMs) || !finite(event.atMs, 1, now + 2 * MINUTE)) throw Error('INVALID_EVENT_TIMESTAMP');
  if (event.kind === 'ORDER_RESULT') {
    if (!isId(event.planId) || typeof event.eventId !== 'string' || !/^[A-Za-z0-9:_.-]{8,100}$/.test(event.eventId) ||
        !Number.isSafeInteger(event.retcode) || !finite(event.retcode, 0, 99_999) ||
        !finite(event.requestedPrice, 0.01, MAX_SAMPLE_PRICE) || !finite(event.requestedVolume, 0.000001, 10_000)) throw Error('INVALID_ORDER_RESULT');
    const record = { eventId: event.eventId, kind: event.kind, planId: event.planId, atMs: event.atMs,
      retcode: event.retcode, requestedPrice: event.requestedPrice, requestedVolume: event.requestedVolume };
    for (const field of ['filledVolume', 'latencyMs', 'spread', 'equity', 'marginFree', 'filledPrice']) {
      if (finite(event[field], -1e12, 1e12)) record[field] = event[field];
    }
    if (isTicket(event.dealId)) record.dealId = event.dealId;
    return record;
  }
  if (event.kind === 'DEAL') {
    if (!isTicket(event.dealId) || !isTicket(event.positionId) || !['IN', 'OUT'].includes(event.entry) || !['BUY', 'SELL'].includes(event.direction) ||
        !finite(event.price, 0.01, MAX_SAMPLE_PRICE) || !finite(event.volume, 0.000001, 10_000) ||
        !['commission', 'swap', 'profit', 'fee'].every(field => finite(event[field], -1e12, 1e12))) throw Error('INVALID_DEAL');
    const reason = typeof event.reason === 'string' && /^[A-Z_0-9]{2,32}$/.test(event.reason) ? event.reason : 'UNKNOWN';
    return { eventId: 'deal:' + event.dealId, dealId: event.dealId, positionId: event.positionId,
      kind: event.kind, planId: isId(event.planId) ? event.planId : null, entry: event.entry, direction: event.direction, reason,
      atMs: event.atMs, price: event.price, volume: event.volume, commission: event.commission,
      swap: event.swap, profit: event.profit, fee: event.fee };
  }
  throw Error('INVALID_EVENT_KIND');
}

function researchPlan(plan, decisionAt) {
  if (!plan || !isId(plan.id) || !['OUTLOOK', 'PULLBACK'].includes(plan.kind) || !['BUY', 'SELL'].includes(plan.side) ||
      !['entry', 'sl', 'tp1', 'tp2'].every(k => finite(plan[k], 0.01, MAX_SAMPLE_PRICE)) ||
      !Number.isSafeInteger(plan.expires) || plan.expires <= decisionAt) return null;
  const side = plan.side === 'BUY' ? 1 : -1;
  if (side * (plan.entry - plan.sl) <= 0 || side * (plan.tp1 - plan.entry) <= 0 || side * (plan.tp2 - plan.tp1) <= 0) return null;
  return plan;
}

const schema = `
  CREATE TABLE IF NOT EXISTS scopes (
    scope TEXT PRIMARY KEY, license_hash TEXT NOT NULL, account TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS scopes_license ON scopes (license_hash);
  CREATE TABLE IF NOT EXISTS observations (
    id INTEGER PRIMARY KEY, scope TEXT NOT NULL, quote_at INTEGER NOT NULL, observed_at INTEGER NOT NULL,
    bid REAL NOT NULL, ask REAL NOT NULL, batch_hash TEXT NOT NULL, source TEXT NOT NULL,
    UNIQUE (scope, quote_at, bid, ask, batch_hash)
  );
  CREATE INDEX IF NOT EXISTS observations_quote ON observations (scope, quote_at);
  CREATE INDEX IF NOT EXISTS observations_scope ON observations (scope, id);
  CREATE TABLE IF NOT EXISTS bars (
    scope TEXT NOT NULL, t INTEGER NOT NULL, known_id INTEGER NOT NULL,
    o REAL NOT NULL, h REAL NOT NULL, l REAL NOT NULL, c REAL NOT NULL,
    PRIMARY KEY (scope, t)
  ) WITHOUT ROWID;
  CREATE TABLE IF NOT EXISTS decisions (
    observation_id INTEGER PRIMARY KEY, scope TEXT NOT NULL, at INTEGER NOT NULL, status TEXT NOT NULL,
    plan TEXT, research_plan TEXT, context TEXT NOT NULL, knowledge_digest TEXT, policy_version TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS decisions_scope ON decisions (scope, at);
  CREATE INDEX IF NOT EXISTS decisions_plan ON decisions (scope, json_extract(plan, '$.id'));
  CREATE TABLE IF NOT EXISTS research (
    scope TEXT NOT NULL, id TEXT NOT NULL, decision_at INTEGER NOT NULL, horizon_at INTEGER NOT NULL,
    plan TEXT NOT NULL, accepted INTEGER NOT NULL, policy_version TEXT NOT NULL, costs TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING', fill REAL, fill_at INTEGER, risk REAL,
    last_quote INTEGER NOT NULL, last_exit REAL, mfe REAL NOT NULL DEFAULT 0, mae REAL NOT NULL DEFAULT 0,
    tp1_at INTEGER, tp2_at INTEGER, PRIMARY KEY (scope, id)
  ) WITHOUT ROWID;
  CREATE INDEX IF NOT EXISTS research_pending ON research (scope, last_quote) WHERE status = 'PENDING';
  CREATE TABLE IF NOT EXISTS research_outcomes (
    scope TEXT NOT NULL, id TEXT NOT NULL, completed_at INTEGER NOT NULL, result TEXT NOT NULL, outcome TEXT NOT NULL,
    PRIMARY KEY (scope, id)
  ) WITHOUT ROWID;
  CREATE TABLE IF NOT EXISTS broker_events (
    scope TEXT NOT NULL, id TEXT NOT NULL, kind TEXT NOT NULL, at INTEGER NOT NULL, position_id TEXT, plan_id TEXT,
    payload TEXT NOT NULL, PRIMARY KEY (scope, id)
  ) WITHOUT ROWID;
  CREATE INDEX IF NOT EXISTS broker_events_at ON broker_events (scope, at);
  CREATE INDEX IF NOT EXISTS broker_events_position ON broker_events (scope, position_id, at);
  CREATE TABLE IF NOT EXISTS learning_cycles (
    scope TEXT NOT NULL, day INTEGER NOT NULL, at INTEGER NOT NULL, data TEXT NOT NULL,
    PRIMARY KEY (scope, day)
  ) WITHOUT ROWID;
  CREATE TABLE IF NOT EXISTS knowledge_versions (
    scope TEXT NOT NULL, id TEXT NOT NULL, at INTEGER NOT NULL, candidate TEXT NOT NULL,
    PRIMARY KEY (scope, id)
  ) WITHOUT ROWID;
  CREATE TABLE IF NOT EXISTS knowledge_evaluations (
    scope TEXT NOT NULL, id TEXT NOT NULL, at INTEGER NOT NULL, verdict TEXT NOT NULL, evidence TEXT NOT NULL,
    PRIMARY KEY (scope, id)
  ) WITHOUT ROWID;
  CREATE TABLE IF NOT EXISTS knowledge_actions (
    id INTEGER PRIMARY KEY, scope TEXT NOT NULL, at INTEGER NOT NULL, version_id TEXT, action TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS knowledge_actions_scope ON knowledge_actions (scope, id);
`;

export function createApexTradeBrain(dataDir, { clock = Date.now, slippage = 0.10, commission = 0,
  policyVersion = 'APEX4_DETERMINISTIC_V1' } = {}) {
  if (!finite(slippage, 0, 10) || !finite(commission, 0, 10)) throw Error('INVALID_RESEARCH_COSTS');
  const root = path.join(dataDir, 'apex4-trade-brain');
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const dbPath = path.join(root, 'brain.sqlite');
  const db = new DatabaseSync(dbPath);
  chmodSync(dbPath, 0o600);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA busy_timeout = 3000;');
  db.exec(schema);
  const statementCache = new Map();
  const statement = sql => {
    if (!statementCache.has(sql)) statementCache.set(sql, db.prepare(sql));
    return statementCache.get(sql);
  };
  const run = (sql, ...args) => statement(sql).run(...args);
  const get = (sql, ...args) => statement(sql).get(...args);
  const all = (sql, ...args) => statement(sql).all(...args);
  function atomic(fn) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
  const scopeOf = (license, account) => {
    const scope = brainScope(license, account);
    run('INSERT OR IGNORE INTO scopes VALUES (?, ?, ?)', scope, hash(license), account);
    return scope;
  };
  function finish(row, observation, result, outcome) {
    run('INSERT OR IGNORE INTO research_outcomes VALUES (?, ?, ?, ?, ?)',
      row.scope, row.id, observation.quote_at, result, packed(outcome));
    run("UPDATE research SET status = 'DONE' WHERE scope = ? AND id = ?", row.scope, row.id);
  }
  function markResearch(scope, observation) {
    const pending = all("SELECT * FROM research WHERE scope = ? AND status = 'PENDING' AND last_quote < ?", scope, observation.quote_at);
    for (const row of pending) {
      const plan = unpacked(row.plan), costs = unpacked(row.costs), side = plan.side === 'BUY' ? 1 : -1;
      const at = observation.quote_at, spread = observation.ask - observation.bid;
      let { fill, fill_at: fillAt, risk, mae, mfe, tp1_at: tp1At, tp2_at: tp2At, last_exit: lastExit } = row;
      const outcome = (exit = null) => ({
        source: 'SIMULATED_OBSERVED_QUOTES', entered: fill !== null, entry: fill, exit, fillAt, tp1At, tp2At, mae, mfe,
        maeR: risk ? mae / risk : null, mfeR: risk ? mfe / risk : null, costs,
        r: exit !== null && risk ? (side * (exit - fill) - costs.commission) / risk : null
      });
      if (fill === null) {
        if (at > plan.expires) {
          finish(row, observation, 'NOT_ENTERED', outcome());
          continue;
        }
        const entry = side > 0 ? observation.ask : observation.bid;
        const quoteExit = side > 0 ? observation.bid : observation.ask;
        const initialRisk = side * (plan.entry - plan.sl);
        if (side * (quoteExit - plan.sl) <= 0 || side * (plan.tp1 - entry) <= 0) {
          finish(row, observation, 'INVALIDATED_BEFORE_ENTRY', outcome());
          continue;
        }
        if (spread > costs.maxSpread || Math.abs(entry - plan.entry) > initialRisk * .25) continue;
        fill = entry + side * costs.slippage;
        if (side * (plan.tp1 - fill) <= 0) {
          fill = null;
          finish(row, observation, 'INVALIDATED_BEFORE_ENTRY', outcome());
          continue;
        }
        fillAt = at;
        risk = side * (fill - plan.sl);
      }
      if (at - row.last_quote > QUOTE_GAP_MS && row.fill !== null) {
        finish(row, observation, 'INSUFFICIENT_OBSERVATION', outcome());
        continue;
      }
      const quoteExit = side > 0 ? observation.bid : observation.ask;
      if (at >= row.horizon_at) {
        finish(row, observation, 'TIMED_EXIT', outcome(lastExit === null ? null : lastExit - side * costs.slippage));
        continue;
      }
      const move = side * (quoteExit - fill);
      mae = Math.max(mae, -move);
      mfe = Math.max(mfe, move);
      if (tp1At === null && side * (quoteExit - plan.tp1) >= 0) tp1At = at;
      if (side * (quoteExit - plan.sl) <= 0) {
        finish(row, observation, 'SL', outcome(quoteExit - side * costs.slippage));
        continue;
      }
      if (side * (quoteExit - plan.tp2) >= 0) {
        tp2At = at;
        finish(row, observation, 'TP2', outcome(plan.tp2 - side * costs.slippage));
        continue;
      }
      lastExit = quoteExit;
      run(`UPDATE research SET fill = ?, fill_at = ?, risk = ?, last_quote = ?, last_exit = ?, mae = ?, mfe = ?, tp1_at = ?
        WHERE scope = ? AND id = ?`, fill, fillAt, risk, at, lastExit, mae, mfe, tp1At, scope, row.id);
    }
  }
  function capture(license, account, { quote, bars, now = clock(), metadata = {} }) {
    return atomic(() => {
      const scope = scopeOf(license, account);
      const quoteAt = Date.parse(quote.at), source = marketProvenance(metadata), batch = hash(packed([bars, source]));
      const priorId = get('SELECT id FROM observations WHERE scope = ? ORDER BY id DESC LIMIT 1', scope)?.id ?? null;
      const inserted = run('INSERT OR IGNORE INTO observations (scope,quote_at,observed_at,bid,ask,batch_hash,source) VALUES (?,?,?,?,?,?,?)',
        scope, quoteAt, now, quote.bid, quote.ask, batch, packed(source));
      if (inserted.changes === 0) {
        const row = get('SELECT id FROM observations WHERE scope = ? AND quote_at = ? AND bid = ? AND ask = ? AND batch_hash = ?',
          scope, quoteAt, quote.bid, quote.ask, batch);
        return { scope, id: row.id, added: [], duplicate: true };
      }
      const id = Number(inserted.lastInsertRowid), added = [];
      for (const b of bars) {
        if (b.t + MINUTE > now) continue;
        if (run('INSERT OR IGNORE INTO bars VALUES (?, ?, ?, ?, ?, ?, ?)', scope, b.t, id, b.o, b.h, b.l, b.c).changes) added.push(b);
      }
      markResearch(scope, { quote_at: quoteAt, bid: quote.bid, ask: quote.ask });
      return { scope, id, priorId, added, duplicate: false };
    });
  }
  function recentBars(scope, now, observationId = Number.MAX_SAFE_INTEGER, limit = 7500) {
    return all(`SELECT t,o,h,l,c FROM bars WHERE scope = ? AND t <= ? AND known_id <= ? ORDER BY t DESC LIMIT ?`,
      scope, now - MINUTE, observationId, limit).reverse();
  }
  function recordDecision(observation, decision, { now = clock(), canonical = null, knowledgeDigest = null } = {}) {
    return atomic(() => {
      const scope = observation.scope, previous = get('SELECT * FROM decisions WHERE observation_id = ? AND scope = ?', observation.id, scope);
      if (previous) return decodeDecision(previous);
      const selected = researchPlan(decision.plan, now);
      const detected = researchPlan(decision.researchPlan, now) ?? selected;
      run('INSERT INTO decisions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', observation.id, scope, now, decision.status,
        packed(selected), packed(detected), packed({ local: decision.local, m10: decision.m10, canonical }), knowledgeDigest, policyVersion);
      if (detected) {
        // Plan IDs are per scope; repeated quotes within a setup do not inflate its training weight.
        const horizon = (detected.kind === 'OUTLOOK' ? 60 : 20) * MINUTE;
        const studyVersion = policyVersion + ':' + (knowledgeDigest ?? 'NO_BASELINE');
        const costs = { slippage, commission, spread: 'OBSERVED_BID_ASK', maxSpread: .35,
          excursion: 'SAMPLED_EXECUTABLE_QUOTES', maxQuoteGapMs: QUOTE_GAP_MS };
        run(`INSERT OR IGNORE INTO research (scope,id,decision_at,horizon_at,plan,accepted,policy_version,costs,last_quote)
          VALUES (?,?,?,?,?,?,?,?,?)`, scope, detected.id, now, now + horizon, packed(detected), Number(!!selected || decision.baselineSelected === true), studyVersion, packed(costs), now);
      }
      return { ...decision, plan: selected, researchPlan: detected };
    });
  }
  const decodeDecision = row => row ? {
    status: row.status, plan: unpacked(row.plan), researchPlan: unpacked(row.research_plan),
    local: unpacked(row.context)?.local ?? null, m10: unpacked(row.context)?.m10 ?? null, knowledgeDigest: row.knowledge_digest, at: row.at
  } : null;
  const decisionAt = observation => decodeDecision(get('SELECT * FROM decisions WHERE observation_id = ? AND scope = ?', observation.id, observation.scope));

  function recordBrokerEvents(license, account, events, now = clock()) {
    if (!Array.isArray(events) || events.length > 200) throw Error('INVALID_EVENT_BATCH');
    const rows = events.map(event => brokerEvent(event, now));
    return atomic(() => {
      const scope = scopeOf(license, account);
      let stored = 0;
      for (const event of rows) {
        const direct = event.planId && get("SELECT 1 FROM decisions WHERE scope = ? AND json_extract(plan,'$.id') = ? LIMIT 1", scope, event.planId);
        const linked = event.positionId ? get(
          "SELECT plan_id FROM broker_events WHERE scope = ? AND position_id = ? AND plan_id IS NOT NULL AND json_extract(payload,'$.entry') = 'IN' ORDER BY at ASC LIMIT 1",
          scope, event.positionId
        )?.plan_id : null;
        const byDeal = event.kind === 'DEAL' && event.entry === 'IN'
          ? get("SELECT plan_id FROM broker_events WHERE scope = ? AND plan_id IS NOT NULL AND kind = 'ORDER_RESULT' AND json_extract(payload,'$.dealId') = ? LIMIT 1", scope, event.dealId)?.plan_id
          : null;
        event.planId = direct ? event.planId : linked ?? byDeal ?? null;
        stored += run('INSERT OR IGNORE INTO broker_events VALUES (?, ?, ?, ?, ?, ?, ?)',
          scope, event.eventId, event.kind, event.atMs, event.positionId ?? null, event.planId, packed(event)).changes;
      }
      return { accepted: rows.length, stored };
    });
  }
  const planLink = `b.plan_id IS NOT NULL OR EXISTS (
    SELECT 1 FROM broker_events AS opening WHERE opening.scope = b.scope AND opening.position_id = b.position_id
      AND opening.plan_id IS NOT NULL AND json_extract(opening.payload,'$.entry') = 'IN')`;
  function latestExecution(scope) {
    const row = get(`SELECT b.* FROM broker_events b WHERE b.scope = ? AND (${planLink}) ORDER BY b.at DESC, b.id DESC LIMIT 1`, scope);
    if (!row) return null;
    const event = unpacked(row.payload);
    const result = { ...event, source: 'EA_REPORTED_DEMO_BROKER' };
    if (event.kind === 'ORDER_RESULT') {
      const selected = get("SELECT plan FROM decisions WHERE scope = ? AND json_extract(plan,'$.id') = ? ORDER BY at DESC LIMIT 1", scope, result.planId);
      const completed = event.dealId ? get('SELECT payload FROM broker_events WHERE scope = ? AND id = ?', scope, 'deal:'+event.dealId) : null;
      const price = completed ? unpacked(completed.payload)?.price : event.filledPrice > 0 && event.filledVolume > 0 ? event.filledPrice : null;
      const side = unpacked(selected?.plan)?.side;
      return { ...result, slippage: price !== null && side ? (side === 'BUY' ? 1 : -1) * (price - event.requestedPrice) : null };
    }
    if (event.entry !== 'OUT') return result;
    const fills = all('SELECT payload,plan_id FROM broker_events WHERE scope = ? AND position_id = ? AND at <= ? ORDER BY at,id',
      scope, event.positionId, event.atMs).map(deal => ({ ...unpacked(deal.payload), planId: deal.plan_id }));
    const entries = fills.filter(deal => deal.entry === 'IN');
    if (!entries.length) return result;
    const enteredVolume = entries.reduce((total, deal) => total + deal.volume, 0);
    const exitedVolume = fills.filter(deal => deal.entry === 'OUT').reduce((total, deal) => total + deal.volume, 0);
    const positionNet = fills.reduce((total, deal) => total + deal.profit + deal.swap + deal.fee + deal.commission, 0);
    const entryPrice = entries.reduce((total, deal) => total + deal.price * deal.volume, 0) / enteredVolume;
    const sell = entries[0].direction === 'SELL', mark = sell ? 'ask' : 'bid';
    const extrema = get(`SELECT MIN(${mark}) AS low, MAX(${mark}) AS high, COUNT(*) AS samples
       FROM observations WHERE scope = ? AND quote_at BETWEEN ? AND ?`, scope, entries[0].atMs, event.atMs);
    return { ...result, planId: result.planId ?? entries.find(deal => deal.planId)?.planId ?? null,
      entryPrice, exitPrice: event.price, positionNet, closed: exitedVolume + 1e-8 >= enteredVolume,
      sampledMarketQuotes: extrema.samples, excursionSource: 'SAMPLED_EXECUTABLE_QUOTES',
      mae: extrema.samples ? Math.max(0, sell ? extrema.high - entryPrice : entryPrice - extrema.low) : null,
      mfe: extrema.samples ? Math.max(0, sell ? entryPrice - extrema.low : extrema.high - entryPrice) : null,
      thisDealNet: event.profit + event.swap + event.fee + event.commission };
  }

  function learningCases(scope, start, end, studyVersion) {
    return all(`SELECT r.id, r.decision_at, r.horizon_at, r.accepted, r.plan, o.outcome FROM research r
      JOIN research_outcomes o ON o.scope = r.scope AND o.id = r.id
      WHERE r.scope = ? AND r.policy_version = ? AND r.decision_at >= ? AND r.horizon_at <= ? AND o.completed_at <= ?
      ORDER BY r.decision_at, r.id`, scope, studyVersion, start, end, end).flatMap(row => {
      const plan = unpacked(row.plan), outcome = unpacked(row.outcome);
      return Number.isFinite(outcome.r)
        ? [{ id: row.id, kind: plan.kind, group: plan.group, source: plan.source, grade: plan.grade, at: row.decision_at,
          until: row.horizon_at, accepted: !!row.accepted, ...outcome }]
        : [];
    });
  }
  const pullbackCases = rows => rows.filter(row => row.kind === 'PULLBACK' && row.group);
  function observedOverview(rows, cutoff) {
    const outlook = rows.filter(row => row.kind === 'OUTLOOK' && row.source === 'VENDORED_XAUCLOUD_BIAS_CANONICAL_INPUT');
    const hourRows = Array.from({ length: 24 }, (_, hourWAT) => ({ hourWAT, ...quoteResearchStats(outlook.filter(
      row => new Date(row.at + 60 * MINUTE).getUTCHours() === hourWAT
    )) })).filter(hour => hour.count);
    return { evidenceSource: 'SIMULATED_OBSERVED_QUOTES', through: utc(cutoff),
      pullback: quoteResearchStats(pullbackCases(rows)), canonicalOutlook: quoteResearchStats(outlook), outlookHoursWAT: hourRows };
  }
  const currentVersion = scope => get('SELECT version_id, at FROM knowledge_actions WHERE scope = ? ORDER BY id DESC LIMIT 1', scope);
  function cycle(now = clock()) {
    let processed = 0;
    for (const owner of all('SELECT scope FROM scopes')) {
      const { scope } = owner, day = Math.floor(now / DAY), cutoff = day * DAY;
      if (get('SELECT 1 FROM learning_cycles WHERE scope = ? AND day = ?', scope, day)) continue;
      atomic(() => {
        if (get('SELECT 1 FROM learning_cycles WHERE scope = ? AND day = ?', scope, day)) return;
        const open = get(`SELECT v.id, v.candidate FROM knowledge_versions v LEFT JOIN knowledge_evaluations e
          ON e.scope = v.scope AND e.id = v.id WHERE v.scope = ? AND e.id IS NULL AND json_extract(v.candidate,'$.policyVersion') GLOB ?
          ORDER BY v.at DESC LIMIT 1`, scope, policyVersion + ':*');
        const studyVersion = get(`SELECT policy_version FROM research WHERE scope = ? AND horizon_at <= ? AND policy_version GLOB ?
          ORDER BY decision_at DESC LIMIT 1`, scope, cutoff, policyVersion + ':*')?.policy_version;
        const historical = studyVersion ? learningCases(scope, cutoff - 180 * DAY, cutoff, studyVersion) : [];
        let cycleState = 'INSUFFICIENT_RESEARCH';
        if (open) {
          const candidate = unpacked(open.candidate);
          if (cutoff >= candidate.holdoutEnd) {
            const evaluation = evaluateLearningCandidate(candidate, pullbackCases(learningCases(scope, candidate.holdoutStart, candidate.holdoutEnd, candidate.policyVersion)));
            run('INSERT INTO knowledge_evaluations VALUES (?,?,?,?,?)', scope, open.id, now, evaluation.verdict, packed(evaluation));
            cycleState = evaluation.verdict;
          } else {
            cycleState = 'AWAITING_FORWARD_HOLDOUT';
          }
        } else {
          const candidate = buildLearningCandidate(pullbackCases(historical), cutoff, studyVersion, now);
          if (candidate) {
            const previous = get('SELECT at FROM knowledge_versions WHERE scope = ? ORDER BY at DESC LIMIT 1', scope);
            if (!previous || candidate.newestDecision > previous.at) {
              const id = hash(packed(candidate)).slice(0, 24);
              run('INSERT OR IGNORE INTO knowledge_versions VALUES (?,?,?,?)', scope, id, cutoff, packed(candidate));
              cycleState = 'AWAITING_FORWARD_HOLDOUT';
            }
          }
        }
        run('INSERT INTO learning_cycles VALUES (?, ?, ?, ?)', scope, day, now, packed({ state: cycleState, research: observedOverview(historical, cutoff) }));
        processed++;
      });
    }
    return { processed };
  }
  function changeKnowledge(scope, { action, versionId = null, now = clock() }) {
    return atomic(() => {
      const current = currentVersion(scope)?.version_id ?? null;
      let next;
      if (action === 'PROMOTE') {
        const checked = get('SELECT verdict FROM knowledge_evaluations WHERE scope = ? AND id = ?', scope, versionId);
        if (checked?.verdict !== 'FORWARD_VALIDATED') throw Error('VERSION_NOT_VALIDATED');
        next = versionId;
      } else if (action === 'ROLLBACK') {
        if (!current) throw Error('NO_ACTIVE_VERSION');
        const promotion = get("SELECT id FROM knowledge_actions WHERE scope = ? AND action = 'PROMOTE' AND version_id = ? ORDER BY id DESC LIMIT 1", scope, current);
        next = promotion ? get('SELECT version_id FROM knowledge_actions WHERE scope = ? AND id < ? ORDER BY id DESC LIMIT 1',
          scope, promotion.id)?.version_id ?? null : null;
      } else {
        throw Error('INVALID_KNOWLEDGE_ACTION');
      }
      if (next !== current) run('INSERT INTO knowledge_actions (scope, at, version_id, action) VALUES (?, ?, ?, ?)', scope, now, next, action);
      return { activeVersion: next };
    });
  }
  function summary(scope) {
    const count = sql => get(sql, scope).n;
    const latest = get('SELECT at, data FROM learning_cycles WHERE scope = ? ORDER BY day DESC LIMIT 1', scope);
    const cycleInfo = unpacked(latest?.data);
    const active = currentVersion(scope)?.version_id ?? null;
    const version = get(`SELECT v.id, v.candidate, e.evidence FROM knowledge_versions v LEFT JOIN knowledge_evaluations e
      ON e.scope = v.scope AND e.id = v.id WHERE v.scope = ? ORDER BY v.at DESC LIMIT 1`, scope);
    return {
      status: cycleInfo?.state ?? 'COLLECTING',
      lastCycleAt: latest ? utc(latest.at) : null,
      research: cycleInfo?.research ?? null,
      observations: count('SELECT COUNT(*) AS n FROM observations WHERE scope = ?'),
      decisions: count('SELECT COUNT(*) AS n FROM decisions WHERE scope = ?'),
      simulatedCases: count('SELECT COUNT(*) AS n FROM research_outcomes WHERE scope = ?'),
      brokerDeals: count(`SELECT COUNT(*) AS n FROM broker_events b WHERE b.scope = ? AND b.kind = 'DEAL' AND (${planLink})`),
      activeVersion: active,
      candidateVersion: version?.id ?? null,
      forwardEvaluation: version ? unpacked(version.evidence) : null
    };
  }
  function promotedResearch(scope) {
    const active = currentVersion(scope)?.version_id;
    if (!active) return null;
    const record = get(`SELECT v.candidate, e.evidence FROM knowledge_versions v JOIN knowledge_evaluations e
      ON e.scope = v.scope AND e.id = v.id WHERE v.scope = ? AND v.id = ?`, scope, active);
    if (!record) return null;
    const { groups, selectedGroups, evidenceSource, policyVersion } = unpacked(record.candidate);
    return { version: active, groups, selectedGroups, evidenceSource, policyVersion, evaluation: unpacked(record.evidence) };
  }
  function recentLessons(scope, limit = 8) {
    return all(`SELECT r.decision_at, r.plan, r.accepted, o.result, o.outcome FROM research r
      JOIN research_outcomes o ON o.scope = r.scope AND o.id = r.id
      WHERE r.scope = ? ORDER BY o.completed_at DESC LIMIT ?`, scope, limit).map(row => ({
      at: utc(row.decision_at), setup: unpacked(row.plan)?.group ?? unpacked(row.plan)?.kind, selected: !!row.accepted,
      result: row.result, r: unpacked(row.outcome).r, source: 'SIMULATED_OBSERVED_QUOTES',
      maeR: unpacked(row.outcome).maeR, mfeR: unpacked(row.outcome).mfeR
    }));
  }
  function latestMarket(license, account = null) {
    const scope = account === null ? null : brainScope(license, account);
    const row = scope ? get('SELECT * FROM observations WHERE scope = ? ORDER BY id DESC LIMIT 1', scope)
      : get('SELECT o.* FROM observations o JOIN scopes s ON s.scope = o.scope WHERE s.license_hash = ? ORDER BY o.id DESC LIMIT 1', hash(license));
    if (!row) return null;
    const quote = { bid: row.bid, ask: row.ask, at: utc(row.quote_at) };
    return { scope: row.scope, at: row.observed_at, quote, source: unpacked(row.source), bars: recentBars(row.scope, row.observed_at, row.id),
      decision: decisionAt({ scope: row.scope, id: row.id }) };
  }
  return { capture, recentBars, recordDecision, decisionAt, recordBrokerEvents, latestExecution, latestMarket,
    cycle, changeKnowledge, summary, promotedResearch, recentLessons, close: () => db.close() };
}
