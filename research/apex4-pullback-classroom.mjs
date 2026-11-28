import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {aggregate, analyzeFrame} from '../intelligence/xaucloud/aiOpportunityEngine.ts';
import {isMarketOpen} from '../intelligence/xaucloud/marketCalendar.ts';
import {educationRuleKey, recognizePullback} from '../intelligence/apex4-pullback-education.mjs';
import {coverage, loadMonth} from './archive.mjs';

export const MINUTE = 60_000;
export const classroomCost = Object.freeze({spread: 0.30, slippage: 0.10, commissionPerOunce: 0.07});
export const sourceSha256 = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
export const jsonSha256 = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const NOVEMBER_SHA = '400d88e8d632c6be78ae7742e4d41a234d96d5332a4e3bba9309c5a6527bf10e';

function appendArchive(target, rows, spread) {
  const half = spread / 2;
  for (const row of rows) {
    if (row.t % MINUTE !== 0 || row.t <= (target.at(-1)?.t ?? 0) || row.l > Math.min(row.o, row.c) ||
        row.h < Math.max(row.o, row.c)) throw Error('INVALID_ARCHIVE_SEQUENCE');
    target.push({t: row.t, o: row.o - half, h: row.h - half, l: row.l - half, c: row.c - half});
  }
}

export function loadClassroomPrices(dir, novemberFile, spread = classroomCost.spread) {
  const manifest = coverage(dir);
  if (manifest?.source !== 'EXNESS_PUBLIC_TICKS_M1' || manifest.files?.length !== 60) throw Error('INVALID_ARCHIVE_MANIFEST');
  const prices = [];
  for (const source of manifest.files) {
    const match = /^XAUUSD_M1_(\d{4}_\d{2})\.csv\.gz$/.exec(source.file);
    if (!match || sourceSha256(path.join(dir, source.file)) !== source.sha256) throw Error('ARCHIVE_HASH_MISMATCH');
    const rows = loadMonth(match[1], dir);
    if (rows.length !== source.rows) throw Error('ARCHIVE_COUNT_MISMATCH');
    appendArchive(prices, rows, spread);
  }
  if (prices.length !== manifest.totalM1Bars) throw Error('ARCHIVE_TOTAL_MISMATCH');
  const sources = [{source: manifest.source, bars: prices.length, from: prices[0].t, through: prices.at(-1).t + MINUTE,
    digest: sourceSha256(path.join(dir, 'manifest.json'))}];
  if (novemberFile) {
    if (path.basename(novemberFile) !== 'XAUUSD_M1_2026_11.csv.gz' ||
        sourceSha256(novemberFile) !== NOVEMBER_SHA) throw Error('NOVEMBER_HASH_MISMATCH');
    const rows = loadMonth('2026_11', path.dirname(novemberFile));
    appendArchive(prices, rows, spread);
    sources.push({source: 'EXNESS_NOVEMBER_REVEALED_MID', bars: rows.length, from: rows[0].t,
      through: rows.at(-1).t + MINUTE, digest: NOVEMBER_SHA});
  }
  return {prices, sources};
}

export function classroomSplits(prices) {
  const practice = Date.UTC(2025, 0, 1);
  const validation = Date.UTC(2025, 6, 1);
  const development = Date.UTC(2026, 0, 1);
  return [
    {label: 'train', from: prices[0].t, to: practice},
    {label: 'practice', from: practice, to: validation},
    {label: 'validation', from: validation, to: development},
    {label: 'knownDevelopment', from: development, to: prices.at(-1).t + MINUTE},
  ];
}

