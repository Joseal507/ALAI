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
  s = s.replace(/^target=name:\s*/i, '');
  s = s.replace(/^target=nombre:\s*/i, '');

  s = s.split(/\s+(description|descripcion|relation|relacion|path|task|reason|mastery_required):/i)[0].trim();
  s = s.split(/\s+\|\s+/)[0].trim();

  return s.replace(/\s+/g, ' ').replace(/[;:]+$/g, '').slice(0, 140);
}

function extractPath(topic) {
  return String(topic || '').match(/path=([^|]+)/i)?.[1]?.trim() || null;
}

function extractTarget(topic) {
  return clean(topic);
}

function safeId(path) {
  return `mp_${String(path)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 180)}`;
}

const masteryCols = db.prepare(`PRAGMA table_info(mastery_progress)`).all().map(c => c.name);
const hasUpdatedAt = masteryCols.includes('updated_at');
const hasCreatedAt = masteryCols.includes('created_at');

let synced = 0;
let sanitizedJobs = 0;
let closedReinforcements = 0;
let reprioritized = 0;

const completed = db.prepare(`
SELECT id, topic, stage
FROM learning_jobs
WHERE status='completed'
  AND topic LIKE 'ALAI_LEARN_TOPIC%'
  AND topic LIKE '%path=%'
`).all();

for (const job of completed) {
  const path = extractPath(job.topic);
  if (!path) continue;

  const target = extractTarget(job.topic);
  const ku = db.prepare(`
    SELECT confidence
    FROM knowledge_units
    WHERE lower(title)=lower(?)
    ORDER BY updated_at DESC
    LIMIT 1
  `).get(target);

  const confidence = Number(ku?.confidence || 0);
  if (!confidence) continue;

  const existing = db.prepare(`
    SELECT path
    FROM mastery_progress
    WHERE path=?
  `).get(path);

  if (existing) {
    const sql = hasUpdatedAt
      ? `UPDATE mastery_progress SET confidence=MAX(confidence, ?), completed=CASE WHEN MAX(confidence, ?) >= 90 THEN 1 ELSE completed END, verified=CASE WHEN MAX(confidence, ?) >= 90 THEN 1 ELSE verified END, updated_at=? WHERE path=?`
      : `UPDATE mastery_progress SET confidence=MAX(confidence, ?), completed=CASE WHEN MAX(confidence, ?) >= 90 THEN 1 ELSE completed END, verified=CASE WHEN MAX(confidence, ?) >= 90 THEN 1 ELSE verified END WHERE path=?`;

    if (hasUpdatedAt) db.prepare(sql).run(confidence, confidence, confidence, now, path);
    else db.prepare(sql).run(confidence, confidence, confidence, path);
  } else {
    db.prepare(`
      INSERT INTO mastery_progress
      (id, stage, path, topic, completed, confidence, verified, updated_at)
      VALUES
      (@id, @stage, @path, @topic, @completed, @confidence, @verified, @now)
    `).run({
      id: safeId(path),
      stage: job.stage || String(path).split('/')[0] || 'UNKNOWN',
      path,
      topic: target,
      completed: confidence >= 90 ? 1 : 0,
      confidence,
      verified: confidence >= 90 ? 1 : 0,
      now
    });
  }

  synced++;
}

// Sanitizer v2 para learning_jobs y reinforcement_queue: name:
const badJobs = db.prepare(`
SELECT id, topic, stage
FROM learning_jobs
WHERE topic LIKE '%target=name:%'
   OR topic LIKE '%target=nombre:%'
   OR topic LIKE '%target=concept:%'
   OR topic LIKE '%description:%'
   OR topic LIKE '%descripcion:%'
   OR topic LIKE '%relation:%'
   OR topic LIKE '%relacion:%'
`).all();

for (const j of badJobs) {
  const target = clean(j.topic);
  const prefix = j.topic.includes('ALAI_REINFORCE_TOPIC') ? 'ALAI_REINFORCE_TOPIC' : 'ALAI_LEARN_TOPIC';
  const task = prefix === 'ALAI_REINFORCE_TOPIC'
    ? 'Improve weak knowledge with better explanation, examples, claims, verification, and inferences.'
    : 'Learn this discovered child topic completely.';

  db.prepare(`
    UPDATE learning_jobs
    SET topic=?,
        updated_at=?
    WHERE id=?
  `).run(
    `${prefix} | stage=${j.stage || 'UNIVERSIDAD'} | target=${target} | task=${task}`,
    now,
    j.id
  );

  sanitizedJobs++;
}

