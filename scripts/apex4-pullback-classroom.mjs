#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {
  classroomCost, classroomSplits, identifyClassroomLessons, jsonSha256, loadClassroomPrices,
  openClassroom, sourceSha256,
} from '../research/apex4-pullback-classroom.mjs';

const [action, databaseFile, archive, novemberFile, output] = process.argv.slice(2);
if (!['scan', 'study'].includes(action) || !databaseFile || !archive || !novemberFile || (action === 'study' && !output)) {
  throw Error('Usage: node scripts/apex4-pullback-classroom.mjs scan|study <database> <archive-dir> <known-november-file|-> [knowledge-output]');
}
const db = openClassroom(path.resolve(databaseFile));
const {prices, sources} = loadClassroomPrices(path.resolve(archive), novemberFile === '-' ? null : novemberFile);
const splits = classroomSplits(prices);
const recognitionFiles = [
  '../research/apex4-pullback-classroom.mjs', '../intelligence/apex4-pullback-education.mjs',
  '../intelligence/xaucloud/aiOpportunityEngine.ts', '../intelligence/xaucloud/marketCalendar.ts',
];
const provenance = {
  sources, splits, costs: classroomCost,
  recognition: recognitionFiles.map(file => ({file, digest: sourceSha256(new URL(file, import.meta.url))})),
};
const runId = jsonSha256(provenance);
const prior = db.prepare('SELECT completed FROM classroom_runs WHERE id = ?').get(runId);
if (action === 'scan' && !prior?.completed) {
  const insert = db.prepare(`INSERT OR IGNORE INTO classroom_lessons
    (run_id,id,episode,observed_at,split,source,evidence,plan,actionable,bar_index,split_end,session_bar_end)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  db.prepare('INSERT OR IGNORE INTO classroom_runs (id,provenance) VALUES (?,?)').run(runId, JSON.stringify(provenance));
  let count = 0;
  db.exec('BEGIN');
  try {
    identifyClassroomLessons(prices, splits, lesson => {
      const source = sources.find(row => lesson.at >= row.from && lesson.at < row.through);
      insert.run(runId, lesson.id, lesson.episode, lesson.at, lesson.split, source.digest, JSON.stringify(lesson.evidence),
        lesson.plan ? JSON.stringify(lesson.plan) : null, Number(lesson.actionable), lesson.barIndex, lesson.through, lesson.sessionBarEnd);
      if (++count % 10_000 === 0) {
        db.exec('COMMIT');
        console.error(`Recorded ${count} lessons through ${new Date(lesson.at).toISOString()}`);
        db.exec('BEGIN');
      }
    });
    db.prepare('UPDATE classroom_runs SET completed = 1 WHERE id = ?').run(runId);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
if (action === 'study') {
  if (!prior?.completed) throw Error('CLASSROOM_SCAN_INCOMPLETE');
  const {studyClassroom} = await import('../research/apex4-pullback-study.mjs');
  const knowledge = studyClassroom(db, runId, prices, provenance);
  fs.writeFileSync(path.resolve(output), JSON.stringify(knowledge, null, 2) + '\n', {mode: 0o600, flag: 'wx'});
  console.log(JSON.stringify({runId, version: knowledge.id, rules: knowledge.ruleSet.length, output}));
} else {
  const totals = db.prepare('SELECT split, count(*) AS lessons FROM classroom_lessons WHERE run_id = ? GROUP BY split').all(runId);
  console.log(JSON.stringify({runId, sources, totals}));
}
db.close();
