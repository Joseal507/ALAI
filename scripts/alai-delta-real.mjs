import Database from 'better-sqlite3';

const db = new Database('data/alai.db');
const now = Date.now();

db.exec(`
CREATE TABLE IF NOT EXISTS alai_metric_snapshots (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  avg_confidence REAL NOT NULL,
  knowledge_units INTEGER NOT NULL,
  claims INTEGER NOT NULL,
  inferences INTEGER NOT NULL,
  hypotheses INTEGER NOT NULL,
  weak_required INTEGER NOT NULL
);
`);

function val(sql) {
  return Number(db.prepare(sql).get()?.v || 0);
}

const activeStage = db.prepare("SELECT active_stage FROM education_control WHERE id='main'").get()?.active_stage || 'UNIVERSIDAD';

const current = {
  id: `snap_${now}`,
  created_at: now,
  avg_confidence: val(`SELECT AVG(confidence) v FROM knowledge_units`),
  knowledge_units: val(`SELECT COUNT(*) v FROM knowledge_units`),
  claims: val(`SELECT COUNT(*) v FROM knowledge_claims`),
  inferences: val(`SELECT COUNT(*) v FROM knowledge_inferences`),
  hypotheses: val(`SELECT COUNT(*) v FROM knowledge_hypotheses`),
  weak_required: val(`
    SELECT COUNT(*) v
    FROM education_required_coverage erc
    LEFT JOIN mastery_progress mp ON mp.path=erc.path
    WHERE erc.stage='${activeStage}'
      AND COALESCE(mp.confidence,0) < erc.mastery_required
  `)
};

const prev = db.prepare(`
SELECT *
FROM alai_metric_snapshots
ORDER BY created_at DESC
LIMIT 1
`).get();

db.prepare(`
INSERT INTO alai_metric_snapshots
(id, created_at, avg_confidence, knowledge_units, claims, inferences, hypotheses, weak_required)
VALUES
(@id, @created_at, @avg_confidence, @knowledge_units, @claims, @inferences, @hypotheses, @weak_required)
`).run(current);

const delta = prev ? {
  avg_confidence: Number((current.avg_confidence - prev.avg_confidence).toFixed(4)),
  knowledge_units: current.knowledge_units - prev.knowledge_units,
  claims: current.claims - prev.claims,
  inferences: current.inferences - prev.inferences,
  hypotheses: current.hypotheses - prev.hypotheses,
  weak_required: current.weak_required - prev.weak_required
} : null;

console.log(JSON.stringify({
  active_stage: activeStage,
  current,
  previous: prev || null,
  delta,
  status: !prev ? 'baseline_created' :
    delta.weak_required < 0 || delta.avg_confidence > 0 || delta.claims > 0 || delta.inferences > 0 || delta.hypotheses > 0
      ? 'improved'
      : 'unchanged'
}, null, 2));

db.close();
