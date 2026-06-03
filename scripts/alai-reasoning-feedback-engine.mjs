import Database from 'better-sqlite3';

const db = new Database('data/alai.db');
const now = Date.now();

const activeStage = db.prepare(
  "SELECT active_stage FROM education_control WHERE id='main'"
).get()?.active_stage || 'UNIVERSIDAD';

function safe(s='') {
  return String(s)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 160);
}

db.exec(`
CREATE TABLE IF NOT EXISTS reasoning_feedback_tasks (
  id TEXT PRIMARY KEY,
  topic TEXT NOT NULL,
  reason TEXT NOT NULL,
  task_type TEXT NOT NULL,
  priority INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
`);

let created = 0;

function addTask(topic, reason, type, priority) {
  const id = `rft_${safe(type)}_${safe(topic)}`;
  db.prepare(`
    INSERT OR IGNORE INTO reasoning_feedback_tasks
    (id, topic, reason, task_type, priority, status, created_at, updated_at)
    VALUES
    (@id, @topic, @reason, @type, @priority, 'pending', @now, @now)
  `).run({ id, topic, reason, type, priority, now });

  db.prepare(`
    INSERT OR IGNORE INTO learning_jobs
    (id, stage, topic, priority, status, created_at, updated_at, job_type)
    VALUES
    (@jobId, @stage, @jobTopic, @priority, 'pending', @now, @now, 'reasoning_feedback')
  `).run({
    jobId: `job_${id}`,
    stage: activeStage,
    jobTopic: `ALAI_REASONING_FEEDBACK | stage=${activeStage} | target=${topic} | task=${reason}`,
    priority,
    now
  });

  created++;
}

// 1) Claims con needs_review alto
const weakClaims = db.prepare(`
SELECT topic, total_claims, supported_claims, needs_review_claims, needs_review_ratio
FROM claim_verification_scores
WHERE action='reinforce_and_research'
ORDER BY needs_review_ratio DESC, needs_review_claims DESC
LIMIT 30
`).all();

for (const r of weakClaims) {
  addTask(
    r.topic,
    `Fix weak claim set: ${r.needs_review_claims}/${r.total_claims} claims need review. Generate cleaner atomic claims, stronger sources, and contradictions check.`,
    'weak_claims',
    990000
  );
}

// 2) Hipótesis sin verificar
const hypotheses = db.prepare(`
SELECT topic, COUNT(*) total, ROUND(AVG(confidence),2) avg_confidence
FROM knowledge_hypotheses
WHERE status='needs_verification'
GROUP BY topic
ORDER BY total DESC, avg_confidence DESC
LIMIT 30
`).all();

for (const h of hypotheses) {
  addTask(
    h.topic,
    `Verify generated hypotheses: ${h.total} pending hypotheses avg_confidence=${h.avg_confidence}. Find evidence, reject weak hypotheses, promote strong ones into relationships.`,
    'hypothesis_verification',
    880000
  );
}

// 3) Temas con pocas relaciones
const sparseGraph = db.prepare(`
SELECT ku.title, ku.confidence, COUNT(kr.id) rels
FROM knowledge_units ku
LEFT JOIN knowledge_relationships kr
  ON lower(kr.source_title)=lower(ku.title)
  OR lower(kr.target_title)=lower(ku.title)
GROUP BY ku.id
HAVING rels < 3 AND ku.confidence >= 70
ORDER BY rels ASC, ku.confidence DESC
LIMIT 30
`).all();

for (const g of sparseGraph) {
  addTask(
    g.title,
    `Improve graph density: topic has only ${g.rels} relationships. Add prerequisites, dependencies, examples, applications, specializations, and related concepts.`,
    'sparse_graph',
    820000
  );
}

// 4) Temas con knowledge confidence bajo
const weakKnowledge = db.prepare(`
SELECT title, confidence
FROM knowledge_units
WHERE confidence < 75
ORDER BY confidence ASC, updated_at ASC
LIMIT 30
`).all();

for (const k of weakKnowledge) {
  addTask(
    k.title,
    `Raise weak knowledge confidence from ${k.confidence}. Relearn with better explanation, examples, claims, sources, relationships, and verification.`,
    'weak_knowledge',
    850000
  );
}

console.log(JSON.stringify({
  active_stage: activeStage,
  reasoning_feedback_created_attempted: created,
  feedback_summary: db.prepare(`
    SELECT task_type, COUNT(*) total
    FROM reasoning_feedback_tasks
    GROUP BY task_type
    ORDER BY total DESC
  `).all(),
  top_feedback_jobs: db.prepare(`
    SELECT priority, topic
    FROM learning_jobs
    WHERE job_type='reasoning_feedback'
      AND status='pending'
    ORDER BY priority DESC
    LIMIT 20
  `).all()
}, null, 2));

db.close();
