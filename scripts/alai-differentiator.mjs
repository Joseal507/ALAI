import Database from 'better-sqlite3';

const db = new Database('data/alai.db');
const now = Date.now();

function clean(raw) {
  let s = String(raw || '').trim();
  const target = s.match(/target=([^|]+)/i)?.[1];
  if (target) s = target.trim();

  s = s.replace(/^ALAI_REINFORCE_TOPIC\s*\|\s*/i, '');
  s = s.replace(/^ALAI_LEARN_TOPIC\s*\|\s*/i, '');
  s = s.replace(/^concepto:\s*/i, '');
  s = s.replace(/^concept:\s*/i, '');
  s = s.replace(/^nombre:\s*/i, '');
  s = s.split(/\s+(description|descripcion|relation|relacion|path|mastery_required|task|reason):/i)[0].trim();
  s = s.split(/\s+\|\s+/)[0].trim();
  return s.replace(/\s+/g, ' ').replace(/^["'`]+|["'`]+$/g, '').slice(0, 140);
}

function canon(s) {
  return clean(s).toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 100);
}

db.exec(`
CREATE TABLE IF NOT EXISTS learning_improvements (
  id TEXT PRIMARY KEY,
  topic TEXT NOT NULL,
  before_score INTEGER NOT NULL,
  after_score INTEGER NOT NULL,
  delta INTEGER NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS reasoning_chains (
  id TEXT PRIMARY KEY,
  subject TEXT NOT NULL,
  claim_a TEXT NOT NULL,
  claim_b TEXT NOT NULL,
  inference TEXT NOT NULL,
  confidence INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
`);

let sanitizedJobs = 0;
let sanitizedReinforcements = 0;
let improvements = 0;
let chains = 0;

// 1) Global sanitizer: learning_jobs
const jobs = db.prepare(`
SELECT id, topic, stage, priority, status
FROM learning_jobs
WHERE topic LIKE '%concept:%'
   OR topic LIKE '%description:%'
   OR topic LIKE '%descripcion:%'
   OR topic LIKE '%relation:%'
   OR topic LIKE '%relacion:%'
`).all();

for (const j of jobs) {
  const target = clean(j.topic);
  if (!target || target.length < 2) continue;

  const stage = j.stage || j.topic.match(/stage=([^|]+)/i)?.[1]?.trim() || 'UNIVERSIDAD';
  const prefix = j.topic.includes('ALAI_REINFORCE_TOPIC') ? 'ALAI_REINFORCE_TOPIC' : 'ALAI_LEARN_TOPIC';

  db.prepare(`
    UPDATE learning_jobs
    SET topic=?,
        stage=?,
        updated_at=?
    WHERE id=?
  `).run(
    `${prefix} | stage=${stage} | target=${target} | task=${prefix === 'ALAI_REINFORCE_TOPIC' ? 'Improve weak knowledge with better explanation, examples, claims, verification, and inferences.' : 'Learn this discovered child topic completely.'}`,
    stage,
    now,
    j.id
  );
  sanitizedJobs++;
}

// 2) Global sanitizer: reinforcement_queue
const rqs = db.prepare(`
SELECT id, stage, topic, reason
FROM reinforcement_queue
WHERE topic LIKE '%concept:%'
   OR topic LIKE '%description:%'
   OR topic LIKE '%descripcion:%'
   OR topic LIKE '%relation:%'
   OR topic LIKE '%relacion:%'
`).all();

for (const r of rqs) {
  const target = clean(r.topic);
  if (!target || target.length < 2) continue;

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
  sanitizedReinforcements++;
}

// 3) Improvement tracking: compare weak/developing knowledge after reinforcement
const reinforced = db.prepare(`
SELECT rq.id, rq.topic
FROM reinforcement_queue rq
WHERE rq.status IN ('queued','completed','pending')
LIMIT 300
`).all();

for (const r of reinforced) {
  const target = clean(r.topic);
  if (!target) continue;

  const q = db.prepare(`
    SELECT knowledge_id, title, score
    FROM learning_quality
    WHERE lower(title)=lower(?)
    LIMIT 1
  `).get(target);

  if (!q) continue;

  const before = db.prepare(`
    SELECT MIN(score) AS score
    FROM self_evaluations
    WHERE lower(title)=lower(?)
  `).get(target)?.score ?? q.score;

  const after = q.score;
  const delta = Number(after || 0) - Number(before || 0);

  db.prepare(`
    INSERT OR REPLACE INTO learning_improvements
    (id, topic, before_score, after_score, delta, status, created_at, updated_at)
    VALUES
    (@id, @topic, @before, @after, @delta, @status, @now, @now)
  `).run({
    id: `li_${canon(target)}`,
    topic: target,
    before: Number(before || 0),
    after: Number(after || 0),
    delta,
    status: delta > 0 ? 'improved' : delta === 0 ? 'unchanged' : 'regressed',
    now
  });
  improvements++;
}

// 4) Multi-step reasoning chains from verified claims
const claims = db.prepare(`
SELECT kc.id, kc.subject, kc.predicate, kc.object, kc.confidence
FROM knowledge_claims kc
JOIN claim_verifications cv ON cv.claim_id=kc.id
WHERE cv.verdict IN ('supported','weak','needs_review')
ORDER BY kc.updated_at DESC
LIMIT 1000
`).all();

const bySubject = new Map();
for (const c of claims) {
  const key = canon(c.subject);
  if (!bySubject.has(key)) bySubject.set(key, []);
  bySubject.get(key).push(c);
}

for (const group of bySubject.values()) {
  for (let i = 0; i < group.length; i++) {
    for (let j = i + 1; j < Math.min(group.length, i + 5); j++) {
      const a = group[i];
      const b = group[j];
      if (a.id === b.id) continue;

      const inference = `${a.subject}: si "${a.predicate} ${a.object}", entonces se relaciona con "${b.predicate} ${b.object}".`;

      db.prepare(`
        INSERT OR IGNORE INTO reasoning_chains
        (id, subject, claim_a, claim_b, inference, confidence, status, created_at, updated_at)
        VALUES
        (@id, @subject, @claim_a, @claim_b, @inference, @confidence, 'active', @now, @now)
      `).run({
        id: `rc_${canon(a.id)}_${canon(b.id)}`,
        subject: a.subject,
        claim_a: a.id,
        claim_b: b.id,
        inference: inference.slice(0, 500),
        confidence: Math.min(Number(a.confidence || 60), Number(b.confidence || 60)),
        now
      });
      chains++;
    }
  }
}

console.log(JSON.stringify({
  sanitized_jobs: sanitizedJobs,
  sanitized_reinforcements: sanitizedReinforcements,
  improvements_tracked: improvements,
  reasoning_chains_attempted: chains,
  reasoning_chains_total: db.prepare("SELECT COUNT(*) total FROM reasoning_chains").get().total,
  improvement_summary: db.prepare("SELECT status, COUNT(*) total FROM learning_improvements GROUP BY status").all()
}, null, 2));

db.close();