const badRq = db.prepare(`
SELECT id, topic, stage
FROM reinforcement_queue
WHERE topic LIKE '%target=name:%'
   OR topic LIKE '%target=nombre:%'
   OR topic LIKE '%target=concept:%'
   OR topic LIKE '%description:%'
   OR topic LIKE '%descripcion:%'
   OR topic LIKE '%relation:%'
   OR topic LIKE '%relacion:%'
`).all();

for (const r of badRq) {
  const target = clean(r.topic);

  db.prepare(`
    UPDATE reinforcement_queue
    SET topic=?,
        updated_at=?
    WHERE id=?
  `).run(
    `ALAI_REINFORCE_TOPIC | stage=${r.stage || 'UNIVERSIDAD'} | target=${target} | task=Improve weak knowledge with better explanation, examples, claims, verification, and inferences.`,
    now,
    r.id
  );

  sanitizedJobs++;
}

// Cerrar refuerzos si el topic ya está >=90 en knowledge_units o mastery_progress
const rq = db.prepare(`
SELECT id, topic, stage, status
FROM reinforcement_queue
WHERE status IN ('pending','queued')
`).all();

for (const r of rq) {
  const target = clean(r.topic);

  const ku = db.prepare(`
    SELECT confidence
    FROM knowledge_units
    WHERE lower(title)=lower(?)
    ORDER BY updated_at DESC
    LIMIT 1
  `).get(target);

  const mp = db.prepare(`
    SELECT MAX(confidence) confidence
    FROM mastery_progress
    WHERE lower(path) LIKE lower(?)
  `).get(`%/${target}`);

  const best = Math.max(Number(ku?.confidence || 0), Number(mp?.confidence || 0));

  if (best >= 90) {
    db.prepare(`
      UPDATE reinforcement_queue
      SET status='completed',
          updated_at=?
      WHERE id=?
    `).run(now, r.id);

    db.prepare(`
      UPDATE learning_jobs
      SET status='archived',
          priority=0,
          updated_at=?
      WHERE status='pending'
        AND topic LIKE ?
    `).run(now, `%target=${target}%`);

    closedReinforcements++;
  }
}

// Repriorizar solo required del active stage bajo mastery_required
const activeStage = db.prepare(`
SELECT active_stage FROM education_control WHERE id='main'
`).get()?.active_stage || 'UNIVERSIDAD';

db.prepare(`
UPDATE learning_jobs
SET priority=200000,
    updated_at=?
WHERE status='pending'
  AND stage=?
  AND topic LIKE 'ALAI_CURRICULUM_EXPAND%'
`).run(now, activeStage);

db.prepare(`
UPDATE learning_jobs
SET priority=250000,
    updated_at=?
WHERE status='pending'
  AND stage=?
  AND topic LIKE 'ALAI_REINFORCE_TOPIC%'
`).run(now, activeStage);

const weakRequired = db.prepare(`
SELECT erc.path, erc.mastery_required, COALESCE(mp.confidence, 0) confidence
FROM education_required_coverage erc
LEFT JOIN mastery_progress mp ON mp.path=erc.path
WHERE erc.stage=?
  AND COALESCE(mp.confidence, 0) < erc.mastery_required
`).all(activeStage);

for (const w of weakRequired) {
  db.prepare(`
    UPDATE learning_jobs
    SET status='pending',
        priority=999999,
        updated_at=?
    WHERE stage=?
      AND topic LIKE ?
  `).run(now, activeStage, `%path=${w.path}%`);

  reprioritized++;
}

console.log(JSON.stringify({
  mastery_synced_from_completed_jobs: synced,
  sanitizer_v2_updates: sanitizedJobs,
  closed_reinforcements: closedReinforcements,
  weak_required_reprioritized: reprioritized,
  active_stage: activeStage,
  weak_required_remaining: weakRequired.map(x => ({
    path: x.path,
    confidence: x.confidence,
    required: x.mastery_required
  }))
}, null, 2));

db.close();
