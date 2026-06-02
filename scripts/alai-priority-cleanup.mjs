import Database from 'better-sqlite3';

const db = new Database('data/alai.db');
const now = Date.now();

const active = db
  .prepare("SELECT active_stage FROM education_control WHERE id='main'")
  .get()?.active_stage || 'MEDIA';

console.log('Active stage:', active);

// 1. Bajar todo lo no obligatorio/UNKNOWN
db.prepare(`
UPDATE learning_jobs
SET priority=1000, updated_at=?
WHERE status='pending'
  AND stage='UNKNOWN'
`).run(now);

// 2. Archivar basura semántica conocida
const garbage = [
  '%Ingles Markets%',
  '%El Corte Ingles%',
  '%Grandes almacenes%',
  '%Department Stores%',
  '%Cadenas de supermercados%',
  '%ARTE es un ejemplo%',
  '%television publica%',
  '%Commedia dell%',
  '%Judaeo-espanol%',
  '%Indo-europeo%',
  '%Peninsula Iberica%'
];

for (const pattern of garbage) {
  db.prepare(`
  UPDATE learning_jobs
  SET status='archived', priority=0, updated_at=?
  WHERE status='pending'
    AND topic LIKE ?
  `).run(now, pattern);
}

// 3. Prioridad máxima a required topics del nivel activo
db.prepare(`
UPDATE learning_jobs
SET priority=400000, updated_at=?
WHERE status='pending'
  AND stage=?
  AND topic LIKE 'ALAI_LEARN_TOPIC | stage=%'
  AND topic LIKE '%path=%'
`).run(now, active);

// 4. Curriculum expand del nivel activo debajo de required topics
db.prepare(`
UPDATE learning_jobs
SET priority=200000, updated_at=?
WHERE status='pending'
  AND stage=?
  AND topic LIKE 'ALAI_CURRICULUM_EXPAND | stage=%'
`).run(now, active);

// 5. Discovered child topics del nivel activo, pero debajo
db.prepare(`
UPDATE learning_jobs
SET priority=50000, updated_at=?
WHERE status='pending'
  AND topic LIKE 'ALAI_LEARN_TOPIC | stage=' || ? || '%'
  AND topic NOT LIKE '%path=%'
`).run(now, active);

// 6. Niveles futuros quedan apagados hasta que el gate avance
db.prepare(`
UPDATE learning_jobs
SET priority=0, updated_at=?
WHERE status='pending'
  AND stage NOT IN (?, 'CHAT_PRIORITY')
  AND stage != 'UNKNOWN'
`).run(now, active);

// 7. Chat siempre gana
db.prepare(`
UPDATE learning_jobs
SET priority=999999, updated_at=?
WHERE status='pending'
  AND (
    topic LIKE 'CHAT_REQUEST |%'
    OR topic LIKE 'USER_QUESTION |%'
  )
`).run(now);

const rows = db.prepare(`
SELECT stage, priority, topic
FROM learning_jobs
WHERE status='pending'
ORDER BY priority DESC, created_at ASC
LIMIT 20
`).all();

console.log('\nTop 20 pending jobs:');
for (const r of rows) {
  console.log(`[${r.stage}] p=${r.priority} ${r.topic.slice(0, 180)}`);
}

db.close();
