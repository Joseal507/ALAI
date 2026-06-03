import Database from 'better-sqlite3';

const db = new Database('data/alai.db');
const now = Date.now();

function clean(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

function canon(s) {
  return clean(s)
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 100);
}

db.exec(`
CREATE TABLE IF NOT EXISTS self_evaluations (
  id TEXT PRIMARY KEY,
  knowledge_id TEXT NOT NULL,
  title TEXT NOT NULL,
  score INTEGER NOT NULL,
  status TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS learning_quality (
  id TEXT PRIMARY KEY,
  knowledge_id TEXT NOT NULL,
  title TEXT NOT NULL,
  claims INTEGER NOT NULL,
  verified INTEGER NOT NULL,
  inferences INTEGER NOT NULL,
  conflicts INTEGER NOT NULL,
  confidence INTEGER NOT NULL,
  score INTEGER NOT NULL,
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

const claims = db.prepare(`
SELECT id, knowledge_id, title, subject, predicate, object, confidence
FROM knowledge_claims
ORDER BY updated_at DESC
LIMIT 1200
`).all();

const insertInference = db.prepare(`
INSERT OR IGNORE INTO knowledge_inferences
(id, claim_a, claim_b, subject, inference, confidence, created_at, updated_at)
VALUES
(@id, @claim_a, @claim_b, @subject, @inference, @confidence, @now, @now)
`);

let inferences = 0;

const bySubject = new Map();
for (const c of claims) {
  const key = canon(c.subject || c.title);
  if (!bySubject.has(key)) bySubject.set(key, []);
  bySubject.get(key).push(c);
}

for (const group of bySubject.values()) {
  for (let i = 0; i < group.length; i++) {
    for (let j = i + 1; j < Math.min(group.length, i + 8); j++) {
      const a = group[i];
      const b = group[j];
      if (a.id === b.id) continue;

      insertInference.run({
        id: `inf_${canon(a.id)}_${canon(b.id)}`,
        claim_a: a.id,
        claim_b: b.id,
        subject: a.subject,
        inference: `${a.subject} relaciona "${a.predicate}: ${clean(a.object).slice(0, 80)}" con "${b.predicate}: ${clean(b.object).slice(0, 80)}".`,
        confidence: Math.min(Number(a.confidence || 60), Number(b.confidence || 60)),
        now
      });

      inferences++;
    }
  }
}

const insertQuality = db.prepare(`
INSERT OR REPLACE INTO learning_quality
(id, knowledge_id, title, claims, verified, inferences, conflicts, confidence, score, created_at, updated_at)
VALUES
(@id, @knowledge_id, @title, @claims, @verified, @inferences, @conflicts, @confidence, @score, @now, @now)
`);

const insertEval = db.prepare(`
INSERT OR REPLACE INTO self_evaluations
(id, knowledge_id, title, score, status, reason, created_at, updated_at)
VALUES
(@id, @knowledge_id, @title, @score, @status, @reason, @now, @now)
`);

const insertReinforce = db.prepare(`
INSERT OR IGNORE INTO reinforcement_queue
(id, stage, topic, reason, priority, status, created_at, updated_at)
VALUES
(@id, @stage, @topic, @reason, @priority, 'pending', @now, @now)
`);

const activeStage = db.prepare("SELECT active_stage FROM education_control WHERE id='main'").get()?.active_stage || 'UNIVERSIDAD';
const units = db.prepare("SELECT id, title, confidence FROM knowledge_units").all();

let quality = 0;
let evals = 0;
let reinforcements = 0;

for (const u of units) {
  const claimCount = db.prepare("SELECT COUNT(*) total FROM knowledge_claims WHERE knowledge_id=?").get(u.id).total;

  const verified = db.prepare(`
    SELECT COUNT(*) total
    FROM claim_verifications cv
    JOIN knowledge_claims kc ON kc.id=cv.claim_id
    WHERE kc.knowledge_id=?
      AND cv.verdict IN ('supported','weak','needs_review')
  `).get(u.id).total;

  const infCount = db.prepare("SELECT COUNT(*) total FROM knowledge_inferences WHERE subject=?").get(u.title).total;

  const conflicts = db.prepare(`
    SELECT COUNT(*) total
    FROM knowledge_conflicts
    WHERE status='open'
      AND (knowledge_a=? OR knowledge_b=?)
  `).get(u.id, u.id).total;

  const confidence = Number(u.confidence || 60);
  const score = Math.max(0, Math.min(100, Math.round(
    confidence * 0.45 +
    Math.min(20, claimCount * 4) +
    Math.min(25, verified * 5) +
    Math.min(10, infCount * 2) -
    Math.min(30, conflicts * 10)
  )));

  insertQuality.run({
    id: `lq_${u.id}`,
    knowledge_id: u.id,
    title: u.title,
    claims: claimCount,
    verified,
    inferences: infCount,
    conflicts,
    confidence,
    score,
    now
  });
  quality++;

  let status = 'mastered';
  const reasons = [];

  if (score < 70) {
    status = 'weak';
    reasons.push('score_below_70');
  } else if (score < 85) {
    status = 'developing';
    reasons.push('score_below_85');
  }

  if (claimCount < 2) {
    if (status === 'mastered') status = 'developing';
    reasons.push('few_claims');
  }

  if (verified < claimCount) {
    if (status === 'mastered') status = 'developing';
    reasons.push('unverified_claims');
  }

  insertEval.run({
    id: `se_${u.id}`,
    knowledge_id: u.id,
    title: u.title,
    score,
    status,
    reason: reasons.join(',') || 'strong',
    now
  });
  evals++;

  if (status === 'weak') {
    insertReinforce.run({
      id: `rq_${u.id}`,
      stage: activeStage,
      topic: `ALAI_REINFORCE_TOPIC | stage=${activeStage} | target=${u.title} | task=Improve weak knowledge with better explanation, examples, claims, verification, and inferences.`,
      reason: `score=${score}; claims=${claimCount}; verified=${verified}; inferences=${infCount}; conflicts=${conflicts}`,
      priority: 250000,
      now
    });
    reinforcements++;
  }
}

console.log(JSON.stringify({
  claims: claims.length,
  inferences_attempted: inferences,
  inferences_total: db.prepare("SELECT COUNT(*) total FROM knowledge_inferences").get().total,
  quality_rows: quality,
  self_evaluations: evals,
  reinforcement_attempted: reinforcements,
  reinforcement_pending: db.prepare("SELECT COUNT(*) total FROM reinforcement_queue WHERE status='pending'").get().total,
  evaluations: db.prepare("SELECT status, COUNT(*) total FROM self_evaluations GROUP BY status").all()
}, null, 2));

db.close();
