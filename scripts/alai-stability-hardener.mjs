import Database from 'better-sqlite3';

const db = new Database('data/alai.db');
const now = Date.now();

function isStructureTopic(t='') {
  const x = String(t).toLowerCase();
  return (
    x.includes('facultad completa') ||
    x.includes('carrera completa') ||
    x.includes('programa completo') ||
    x.includes('alai_curriculum_expand') ||
    x.includes('stage=') ||
    x.includes('path=') ||
    x.includes('task=')
  );
}

db.exec(`
CREATE TABLE IF NOT EXISTS alai_stability_log (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  target TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
`);

let archivedSources = 0;
let neutralizedEvidence = 0;
let retriedFailures = 0;

// 1) Archivar fuentes basura históricas
const sources = db.prepare(`
SELECT id, topic
FROM knowledge_sources
WHERE status='ready'
`).all();

for (const s of sources) {
  if (!isStructureTopic(s.topic)) continue;

  db.prepare(`
    UPDATE knowledge_sources
    SET status='archived',
        updated_at=?
    WHERE id=?
  `).run(now, s.id);

  archivedSources++;
}

// 2) Neutralizar evidencia basura histórica
const evidence = db.prepare(`
SELECT id, topic
FROM topic_evidence_aggregation
`).all();

for (const e of evidence) {
  if (!isStructureTopic(e.topic)) continue;

  db.prepare(`
    UPDATE topic_evidence_aggregation
    SET evidence_level='archived_structure',
        confidence_bonus=0,
        reason=reason || '; hardener neutralized curriculum structure',
        updated_at=?
    WHERE id=?
  `).run(now, e.id);

  neutralizedEvidence++;
}

// 3) Reintentar fallos reales, pero no basura estructural
const failed = db.prepare(`
SELECT id, topic, stage
FROM learning_jobs
WHERE status='failed'
`).all();

for (const j of failed) {
  if (isStructureTopic(j.topic)) {
    db.prepare(`
      UPDATE learning_jobs
      SET status='archived',
          priority=0,
          updated_at=?
      WHERE id=?
    `).run(now, j.id);
    continue;
  }

  db.prepare(`
    UPDATE learning_jobs
    SET status='pending',
        priority=950000,
        updated_at=?
    WHERE id=?
  `).run(now, j.id);

  retriedFailures++;
}

db.prepare(`
INSERT OR REPLACE INTO alai_stability_log
(id, action, target, reason, created_at)
VALUES
(?, 'stability_harden', 'system', ?, ?)
`).run(
  `stability_${now}`,
  `archivedSources=${archivedSources}; neutralizedEvidence=${neutralizedEvidence}; retriedFailures=${retriedFailures}`,
  now
);

console.log(JSON.stringify({
  archived_structure_sources: archivedSources,
  neutralized_structure_evidence: neutralizedEvidence,
  retried_failed_jobs: retriedFailures,
  source_status: db.prepare(`
    SELECT status, COUNT(*) total
    FROM knowledge_sources
    GROUP BY status
  `).all(),
  failed_jobs_now: db.prepare(`
    SELECT stage, COUNT(*) total
    FROM learning_jobs
    WHERE status='failed'
    GROUP BY stage
  `).all(),
  top_pending: db.prepare(`
    SELECT stage, priority, topic
    FROM learning_jobs
    WHERE status='pending'
    ORDER BY priority DESC
    LIMIT 10
  `).all()
}, null, 2));

db.close();
