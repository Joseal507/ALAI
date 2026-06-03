import Database from 'better-sqlite3';

const db = new Database('data/alai.db');
const now = Date.now();

function id(s) {
  return String(s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 180);
}

const activeStage = db.prepare("SELECT active_stage FROM education_control WHERE id='main'").get()?.active_stage || 'UNIVERSIDAD';

db.exec(`
CREATE TABLE IF NOT EXISTS prerequisite_plans (
  id TEXT PRIMARY KEY,
  stage TEXT NOT NULL,
  topic_path TEXT NOT NULL,
  topic TEXT NOT NULL,
  missing_prerequisites TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
`);

const prereqCols = db.prepare("PRAGMA table_info(education_prerequisites)").all().map(x => x.name);
const hasTopicPath = prereqCols.includes('topic_path');
const hasPrereqPath = prereqCols.includes('prerequisite_path');
const hasStage = prereqCols.includes('stage');
const hasTopic = prereqCols.includes('topic');
const hasPrereq = prereqCols.includes('prerequisite');

function insertPrereq(stage, topicPath, topic, prereq) {
  const prereqPath = `${stage}/PREREQUISITES/${topic}/${prereq}`;

  const cols = ['id'];
  const vals = ['@id'];
  const data = {
    id: `pr_${id(topicPath)}_${id(prereq)}`,
    stage,
    topic_path: topicPath,
    prerequisite_path: prereqPath,
    topic,
    prerequisite: prereq,
    created_at: now,
    updated_at: now
  };

  if (hasStage) { cols.push('stage'); vals.push('@stage'); }
  if (hasTopicPath) { cols.push('topic_path'); vals.push('@topic_path'); }
  if (hasPrereqPath) { cols.push('prerequisite_path'); vals.push('@prerequisite_path'); }
  if (hasTopic) { cols.push('topic'); vals.push('@topic'); }
  if (hasPrereq) { cols.push('prerequisite'); vals.push('@prerequisite'); }
  if (prereqCols.includes('created_at')) { cols.push('created_at'); vals.push('@created_at'); }
  if (prereqCols.includes('updated_at')) { cols.push('updated_at'); vals.push('@updated_at'); }

  db.prepare(`
    INSERT OR IGNORE INTO education_prerequisites
    (${cols.join(',')})
    VALUES (${vals.join(',')})
  `).run(data);
}

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

const required = db.prepare(`
SELECT path
FROM education_required_coverage
WHERE stage=?
`).all(activeStage);

let seeded = 0;
let plans = 0;
let jobs = 0;

for (const r of required) {
  const topic = String(r.path).split('/').pop();
  const prereqs = seed[topic] || [];

  for (const p of prereqs) {
    insertPrereq(activeStage, r.path, topic, p);
    seeded++;
  }

  const missing = [];

  for (const p of prereqs) {
    const ku = db.prepare(`
      SELECT MAX(confidence) confidence
      FROM knowledge_units
      WHERE lower(title)=lower(?)
    `).get(p);

    const confidence = Number(ku?.confidence || 0);

    if (confidence < 80) {
      missing.push(p);

      const jobId = `job_prereq_${activeStage}_${id(topic)}_${id(p)}`;

      db.prepare(`
        INSERT OR IGNORE INTO learning_jobs
        (id, topic, stage, priority, status, created_at, updated_at)
        VALUES
        (@id, @topic, @stage, 950000, 'pending', @now, @now)
      `).run({
        id: jobId,
        topic: `ALAI_LEARN_TOPIC | stage=${activeStage} | parent=${topic} | target=${p} | task=Learn prerequisite deeply before mastering ${topic}.`,
        stage: activeStage,
        now
      });

      jobs++;
    }
  }

  if (missing.length) {
    db.prepare(`
      INSERT OR REPLACE INTO prerequisite_plans
      (id, stage, topic_path, topic, missing_prerequisites, status, created_at, updated_at)
      VALUES
      (@id, @stage, @topic_path, @topic, @missing, 'missing_prerequisites', @now, @now)
    `).run({
      id: `pp_${id(r.path)}`,
      stage: activeStage,
      topic_path: r.path,
      topic,
      missing: JSON.stringify(missing),
      now
    });

    plans++;
  }
}

console.log(JSON.stringify({
  active_stage: activeStage,
  prerequisites_seeded_attempted: seeded,
  prerequisite_plans_created: plans,
  prerequisite_jobs_created_attempted: jobs,
  prerequisite_rows: db.prepare("SELECT COUNT(*) total FROM education_prerequisites").get().total,
  top_next: db.prepare(`
    SELECT stage, priority, substr(topic,1,160) topic
    FROM learning_jobs
    WHERE status='pending'
    ORDER BY priority DESC
    LIMIT 15
  `).all()
}, null, 2));

db.close();
