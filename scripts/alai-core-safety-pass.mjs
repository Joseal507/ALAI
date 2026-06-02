import Database from 'better-sqlite3';

const db = new Database('data/alai.db');
const now = Date.now();

function cleanTarget(raw) {
  let s = String(raw || '').trim();

  const target = s.match(/target=([^|]+)/i)?.[1];
  if (target) s = target.trim();

  s = s.replace(/^concepto:\s*/i, '');
  s = s.replace(/^concept:\s*/i, '');
  s = s.replace(/^nombre:\s*/i, '');

  s = s.split(/\s+(description|descripcion|relation|relacion|path|mastery_required|task):/i)[0].trim();
  s = s.split(/\s+\|\s+/)[0].trim();

  return s.replace(/\s+/g, ' ').slice(0, 120);
}

const active = db.prepare(`
SELECT active_stage FROM education_control WHERE id='main'
`).get()?.active_stage || 'MEDIA';

console.log('Active stage:', active);

// 1) Nunca aprender UNKNOWN directamente.
db.prepare(`
UPDATE learning_jobs
SET status='archived',
    priority=0,
    updated_at=?
WHERE status='pending'
  AND stage='UNKNOWN'
`).run(now);

// 2) Apagar niveles que no son el activo.
db.prepare(`
UPDATE learning_jobs
SET priority=0,
    updated_at=?
WHERE status='pending'
  AND stage != ?
  AND stage != 'CHAT_PRIORITY'
`).run(now, active);

// 3) Required topics del nivel activo siempre primero.
db.prepare(`
UPDATE learning_jobs
SET priority=400000,
    updated_at=?
WHERE status='pending'
  AND stage=?
  AND topic LIKE 'ALAI_LEARN_TOPIC%'
  AND topic LIKE '%path=%'
`).run(now, active);

// 4) Curriculum expand debajo de required.
db.prepare(`
UPDATE learning_jobs
SET priority=200000,
    updated_at=?
WHERE status='pending'
  AND stage=?
  AND topic LIKE 'ALAI_CURRICULUM_EXPAND%'
`).run(now, active);

// 5) Descubiertos del nivel activo abajo.
db.prepare(`
UPDATE learning_jobs
SET priority=50000,
    updated_at=?
WHERE status='pending'
  AND stage=?
  AND topic LIKE 'ALAI_LEARN_TOPIC%'
  AND topic NOT LIKE '%path=%'
`).run(now, active);

// 6) Basura conocida fuera.
const garbage = [
  '%Ingles Markets%',
  '%El Corte Ingles%',
  '%Grandes almacenes%',
  '%Department Stores%',
  '%Cadenas de supermercados%',
  '%Judaeo-espanol%',
  '%Indo-europeo%',
  '%Peninsula Iberica%',
  '%ARTE es un ejemplo%',
  '%television publica%',
  '%Cultura europea%',
  '%Medios publicos%'
];

for (const g of garbage) {
  db.prepare(`
    UPDATE learning_jobs
    SET status='archived',
        priority=0,
        updated_at=?
    WHERE status IN ('pending','failed')
      AND topic LIKE ?
  `).run(now, g);
}

// 7) Normalizar jobs contaminados que sí tengan stage válido.
const rows = db.prepare(`
SELECT id, topic, stage
FROM learning_jobs
WHERE status='pending'
  AND stage=?
  AND (
    topic LIKE '%concept:%'
    OR topic LIKE '%concepto:%'
    OR topic LIKE '%nombre:%'
    OR topic LIKE '%description:%'
    OR topic LIKE '%descripcion:%'
    OR topic LIKE '%relation:%'
    OR topic LIKE '%relacion:%'
  )
`).all(active);

let normalized = 0;

for (const r of rows) {
  const target = cleanTarget(r.topic);
  if (!target || target.length < 2) {
    db.prepare(`
      UPDATE learning_jobs
      SET status='archived',
          priority=0,
          updated_at=?
      WHERE id=?
    `).run(now, r.id);
    continue;
  }

  db.prepare(`
    UPDATE learning_jobs
    SET topic=?,
        priority=50000,
        updated_at=?
    WHERE id=?
  `).run(
    `ALAI_LEARN_TOPIC | stage=${active} | target=${target} | task=Learn this discovered child topic completely.`,
    now,
    r.id
  );

  normalized++;
}

// 8) Reset running colgados.
db.prepare(`
UPDATE learning_jobs
SET status='pending',
    updated_at=?
WHERE status='running'
`).run(now);

const top = db.prepare(`
SELECT stage, priority, topic
FROM learning_jobs
WHERE status='pending'
ORDER BY priority DESC, created_at ASC
LIMIT 20
`).all();

console.log(JSON.stringify({
  active_stage: active,
  normalized,
  top
}, null, 2));

db.close();
