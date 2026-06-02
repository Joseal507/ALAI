import Database from 'better-sqlite3';

const db = new Database('data/alai.db');
const now = Date.now();

function clean(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

function slug(s) {
  return clean(s)
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 100);
}

function extractStage(topic) {
  const m = String(topic || '').match(/stage=([A-Z_]+)/i);
  return m ? m[1].toUpperCase() : null;
}

function extractTarget(topic) {
  let s = String(topic || '');
  const target = s.match(/target=([^|]+)/i)?.[1];
  if (target) s = target;

  s = s.replace(/^concepto:\s*/i, '');
  s = s.replace(/^concept:\s*/i, '');
  s = s.replace(/^nombre:\s*/i, '');
  s = s.split(/\s+(description|descripcion|relation|relacion|path|mastery_required|task):/i)[0];

  return clean(s).slice(0, 140);
}

db.exec(`
CREATE TABLE IF NOT EXISTS self_evaluations (
  id TEXT PRIMARY KEY,
  knowledge_id TEXT NOT NULL,
  title TEXT NOT NULL,
  score INTEGER NOT NULL,
  status TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
`);

let fixedStage = 0;
let archivedBadUnknown = 0;
let reinforcementCreated = 0;
let evaluations = 0;
let conflictsOpened = 0;

// 1) Corregir stage UNKNOWN si el topic trae stage=...
const unknownJobs = db.prepare(`
SELECT id, topic, stage
FROM learning_jobs
WHERE stage='UNKNOWN'
`).all();

for (const j of unknownJobs) {
  const stage = extractStage(j.topic);
  const target = extractTarget(j.topic);

  if (stage) {
    db.prepare(`
      UPDATE learning_jobs
      SET stage=?,
          topic=?,
          updated_at=?
      WHERE id=?
    `).run(
      stage,
      `ALAI_LEARN_TOPIC | stage=${stage} | target=${target} | task=Learn this discovered child topic completely.`,
      now,
      j.id
    );
    fixedStage++;
  } else {
    db.prepare(`
      UPDATE learning_jobs
      SET status='archived',
          priority=0,
          updated_at=?
      WHERE id=?
    `).run(now, j.id);
    archivedBadUnknown++;
  }
}

// 2) Reinforcement Engine basado en learning_quality
db.exec(`
CREATE TABLE IF NOT EXISTS reinforcement_queue (
  id TEXT PRIMARY KEY,
  stage TEXT NOT NULL,
  topic TEXT NOT NULL,
  reason TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 100000,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
`);

const weak = db.prepare(`
SELECT knowledge_id, title, score, claims, verified, inferences, conflicts, confidence
FROM learning_quality
WHERE score < 70
ORDER BY score ASC
LIMIT 50
`).all();

const insertReinforcement = db.prepare(`
INSERT OR IGNORE INTO reinforcement_queue
(id, stage, topic, reason, priority, status, created_at, updated_at)
VALUES
(@id, @stage, @topic, @reason, @priority, 'pending', @now, @now)
`);

const activeStage = db.prepare(`
SELECT active_stage FROM education_control WHERE id='main'
`).get()?.active_stage || 'UNIVERSIDAD';

for (const w of weak) {
  insertReinforcement.run({
    id: `rq_lq_${slug(w.knowledge_id)}`,
    stage: activeStage,
    topic: `ALAI_REINFORCE_TOPIC | stage=${activeStage} | target=${w.title} | task=Improve weak knowledge using claims, examples, entities, inferences, and verification.`,
    reason: `learning_quality_score=${w.score}; claims=${w.claims}; verified=${w.verified}; inferences=${w.inferences}; conflicts=${w.conflicts}; confidence=${w.confidence}`,
    priority: 250000,
    now
  });
  reinforcementCreated++;
}

// 3) Self-Evaluation Loop
const insertEval = db.prepare(`
INSERT OR REPLACE INTO self_evaluations
(id, knowledge_id, title, score, status, reason, created_at, updated_at)
VALUES
(@id, @knowledge_id, @title, @score, @status, @reason, @now, @now)
`);

