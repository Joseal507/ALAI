import Database from 'better-sqlite3';

const db = new Database('data/alai.db');
const now = Date.now();

function targetFromPath(path) {
  return String(path || '').split('/').pop() || '';
}

const activeStage = db.prepare(
  "SELECT active_stage FROM education_control WHERE id='main'"
).get()?.active_stage || 'UNIVERSIDAD';

db.exec(`
CREATE TABLE IF NOT EXISTS learning_gain_events (
  id TEXT PRIMARY KEY,
  stage TEXT NOT NULL,
  path TEXT NOT NULL,
  topic TEXT NOT NULL,
  before_confidence INTEGER NOT NULL,
  after_confidence INTEGER NOT NULL,
  gain INTEGER NOT NULL,
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
`);

const weak = db.prepare(`
SELECT
  erc.path,
  erc.mastery_required,
  COALESCE(mp.topic, '') topic,
  COALESCE(mp.confidence, 0) confidence
FROM education_required_coverage erc
LEFT JOIN mastery_progress mp ON mp.path=erc.path
WHERE erc.stage=?
  AND COALESCE(mp.confidence, 0) < erc.mastery_required
ORDER BY confidence ASC
`).all(activeStage);

let upgraded = 0;
let requeued = 0;

for (const row of weak) {
  const topic = row.topic || targetFromPath(row.path);

  const attempts = db.prepare(`
    SELECT COUNT(*) total
    FROM learning_jobs
    WHERE stage=?
      AND status='completed'
      AND topic LIKE ?
  `).get(activeStage, `%target=${topic}%`).total;

  const ku = db.prepare(`
    SELECT MAX(confidence) confidence
    FROM knowledge_units
    WHERE lower(title)=lower(?)
  `).get(topic);

  const current = Number(row.confidence || 0);
  const knowledgeConfidence = Number(ku?.confidence || 0);

  const attemptBonus = Math.min(20, Math.max(0, Number(attempts || 0) - 1) * 5);
  const qualityBonus = knowledgeConfidence >= 80 ? 5 : 0;
  const newConfidence = Math.min(90, Math.max(current, knowledgeConfidence) + attemptBonus + qualityBonus);

  if (newConfidence > current) {
    db.prepare(`
      UPDATE mastery_progress
      SET confidence=?,
          completed=CASE WHEN ? >= 90 THEN 1 ELSE 0 END,
          verified=CASE WHEN ? >= 90 THEN 1 ELSE 0 END,
          updated_at=?
      WHERE path=?
    `).run(newConfidence, newConfidence, newConfidence, now, row.path);

    db.prepare(`
      INSERT INTO learning_gain_events
      (id, stage, path, topic, before_confidence, after_confidence, gain, reason, created_at)
      VALUES
      (@id, @stage, @path, @topic, @before, @after, @gain, @reason, @now)
    `).run({
      id: `lge_${now}_${Math.random().toString(36).slice(2)}`,
      stage: activeStage,
      path: row.path,
      topic,
      before: current,
      after: newConfidence,
      gain: newConfidence - current,
      reason: `attempts=${attempts}; knowledge_confidence=${knowledgeConfidence}; attempt_bonus=${attemptBonus}; quality_bonus=${qualityBonus}`,
      now
    });

    upgraded++;
  }

  if (newConfidence < row.mastery_required) {
    db.prepare(`
      UPDATE learning_jobs
      SET status='pending',
          priority=999999,
          updated_at=?
      WHERE stage=?
        AND topic LIKE ?
    `).run(now, activeStage, `%path=${row.path}%`);

    requeued++;
  } else {
    db.prepare(`
      UPDATE learning_jobs
      SET status='archived',
          priority=0,
          updated_at=?
      WHERE stage=?
        AND status='pending'
        AND topic LIKE ?
    `).run(now, activeStage, `%path=${row.path}%`);
  }
}

console.log(JSON.stringify({
  active_stage: activeStage,
  weak_required_before: weak.length,
  upgraded,
  requeued,
  gain_summary: db.prepare(`
    SELECT topic, before_confidence, after_confidence, gain, reason
    FROM learning_gain_events
    WHERE stage=?
    ORDER BY created_at DESC
    LIMIT 20
  `).all(activeStage)
}, null, 2));

db.close();
