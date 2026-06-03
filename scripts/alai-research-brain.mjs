import { spawnSync } from 'node:child_process';
import Database from 'better-sqlite3';

const db = new Database('data/alai.db');
const now = Date.now();

db.exec(`
CREATE TABLE IF NOT EXISTS alai_brain_runs (
  id TEXT PRIMARY KEY,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  ok INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  summary TEXT
);

CREATE TABLE IF NOT EXISTS alai_brain_metrics (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  metric TEXT NOT NULL,
  value REAL NOT NULL,
  created_at INTEGER NOT NULL
);
`);

const runId = `brain_${now}`;

db.prepare(`
INSERT INTO alai_brain_runs (id, started_at)
VALUES (?, ?)
`).run(runId, now);

function scalar(sql) {
  return Number(db.prepare(sql).get()?.v || 0);
}

function metric(name, value) {
  db.prepare(`
    INSERT OR REPLACE INTO alai_brain_metrics
    (id, run_id, metric, value, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(`${runId}_${name}`, runId, name, Number(value || 0), Date.now());
}

metric('before_avg_confidence', scalar(`SELECT AVG(confidence) v FROM knowledge_units`));
metric('before_claims', scalar(`SELECT COUNT(*) v FROM knowledge_claims`));
metric('before_inferences', scalar(`SELECT COUNT(*) v FROM knowledge_inferences`));
metric('before_hypotheses', scalar(`SELECT COUNT(*) v FROM knowledge_hypotheses`));
metric('before_weak_required', scalar(`
  SELECT COUNT(*) v
  FROM education_required_coverage erc
  LEFT JOIN mastery_progress mp ON mp.path=erc.path
  WHERE erc.stage=(SELECT active_stage FROM education_control WHERE id='main')
    AND COALESCE(mp.confidence,0) < erc.mastery_required
`));

const steps = [
  ['him_upgrade', 'scripts/alai-him-upgrade.mjs'],
  ['hygiene', 'scripts/alai-phase1-hygiene.mjs'],
  ['research_missions', 'scripts/alai-research-mission-engine.mjs'],
  ['source_harvest', 'scripts/alai-source-harvester.mjs'],
  ['source_ranking', 'scripts/alai-source-ranking-engine.mjs'],
  ['evidence', 'scripts/alai-evidence-aggregation-engine.mjs'],
  ['claims_normalize', 'scripts/alai-claim-normalizer.mjs'],
  ['structured_claims', 'scripts/alai-structured-claim-extractor.mjs'],
  ['claim_verify', 'scripts/alai-claim-verification-v2.mjs'],
  ['relationships_clean', 'scripts/alai-relationship-normalizer.mjs'],
  ['semantic_infer', 'scripts/alai-semantic-inference-rebuild.mjs'],
  ['hypotheses', 'scripts/alai-hypothesis-generator.mjs'],
  ['hypothesis_validator', 'scripts/alai-hypothesis-validator.mjs'],
  ['reasoning_feedback', 'scripts/alai-reasoning-feedback-engine.mjs'],
  ['conflict_engine', 'scripts/alai-conflict-engine.mjs'],
  ['mastery_sync', 'scripts/alai-mastery-sync.mjs'],
  ['learning_gain', 'scripts/alai-learning-gain-engine.mjs']
];

let ok = 0;
let failed = 0;
const results = [];

for (const [name, script] of steps) {
  console.log(`\n🧠 ALAI BRAIN STEP: ${name}`);
  const started = Date.now();
  const res = spawnSync('node', [script], { stdio: 'inherit' });
  const ms = Date.now() - started;

  const success = res.status === 0;
  if (success) ok++;
  else failed++;

  results.push({ name, script, ok: success, ms });
}

metric('after_avg_confidence', scalar(`SELECT AVG(confidence) v FROM knowledge_units`));
metric('after_claims', scalar(`SELECT COUNT(*) v FROM knowledge_claims`));
metric('after_inferences', scalar(`SELECT COUNT(*) v FROM knowledge_inferences`));
metric('after_hypotheses', scalar(`SELECT COUNT(*) v FROM knowledge_hypotheses`));
metric('after_weak_required', scalar(`
  SELECT COUNT(*) v
  FROM education_required_coverage erc
  LEFT JOIN mastery_progress mp ON mp.path=erc.path
  WHERE erc.stage=(SELECT active_stage FROM education_control WHERE id='main')
    AND COALESCE(mp.confidence,0) < erc.mastery_required
`));

db.prepare(`
UPDATE alai_brain_runs
SET finished_at=?,
    ok=?,
    failed=?,
    summary=?
WHERE id=?
`).run(Date.now(), ok, failed, JSON.stringify(results), runId);

const report = {
  run_id: runId,
  ok,
  failed,
  metrics: db.prepare(`
    SELECT metric, value
    FROM alai_brain_metrics
    WHERE run_id=?
    ORDER BY metric
  `).all(runId),
  weak_required_now: db.prepare(`
    SELECT erc.stage, erc.path, erc.mastery_required, COALESCE(mp.confidence,0) confidence
    FROM education_required_coverage erc
    LEFT JOIN mastery_progress mp ON mp.path=erc.path
    WHERE erc.stage=(SELECT active_stage FROM education_control WHERE id='main')
      AND COALESCE(mp.confidence,0) < erc.mastery_required
    ORDER BY confidence ASC
    LIMIT 20
  `).all()
};

console.log(JSON.stringify(report, null, 2));

db.close();
process.exit(failed ? 1 : 0);