export function identifyClassroomLessons(prices, splits, visit, {spread = classroomCost.spread, scanFrom = 0} = {}) {
  const end = prices.at(-1).t + MINUTE;
  const series = [5, 15, 60].map(minutes => ({
    minutes, bars: aggregate(prices, minutes, end, Math.ceil(minutes * .9)), cursor: 0, frame: null,
  }));
  const hours = new Map();
  const episodes = new Map();
  let splitIndex = 0;
  let previousSessionBar;
  const sessionEnds = new Map();
  let lastSession;
  for (let i = 0; i < prices.length; i++) {
    if (previousSessionBar !== undefined && prices[i].t - previousSessionBar > 30 * MINUTE) {
      sessionEnds.set(lastSession, i);
      lastSession = i;
    }
    if (lastSession === undefined) lastSession = i;
    previousSessionBar = prices[i].t;
  }
  sessionEnds.set(lastSession, prices.length);
  const sessions = [...sessionEnds.entries()];
  let session = 0;
  for (let i = 450; i < prices.length; i++) {
    const quoteBar = prices[i];
    const now = quoteBar.t;
    while (session + 1 < sessions.length && i >= sessions[session + 1][0]) session++;
    while (splitIndex + 1 < splits.length && now >= splits[splitIndex].to) splitIndex++;
    const split = splits[splitIndex];
    if (now < Math.max(scanFrom, split.from) || now >= split.to || now - prices[i-1].t > 150_000) continue;
    const hour = Math.floor(now / 3_600_000);
    if (!hours.has(hour)) hours.set(hour, isMarketOpen(new Date(now)));
    if (!hours.get(hour)) continue;

    for (const frame of series) {
      const before = frame.cursor;
      const duration = frame.minutes * MINUTE;
      while (frame.cursor < frame.bars.length && frame.bars[frame.cursor].t + duration <= now) frame.cursor++;
      if (before !== frame.cursor) frame.frame = analyzeFrame(frame.bars.slice(Math.max(0, frame.cursor - 120), frame.cursor));
    }
    const [five, fifteen, hourly] = series;
    if (!five.frame || !fifteen.frame) continue;
    const recent = prices.slice(i-150, i);
    if (recent[15].t < now - 150 * MINUTE) continue;
    const m1 = analyzeFrame(recent);
    if (!m1) continue;
    const quote = {bid: quoteBar.o, ask: quoteBar.o + spread};
    const detected = recognizePullback({now, m1, m5: five.frame, m15: fifteen.frame, h1: hourly.frame},
      quote, recent, five.bars.slice(Math.max(0, five.cursor - 16), five.cursor));
    if (!detected) continue;

    const {evidence, plan, actionable} = detected;
    const episode = [evidence.side, evidence.impulsePeak].join('|');
    const signature = [split.label, educationRuleKey(evidence), !!plan].join('|');
    const observed = episodes.get(episode) ?? new Set();
    if (observed.has(signature)) continue;
    if (!episodes.has(episode)) {
      episodes.set(episode, observed);
      if (episodes.size > 256) episodes.delete(episodes.keys().next().value);
    }
    observed.add(signature);

    const id = jsonSha256([episode, now, signature]);
    visit({id, episode, at: now, barIndex: i, split: split.label, through: split.to,
      sessionBarEnd: sessions[session][1], evidence, plan, actionable});
  }
}

export function openClassroom(file) {
  const database = new DatabaseSync(file);
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS classroom_runs (
      id TEXT PRIMARY KEY, provenance TEXT NOT NULL, completed INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS classroom_lessons (
      run_id TEXT NOT NULL, id TEXT NOT NULL, episode TEXT NOT NULL, observed_at INTEGER NOT NULL,
      split TEXT NOT NULL, source TEXT NOT NULL, evidence TEXT NOT NULL, plan TEXT,
      actionable INTEGER NOT NULL, bar_index INTEGER NOT NULL, split_end INTEGER NOT NULL, session_bar_end INTEGER NOT NULL,
      PRIMARY KEY (run_id, id), FOREIGN KEY (run_id) REFERENCES classroom_runs(id)
    );
    CREATE TABLE IF NOT EXISTS classroom_outcomes (
      run_id TEXT NOT NULL, lesson_id TEXT NOT NULL, policy TEXT NOT NULL, outcome TEXT NOT NULL,
      PRIMARY KEY (run_id, lesson_id, policy),
      FOREIGN KEY (run_id, lesson_id) REFERENCES classroom_lessons(run_id, id)
    );
    CREATE TABLE IF NOT EXISTS classroom_knowledge (
      id TEXT PRIMARY KEY, run_id TEXT NOT NULL, manifest TEXT NOT NULL, created_at INTEGER NOT NULL,
      FOREIGN KEY (run_id) REFERENCES classroom_runs(id)
    );
    CREATE TABLE IF NOT EXISTS classroom_exams (
      version_id TEXT NOT NULL, input_digest TEXT NOT NULL, result TEXT NOT NULL,
      PRIMARY KEY (version_id, input_digest),
      FOREIGN KEY (version_id) REFERENCES classroom_knowledge(id)
    );
    CREATE INDEX IF NOT EXISTS lesson_time ON classroom_lessons(run_id, split, observed_at);
  `);
  return database;
}
