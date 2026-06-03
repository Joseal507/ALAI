import Database from 'better-sqlite3';

const db = new Database('data/alai.db');
const now = Date.now();

db.exec(`
CREATE TABLE IF NOT EXISTS learning_delta_snapshots (
  id TEXT PRIMARY KEY,
  stage TEXT NOT NULL,
  path TEXT NOT NULL,
  topic TEXT NOT NULL,
  confidence INTEGER NOT NULL,
  completed INTEGER NOT NULL,
  verified INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS learning_delta_results (
  id TEXT PRIMARY KEY,
  stage TEXT NOT NULL,
  path TEXT NOT NULL,
  topic TEXT NOT NULL,
  before_confidence INTEGER NOT NULL,
  after_confidence INTEGER NOT NULL,
  delta INTEGER NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
`);

const activeStage = db.prepare("SELECT active_stage FROM education_control WHERE id='main'").get()?.active_stage || 'UNIVERSIDAD';

const rows = db.prepare(`
SELECT stage, path, topic, confidence, completed, verified
FROM mastery_progress
WHERE stage=?
`).all(activeStage);

let snapshots = 0;
let deltas = 0;

for (const r of rows) {
  const previous = db.prepare(`
    SELECT confidence
    FROM learning_delta_snapshots
    WHERE path=?
    ORDER BY created_at DESC
    LIMIT 1
  `).get(r.path);

  db.prepare(`
    INSERT INTO learning_delta_snapshots
    (id, stage, path, topic, confidence, completed, verified, created_at)
    VALUES
    (@id, @stage, @path, @topic, @confidence, @completed, @verified, @now)
  `).run({
    id: `lds_${now}_${Math.random().toString(36).slice(2)}`,
    stage: r.stage,
    path: r.path,
    topic: r.topic,
    confidence: Number(r.confidence || 0),
    completed: Number(r.completed || 0),
    verified: Number(r.verified || 0),
    now
  });

  snapshots++;

  if (previous) {
    const before = Number(previous.confidence || 0);
    const after = Number(r.confidence || 0);
    const delta = after - before;

    db.prepare(`
      INSERT OR REPLACE INTO learning_delta_results
      (id, stage, path, topic, before_confidence, after_confidence, delta, status, created_at, updated_at)
      VALUES
      (@id, @stage, @path, @topic, @before, @after, @delta, @status, @now, @now)
    `).run({
      id: `ldr_${r.path}`.replace(/[^a-zA-Z0-9_]/g, '_'),
      stage: r.stage,
      path: r.path,
      topic: r.topic,
      before,
      after,
      delta,
      status: delta > 0 ? 'improved' : delta === 0 ? 'unchanged' : 'regressed',
      now
    });

    deltas++;
  }
}

console.log(JSON.stringify({
  active_stage: activeStage,
  snapshots,
  deltas,
  summary: db.prepare(`
    SELECT status, COUNT(*) total
    FROM learning_delta_results
    WHERE stage=?
    GROUP BY status
  `).all(activeStage)
}, null, 2));

db.close();
