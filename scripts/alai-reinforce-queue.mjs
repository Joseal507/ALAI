import Database from 'better-sqlite3';

const db = new Database('data/alai.db');
const now = Date.now();

const rows = db.prepare(`
SELECT *
FROM reinforcement_queue
WHERE status='pending'
ORDER BY priority DESC, created_at ASC
LIMIT 20
`).all();

const insertJob = db.prepare(`
INSERT OR IGNORE INTO learning_jobs
(id, topic, priority, status, created_at, updated_at, stage, base_priority, source)
VALUES
(@id, @topic, @priority, 'pending', @now, @now, @stage, @priority, 'reinforcement_queue')
`);

function slug(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 90);
}

for (const r of rows) {
  const stage = r.stage && r.stage !== 'UNKNOWN'
    ? r.stage
    : (db.prepare("SELECT active_stage FROM education_control WHERE id='main'").get()?.active_stage || 'MEDIA');

  insertJob.run({
    id: `reinforce_${slug(stage)}_${slug(r.topic)}`,
    stage,
    priority: 300000,
    now,
    topic: `ALAI_REINFORCE_TOPIC | stage=${stage} | target=${r.topic} | reason=${r.reason} | task=Relearn this topic deeply, fix weak understanding, add examples, prerequisites, common mistakes, and improve confidence above 90.`
  });

  db.prepare("UPDATE reinforcement_queue SET status='queued', updated_at=? WHERE id=?").run(now, r.id);
}

console.log(`Queued reinforcement jobs: ${rows.length}`);
db.close();
