import Database from 'better-sqlite3';

const db = new Database('data/alai.db');
const now = Date.now();

db.exec(`
CREATE TABLE IF NOT EXISTS knowledge_quality (
  id TEXT PRIMARY KEY,
  knowledge_id TEXT NOT NULL,
  stage TEXT NOT NULL DEFAULT 'UNKNOWN',
  topic TEXT NOT NULL,
  confidence INTEGER NOT NULL DEFAULT 0,
  source_score INTEGER NOT NULL DEFAULT 50,
  graph_score INTEGER NOT NULL DEFAULT 50,
  verification_score INTEGER NOT NULL DEFAULT 50,
  quality_score INTEGER NOT NULL DEFAULT 0,
  needs_reinforcement INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS reinforcement_queue (
  id TEXT PRIMARY KEY,
  stage TEXT NOT NULL,
  topic TEXT NOT NULL,
  reason TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 100000,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
`);

const units = db.prepare(`
SELECT id, title, confidence, stage, curriculum_path, education_node_id
FROM knowledge_units
`).all();

const edgeCount = db.prepare(`
SELECT COUNT(*) total
FROM knowledge_edges
WHERE source_id=? OR target_id=?
`);

const insertQuality = db.prepare(`
INSERT OR REPLACE INTO knowledge_quality
(id, knowledge_id, stage, topic, confidence, source_score, graph_score, verification_score, quality_score, needs_reinforcement, created_at, updated_at)
VALUES
(@id, @knowledge_id, @stage, @topic, @confidence, @source_score, @graph_score, @verification_score, @quality_score, @needs_reinforcement, @now, @now)
`);

const insertReinforcement = db.prepare(`
INSERT OR IGNORE INTO reinforcement_queue
(id, stage, topic, reason, priority, status, created_at, updated_at)
VALUES
(@id, @stage, @topic, @reason, @priority, 'pending', @now, @now)
`);

function inferStageFromUnit(u) {
  if (u.stage && u.stage !== 'UNKNOWN') return u.stage;
  if (u.curriculum_path) return String(u.curriculum_path).split('/')[0] || 'UNKNOWN';
  if (u.education_node_id) return String(u.education_node_id).split('/')[0] || 'UNKNOWN';

function inferStage(title) {
  const s = String(title || '');
  const m = s.match(/\b(PREESCOLAR|PRIMARIA|PREMEDIA|MEDIA|UNIVERSIDAD|MAESTRIA|DOCTORADO|POST_DOCTORADO)\b/i);
  return m ? m[1].toUpperCase() : 'UNKNOWN';
}

function slug(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 90);
}

for (const u of units) {
  const confidence = Number(u.confidence || 0);
  const edges = Number(edgeCount.get(u.id, u.id)?.total || 0);

  const source_score = 60;
  const graph_score = Math.min(100, 40 + edges * 8);
  const verification_score = confidence >= 90 ? 90 : confidence >= 80 ? 75 : 55;

  const quality_score = Math.round(
    confidence * 0.45 +
    source_score * 0.15 +
    graph_score * 0.2 +
    verification_score * 0.2
  );

  const needs_reinforcement = quality_score < 75 || confidence < 75 ? 1 : 0;
  const stage = inferStageFromUnit(u);

  insertQuality.run({
    id: `kq_${u.id}`,
    knowledge_id: u.id,
    stage,
    topic: u.title || u.id,
    confidence,
    source_score,
    graph_score,
    verification_score,
    quality_score,
    needs_reinforcement,
    now
  });

  if (needs_reinforcement) {
    insertReinforcement.run({
      id: `rq_${u.id}`,
      stage,
      topic: u.title || u.id,
      reason: `quality_score=${quality_score}, confidence=${confidence}`,
      priority: 120000,
      now
    });
  }
}

const garbagePatterns = [
  '%Ingles Markets%',
  '%El Corte Ingles%',
  '%Grandes almacenes%',
  '%Department Stores%',
  '%Cadenas de supermercados%',
  '%Peninsula Iberica%',
  '%Indo-europeo%',
  '%Judaeo-espanol%',
  '%Commedia dell%',
  '%ARTE es un ejemplo%',
  '%television publica%'
];

for (const pattern of garbagePatterns) {
  db.prepare(`
    UPDATE learning_jobs
    SET status='archived',
        priority=0,
        updated_at=?
    WHERE status IN ('pending','failed')
      AND topic LIKE ?
  `).run(now, pattern);
}

const summary = {
  quality_rows: db.prepare("SELECT COUNT(*) total FROM knowledge_quality").get().total,
  needs_reinforcement: db.prepare("SELECT COUNT(*) total FROM knowledge_quality WHERE needs_reinforcement=1").get().total,
  reinforcement_pending: db.prepare("SELECT COUNT(*) total FROM reinforcement_queue WHERE status='pending'").get().total,
  archived_garbage: 'done'
};

console.log(JSON.stringify(summary, null, 2));
db.close();
