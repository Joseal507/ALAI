import Database from 'better-sqlite3';

const db = new Database('data/alai.db');
const now = Date.now();

function cols(table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
}

function addColumn(table, column, type) {
  if (!cols(table).includes(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    return true;
  }
  return false;
}

const added = [];
if (addColumn('learning_jobs', 'job_type', "TEXT DEFAULT 'learning'")) added.push('learning_jobs.job_type');
if (addColumn('learning_jobs', 'attempts', "INTEGER DEFAULT 0")) added.push('learning_jobs.attempts');
if (addColumn('learning_jobs', 'last_error', "TEXT DEFAULT ''")) added.push('learning_jobs.last_error');

db.exec(`
CREATE TABLE IF NOT EXISTS curiosity_questions (
  id TEXT PRIMARY KEY,
  topic TEXT NOT NULL,
  question TEXT NOT NULL,
  reason TEXT NOT NULL,
  priority INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS scientific_reasoning_tasks (
  id TEXT PRIMARY KEY,
  topic TEXT NOT NULL,
  observation TEXT NOT NULL,
  hypothesis TEXT NOT NULL,
  prediction TEXT NOT NULL,
  validation_plan TEXT NOT NULL,
  priority INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
`);

const activeStage = db.prepare("SELECT active_stage FROM education_control WHERE id='main'").get()?.active_stage || 'UNIVERSIDAD';

function safe(s='') {
  return String(s)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 160);
}

function addJob(type, topic, priority) {
  db.prepare(`
    INSERT OR IGNORE INTO learning_jobs
    (id, stage, topic, priority, status, created_at, updated_at, job_type)
    VALUES
    (@id, @stage, @topic, @priority, 'pending', @now, @now, @type)
  `).run({
    id: `job_${safe(type)}_${safe(topic)}`,
    stage: activeStage,
    topic,
    priority,
    type,
    now
  });
}

let curiosity = 0;
let science = 0;

// 1) Curiosity: conceptos importantes con pocas relaciones
const sparse = db.prepare(`
SELECT ku.title, ku.confidence, COUNT(kr.id) rels
FROM knowledge_units ku
LEFT JOIN knowledge_relationships kr
  ON lower(kr.source_title)=lower(ku.title)
  OR lower(kr.target_title)=lower(ku.title)
GROUP BY ku.id
HAVING rels < 4
ORDER BY ku.confidence DESC, rels ASC
LIMIT 40
`).all();

for (const r of sparse) {
  const q = `¿Qué prerequisitos, aplicaciones, ejemplos, dependencias y contradicciones faltan para entender profundamente ${r.title}?`;

  db.prepare(`
    INSERT OR IGNORE INTO curiosity_questions
    (id, topic, question, reason, priority, status, created_at, updated_at)
    VALUES
    (@id, @topic, @question, @reason, 910000, 'pending', @now, @now)
  `).run({
    id: `cur_${safe(r.title)}`,
    topic: r.title,
    question: q,
    reason: `Sparse graph: only ${r.rels} relationships; confidence=${r.confidence}`,
    now
  });

  addJob(
    'curiosity',
    `ALAI_CURIOSITY | stage=${activeStage} | target=${r.title} | task=${q}`,
    910000
  );

  curiosity++;
}

// 2) Hypothesis verification -> scientific tasks
const hyps = db.prepare(`
SELECT topic, hypothesis, confidence
FROM knowledge_hypotheses
WHERE status='needs_verification'
ORDER BY confidence DESC
LIMIT 50
`).all();

for (const h of hyps) {
  const observation = `ALAI generated a hypothesis about ${h.topic}.`;
  const prediction = `If the hypothesis is correct, sources or graph relationships should support both concepts interacting in the same mechanism, prerequisite chain, application, or causal pathway.`;
  const validation = `Find evidence, reject weak links, promote supported links into knowledge_relationships, and create stronger claims.`;

  db.prepare(`
    INSERT OR IGNORE INTO scientific_reasoning_tasks
    (id, topic, observation, hypothesis, prediction, validation_plan, priority, status, created_at, updated_at)
    VALUES
    (@id, @topic, @observation, @hypothesis, @prediction, @validation, 930000, 'pending', @now, @now)
  `).run({
    id: `sci_${safe(h.topic)}_${safe(h.hypothesis)}`,
    topic: h.topic,
    observation,
    hypothesis: h.hypothesis,
    prediction,
    validation,
    now
  });

  addJob(
    'scientific_reasoning',
    `ALAI_SCIENTIFIC_REASONING | stage=${activeStage} | target=${h.topic} | observation=${observation} | hypothesis=${h.hypothesis} | prediction=${prediction} | validation=${validation}`,
    930000
  );

  science++;
}

// 3) Retry reasoning feedback jobs already created but failed before schema fix
db.prepare(`
UPDATE learning_jobs
SET status='pending',
    priority=MAX(priority, 900000),
    updated_at=?
WHERE topic LIKE 'ALAI_REASONING_FEEDBACK%'
`).run(now);

console.log(JSON.stringify({
  active_stage: activeStage,
  columns_added: added,
  curiosity_created_attempted: curiosity,
  scientific_tasks_created_attempted: science,
  job_type_summary: db.prepare(`
    SELECT job_type, status, COUNT(*) total
    FROM learning_jobs
    GROUP BY job_type, status
    ORDER BY total DESC
  `).all(),
  curiosity_total: db.prepare("SELECT COUNT(*) total FROM curiosity_questions").get().total,
  scientific_total: db.prepare("SELECT COUNT(*) total FROM scientific_reasoning_tasks").get().total
}, null, 2));

db.close();
