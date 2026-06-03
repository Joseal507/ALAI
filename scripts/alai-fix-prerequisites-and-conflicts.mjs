import Database from 'better-sqlite3';

const db = new Database('data/alai.db');
const now = Date.now();

function safe(s) {
  return String(s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 180);
}

function target(path) {
  return String(path || '').split('/').pop() || '';
}

const activeStage = db.prepare(
  "SELECT active_stage FROM education_control WHERE id='main'"
).get()?.active_stage || 'UNIVERSIDAD';

// 1) Si education_prerequisites está vacía o rara, crear tabla compatible paralela segura.
db.exec(`
CREATE TABLE IF NOT EXISTS education_prerequisite_links (
  id TEXT PRIMARY KEY,
  stage TEXT NOT NULL,
  topic_path TEXT NOT NULL,
  topic TEXT NOT NULL,
  prerequisite TEXT NOT NULL,
  prerequisite_path TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  confidence INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_prereq_links_stage ON education_prerequisite_links(stage);
CREATE INDEX IF NOT EXISTS idx_prereq_links_topic ON education_prerequisite_links(topic);
CREATE INDEX IF NOT EXISTS idx_prereq_links_status ON education_prerequisite_links(status);
`);

const seed = {
  'Dinámica': ['Vectores', 'Cinemática', 'Leyes de Newton', 'Fuerzas'],
  'Fuerzas': ['Vectores', 'Masa', 'Aceleración', 'Leyes de Newton'],
  'Movimiento': ['Posición', 'Velocidad', 'Aceleración', 'Gráficas de movimiento'],
  'Reacciones': ['Estequiometría', 'Enlaces químicos', 'Mol', 'Balanceo químico'],
  'Termodinámica': ['Energía', 'Calor', 'Temperatura', 'Trabajo', 'Conservación de energía'],
  'Sistema cardiovascular': ['Células', 'Tejidos', 'Sangre', 'Corazón', 'Circulación'],
  'Sistema respiratorio': ['Células', 'Tejidos', 'Pulmones', 'Intercambio gaseoso'],
  'Neurofisiología': ['Neuronas', 'Sistema nervioso', 'Potencial de acción', 'Sinapsis'],
  'Órganos': ['Células', 'Tejidos', 'Sistemas del cuerpo'],
  'Sistema muscular': ['Tejidos', 'Músculo esquelético', 'Contracción muscular'],
  'Sistema óseo': ['Tejidos', 'Huesos', 'Articulaciones', 'Minerales']
};

let prereqLinks = 0;
let prereqJobs = 0;

const required = db.prepare(`
SELECT path
FROM education_required_coverage
WHERE stage=?
`).all(activeStage);

const insertLink = db.prepare(`
INSERT OR REPLACE INTO education_prerequisite_links
(id, stage, topic_path, topic, prerequisite, prerequisite_path, status, confidence, created_at, updated_at)
VALUES
(@id, @stage, @topic_path, @topic, @prerequisite, @prerequisite_path, @status, @confidence, @now, @now)
`);

for (const r of required) {
  const topic = target(r.path);
  const prereqs = seed[topic] || [];

  for (const p of prereqs) {
    const ku = db.prepare(`
      SELECT MAX(confidence) confidence
      FROM knowledge_units
      WHERE lower(title)=lower(?)
    `).get(p);

    const confidence = Number(ku?.confidence || 0);
    const done = confidence >= 80;

    insertLink.run({
      id: `epl_${safe(r.path)}_${safe(p)}`,
      stage: activeStage,
      topic_path: r.path,
      topic,
      prerequisite: p,
      prerequisite_path: `${activeStage}/PREREQUISITES/${topic}/${p}`,
      status: done ? 'satisfied' : 'missing',
      confidence,
      now
    });

    prereqLinks++;

    if (!done) {
      db.prepare(`
        INSERT OR IGNORE INTO learning_jobs
        (id, topic, stage, priority, status, created_at, updated_at)
        VALUES
        (@id, @topic, @stage, 950000, 'pending', @now, @now)
      `).run({
        id: `job_prereq_${activeStage}_${safe(topic)}_${safe(p)}`,
        topic: `ALAI_LEARN_TOPIC | stage=${activeStage} | parent=${topic} | target=${p} | task=Learn prerequisite deeply before mastering ${topic}.`,
        stage: activeStage,
        now
      });

      prereqJobs++;
    }
  }
}

// 2) Contradiction Resolution Engine básico.
db.exec(`
CREATE TABLE IF NOT EXISTS contradiction_resolutions (
  id TEXT PRIMARY KEY,
  conflict_id TEXT NOT NULL,
  status TEXT NOT NULL,
  action TEXT NOT NULL,
  reason TEXT NOT NULL,
  confidence_delta INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
`);

let resolved = 0;
let dismissed = 0;

const conflicts = db.prepare(`
SELECT id, knowledge_a, knowledge_b, title_a, title_b, reason, status
FROM knowledge_conflicts
WHERE status='open'
LIMIT 200
`).all();

for (const c of conflicts) {
  const sameTitle = String(c.title_a || '').toLowerCase() === String(c.title_b || '').toLowerCase();

  if (!sameTitle) {
    db.prepare(`
      UPDATE knowledge_conflicts
      SET status='dismissed',
          updated_at=?
      WHERE id=?
    `).run(now, c.id);

    db.prepare(`
      INSERT OR REPLACE INTO contradiction_resolutions
      (id, conflict_id, status, action, reason, confidence_delta, created_at, updated_at)
      VALUES
      (@id, @conflict_id, 'dismissed', 'dismiss_false_positive', @reason, 0, @now, @now)
    `).run({
      id: `cr_${safe(c.id)}`,
      conflict_id: c.id,
      reason: 'Different titles/domains; likely heuristic false positive.',
      now
    });

    dismissed++;
    continue;
  }

  db.prepare(`
    INSERT OR REPLACE INTO contradiction_resolutions
    (id, conflict_id, status, action, reason, confidence_delta, created_at, updated_at)
    VALUES
    (@id, @conflict_id, 'needs_review', 'manual_or_source_review_required', @reason, -10, @now, @now)
  `).run({
    id: `cr_${safe(c.id)}`,
    conflict_id: c.id,
    reason: 'Same topic conflict requires stronger source verification.',
    now
  });

  resolved++;
}

console.log(JSON.stringify({
  active_stage: activeStage,
  prerequisite_links_upserted: prereqLinks,
  prerequisite_jobs_created_attempted: prereqJobs,
  prerequisite_link_counts: db.prepare(`
    SELECT status, COUNT(*) total
    FROM education_prerequisite_links
    WHERE stage=?
    GROUP BY status
  `).all(activeStage),
  conflicts_dismissed_false_positive: dismissed,
  conflicts_marked_needs_review: resolved,
  next_jobs: db.prepare(`
    SELECT stage, priority, substr(topic,1,160) topic
    FROM learning_jobs
    WHERE status='pending'
    ORDER BY priority DESC
    LIMIT 15
  `).all()
}, null, 2));

db.close();
