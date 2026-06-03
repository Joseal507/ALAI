import Database from 'better-sqlite3';

const db = new Database('data/alai.db');
const now = Date.now();

const rows = db.prepare(`
SELECT id, stage, topic, reason, priority
FROM reinforcement_queue
WHERE status='pending'
ORDER BY priority DESC, created_at ASC
LIMIT 50
`).all();

let inserted = 0;

for (const r of rows) {
  const jobId = `job_reinforce_${r.id}`;

  db.prepare(`
    INSERT OR IGNORE INTO learning_jobs
    (id, topic, stage, priority, status, created_at, updated_at)
    VALUES
    (@id, @topic, @stage, @priority, 'pending', @now, @now)
  `).run({
    id: jobId,
    topic: r.topic,
    stage: r.stage,
    priority: Math.max(Number(r.priority || 0), 350000),
    now
  });

  db.prepare(`
    UPDATE reinforcement_queue
    SET status='queued',
        updated_at=?
    WHERE id=?
  `).run(now, r.id);

  inserted++;
}

console.log(JSON.stringify({
  reinforcement_moved_to_learning_jobs: inserted,
  reinforcement_pending: db.prepare("SELECT COUNT(*) total FROM reinforcement_queue WHERE status='pending'").get().total,
  reinforcement_queued: db.prepare("SELECT COUNT(*) total FROM reinforcement_queue WHERE status='queued'").get().total
}, null, 2));

db.close();