const qualities = db.prepare(`
SELECT knowledge_id, title, score, claims, verified, inferences, conflicts, confidence
FROM learning_quality
`).all();

for (const q of qualities) {
  let status = 'mastered';
  const reasons = [];

  if (q.score < 70) {
    status = 'weak';
    reasons.push('quality_score_below_70');
  } else if (q.score < 85) {
    status = 'developing';
    reasons.push('quality_score_below_85');
  }

  if (q.claims < 3) {
    status = status === 'mastered' ? 'developing' : status;
    reasons.push('few_claims');
  }

  if (q.verified < q.claims) {
    status = status === 'mastered' ? 'developing' : status;
    reasons.push('not_all_claims_verified');
  }

  if (q.conflicts > 0) {
    status = 'conflicted';
    reasons.push('has_open_conflicts');
  }

  insertEval.run({
    id: `se_${slug(q.knowledge_id)}`,
    knowledge_id: q.knowledge_id,
    title: q.title,
    score: q.score,
    status,
    reason: reasons.join(',') || 'strong_quality_signal',
    now
  });
  evaluations++;
}

// 4) Contradiction Resolution básico
// Marca conflictos abiertos y baja calidad de unidades involucradas.
const conflicts = db.prepare(`
SELECT id, knowledge_a, knowledge_b, title_a, title_b, reason, status
FROM knowledge_conflicts
WHERE status='open'
`).all();

for (const c of conflicts) {
  db.prepare(`
    UPDATE learning_quality
    SET conflicts = conflicts + 1,
        score = MAX(0, score - 10),
        updated_at=?
    WHERE knowledge_id IN (?, ?)
  `).run(now, c.knowledge_a, c.knowledge_b);

  db.prepare(`
    UPDATE self_evaluations
    SET status='conflicted',
        reason=reason || ',open_conflict',
        updated_at=?
    WHERE knowledge_id IN (?, ?)
  `).run(now, c.knowledge_a, c.knowledge_b);

  conflictsOpened++;
}

// Recalibrar prioridades: required actual arriba; reinforcement debajo; discovered bajo.
db.prepare(`
UPDATE learning_jobs
SET priority=400000,
    updated_at=?
WHERE status='pending'
  AND stage=?
  AND topic LIKE 'ALAI_LEARN_TOPIC%'
  AND topic LIKE '%path=%'
`).run(now, activeStage);

db.prepare(`
UPDATE learning_jobs
SET priority=50000,
    updated_at=?
WHERE status='pending'
  AND stage=?
  AND topic LIKE 'ALAI_LEARN_TOPIC%'
  AND topic NOT LIKE '%path=%'
`).run(now, activeStage);

db.prepare(`
UPDATE learning_jobs
SET status='archived',
    priority=0,
    updated_at=?
WHERE status='pending'
  AND stage='UNKNOWN'
`).run(now);

console.log(JSON.stringify({
  active_stage: activeStage,
  fixed_stage_from_topic: fixedStage,
  archived_bad_unknown: archivedBadUnknown,
  reinforcement_created_attempted: reinforcementCreated,
  self_evaluations: evaluations,
  conflicts_processed: conflictsOpened,
  reinforcement_pending: db.prepare("SELECT COUNT(*) total FROM reinforcement_queue WHERE status='pending'").get().total,
  weak_evaluations: db.prepare("SELECT COUNT(*) total FROM self_evaluations WHERE status='weak'").get().total,
  developing_evaluations: db.prepare("SELECT COUNT(*) total FROM self_evaluations WHERE status='developing'").get().total,
  mastered_evaluations: db.prepare("SELECT COUNT(*) total FROM self_evaluations WHERE status='mastered'").get().total,
  conflicted_evaluations: db.prepare("SELECT COUNT(*) total FROM self_evaluations WHERE status='conflicted'").get().total
}, null, 2));

db.close();
