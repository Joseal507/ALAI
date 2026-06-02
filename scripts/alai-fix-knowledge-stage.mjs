import Database from 'better-sqlite3';

const db = new Database('data/alai.db');
const now = Date.now();

const units = db.prepare("SELECT id, title FROM knowledge_units").all();

const coverage = db.prepare(`
SELECT stage, path
FROM education_required_coverage
`).all();

const mastery = db.prepare(`
SELECT stage, path, topic
FROM mastery_progress
`).all();

const update = db.prepare(`
UPDATE knowledge_units
SET stage=@stage,
    curriculum_path=@path,
    updated_at=@now
WHERE id=@id
`);

function norm(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/[^a-z0-9]+/g,' ')
    .trim();
}

let fixed = 0;

for (const u of units) {
  const title = norm(u.title);
  let found = null;

  for (const m of mastery) {
    if (norm(m.topic) === title || norm(m.path).endsWith(title)) {
      found = { stage: m.stage, path: m.path };
      break;
    }
  }

  if (!found) {
    for (const c of coverage) {
      if (norm(c.path).endsWith(title)) {
        found = { stage: c.stage, path: c.path };
        break;
      }
    }
  }

  if (found) {
    update.run({ id: u.id, stage: found.stage, path: found.path, now });
    fixed++;
  }
}

db.prepare(`
UPDATE knowledge_units
SET explanation='Explicación pendiente de reparación: el contenido anterior fue guardado incorrectamente como objeto serializado.',
    confidence=MIN(confidence, 60),
    updated_at=?
WHERE explanation LIKE '%[object Object]%'
`).run(now);

db.prepare("DELETE FROM reinforcement_queue").run();

db.prepare(`
UPDATE learning_jobs
SET status='archived', priority=0
WHERE topic LIKE 'ALAI_REINFORCE_TOPIC%'
`).run();

console.log(JSON.stringify({ fixed_stage_rows: fixed, cleaned_bad_object_rows: true, reset_reinforcement: true }, null, 2));
db.close();
