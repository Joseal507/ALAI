import Database from 'better-sqlite3';

const db = new Database('data/alai.db');
const now = Date.now();

function clean(raw) {
  let s = String(raw || '').trim();
  const target = s.match(/target=([^|]+)/i)?.[1];
  if (target) s = target.trim();

  s = s.replace(/^concepto:\s*/i, '');
  s = s.replace(/^concept:\s*/i, '');
  s = s.replace(/^name:\s*/i, '');
  s = s.replace(/^nombre:\s*/i, '');
  s = s.split(/\s+(description|descripcion|relation|relacion|path|task|reason|mastery_required):/i)[0].trim();
  s = s.split(/\s+\|\s+/)[0].trim();

  return s.replace(/\s+/g, ' ').replace(/[;:]+$/g, '').slice(0, 140);
}

const activeStage = db.prepare(`
SELECT active_stage FROM education_control WHERE id='main'
`).get()?.active_stage || 'UNIVERSIDAD';

const universityRequiredTargets = db.prepare(`
SELECT path
FROM education_required_coverage
WHERE stage=?
`).all(activeStage).map(r => {
  const parts = String(r.path).split('/');
  return parts[parts.length - 1];
});

const allowed = new Set(universityRequiredTargets.map(x => clean(x).toLowerCase()));

let archived = 0;
let sanitized = 0;
let reprioritized = 0;
let requiredQueued = 0;

// 1) Archivar refuerzos que NO pertenecen al required coverage del stage activo.
const pending = db.prepare(`
SELECT id, stage, topic, reason, status
FROM reinforcement_queue
WHERE status IN ('pending','queued')
`).all();

for (const r of pending) {
  const target = clean(r.topic);
  const key = target.toLowerCase();

  if (r.stage !== activeStage || !allowed.has(key)) {
    db.prepare(`
      UPDATE reinforcement_queue
      SET status='archived',
          updated_at=?
      WHERE id=?
    `).run(now, r.id);

    db.prepare(`
      UPDATE learning_jobs
      SET status='archived',
          priority=0,
          updated_at=?
      WHERE topic LIKE ?
        AND status='pending'
    `).run(now, `%target=${target}%`);

    archived++;
    continue;
  }

  db.prepare(`
    UPDATE reinforcement_queue
    SET topic=?,
        updated_at=?
    WHERE id=?
  `).run(
    `ALAI_REINFORCE_TOPIC | stage=${activeStage} | target=${target} | task=Improve required weak knowledge until mastery reaches 90+.`,
    now,
    r.id
  );

  sanitized++;
}

// 2) Re-priorizar required topics universitarios bajo 90.
const weakRequired = db.prepare(`
SELECT erc.path, COALESCE(mp.confidence, 0) AS confidence
FROM education_required_coverage erc
LEFT JOIN mastery_progress mp ON mp.path=erc.path
WHERE erc.stage=?
  AND COALESCE(mp.confidence, 0) < erc.mastery_required
ORDER BY confidence ASC
`).all(activeStage);

for (const row of weakRequired) {
  const parts = String(row.path).split('/');
  const target = parts[parts.length - 1];

  db.prepare(`
    UPDATE learning_jobs
    SET status='pending',
        priority=999999,
        updated_at=?
    WHERE stage=?
      AND topic LIKE ?
  `).run(now, activeStage, `%path=${row.path}%`);

  const changed = db.prepare(`
    SELECT changes() AS changed
  `).get().changed;

  if (!changed) {
    db.prepare(`
      INSERT OR IGNORE INTO learning_jobs
      (id, topic, stage, priority, status, created_at, updated_at)
      VALUES
      (@id, @topic, @stage, 999999, 'pending', @now, @now)
    `).run({
      id: `job_required_relearn_${activeStage}_${target}`.replace(/[^a-zA-Z0-9_]/g, '_'),
      topic: `ALAI_LEARN_TOPIC | stage=${activeStage} | path=${row.path} | target=${target} | mastery_required=90 | task=Relearn required topic deeply and raise mastery above 90.`,
      stage: activeStage,
      now
    });
  }

  requiredQueued++;
}

// 3) Bajar cualquier reinforce que haya sobrevivido por debajo de required.
db.prepare(`
UPDATE learning_jobs
SET priority=250000,
    updated_at=?
WHERE status='pending'
  AND topic LIKE 'ALAI_REINFORCE_TOPIC%'
`).run(now);

db.prepare(`
UPDATE learning_jobs
SET priority=999999,
    updated_at=?
WHERE status='pending'
  AND stage=?
  AND topic LIKE 'ALAI_LEARN_TOPIC%'
  AND topic LIKE '%path=%'
`).run(now, activeStage);

reprioritized = db.prepare("SELECT changes() AS c").get().c;

console.log(JSON.stringify({
  active_stage: activeStage,
  allowed_required_targets: [...allowed],
  archived_non_stage_reinforcements: archived,
  sanitized_stage_reinforcements: sanitized,
  weak_required_queued: requiredQueued,
  required_reprioritized: reprioritized,
  reinforcement_pending: db.prepare("SELECT COUNT(*) total FROM reinforcement_queue WHERE status='pending'").get().total,
  reinforcement_archived: db.prepare("SELECT COUNT(*) total FROM reinforcement_queue WHERE status='archived'").get().total
}, null, 2));

db.close();
