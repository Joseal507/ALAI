import Database from 'better-sqlite3';

const db = new Database('data/alai.db');
const now = Date.now();

const activeStage = db.prepare(
  "SELECT active_stage FROM education_control WHERE id='main'"
).get()?.active_stage || 'UNIVERSIDAD';

function safe(s = '') {
  return String(s)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 150);
}

function norm(s = '') {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9ñ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

db.exec(`
CREATE TABLE IF NOT EXISTS claim_conflict_candidates (
  id TEXT PRIMARY KEY,
  topic TEXT NOT NULL,
  claim_a TEXT NOT NULL,
  claim_b TEXT NOT NULL,
  reason TEXT NOT NULL,
  severity INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'needs_review',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
`);

const claims = db.prepare(`
SELECT id, title, subject, predicate, object, confidence
FROM knowledge_claims
WHERE predicate IN ('states','is_a','represents','causes','depends_on','part_of','prerequisite_of')
`).all();

const negativeSignals = [
  ['no ', 'sí '],
  ['nunca', 'siempre'],
  ['imposible', 'posible'],
  ['falso', 'verdadero'],
  ['incorrecto', 'correcto'],
  ['aumenta', 'disminuye'],
  ['mayor', 'menor'],
  ['causa', 'no causa'],
  ['depende', 'no depende'],
  ['es parte de', 'no es parte de']
];

function conflictScore(a, b) {
  const ao = norm(a.object);
  const bo = norm(b.object);

  if (!ao || !bo) return 0;
  if (ao === bo) return 0;

  let score = 0;

  if (a.predicate !== b.predicate) score += 5;
  else score += 12;

  for (const [x, y] of negativeSignals) {
    if ((ao.includes(x) && bo.includes(y)) || (ao.includes(y) && bo.includes(x))) {
      score += 35;
    }
  }

  const wordsA = new Set(ao.split(' ').filter(w => w.length > 3));
  const wordsB = new Set(bo.split(' ').filter(w => w.length > 3));
  const overlap = [...wordsA].filter(w => wordsB.has(w)).length;

  if (overlap >= 3) score += 15;
  if (overlap >= 6) score += 10;

  const confAvg = Math.round((Number(a.confidence || 50) + Number(b.confidence || 50)) / 2);
  if (confAvg >= 80) score += 10;

  return Math.min(100, score);
}

let checked = 0;
let created = 0;
let missions = 0;

const bySubject = new Map();

for (const c of claims) {
  const key = norm(c.subject || c.title);
  if (!key) continue;
  if (!bySubject.has(key)) bySubject.set(key, []);
  bySubject.get(key).push(c);
}

const insertConflict = db.prepare(`
INSERT OR IGNORE INTO claim_conflict_candidates
(id, topic, claim_a, claim_b, reason, severity, status, created_at, updated_at)
VALUES
(@id, @topic, @claim_a, @claim_b, @reason, @severity, 'needs_review', @now, @now)
`);

const insertKnownConflict = db.prepare(`
INSERT OR IGNORE INTO knowledge_conflicts
(id, knowledge_a, knowledge_b, title_a, title_b, reason, status, created_at, updated_at)
VALUES
(@id, @a, @b, @title_a, @title_b, @reason, 'open', @now, @now)
`);

const insertMission = db.prepare(`
INSERT OR IGNORE INTO research_missions
(id, topic, reason, priority, status, created_at, updated_at)
VALUES
(@id, @topic, @reason, 970000, 'pending', @now, @now)
`);

const insertJob = db.prepare(`
INSERT OR IGNORE INTO learning_jobs
(id, stage, topic, priority, status, created_at, updated_at, job_type)
VALUES
(@id, @stage, @topic, 970000, 'pending', @now, @now, 'conflict_resolution')
`);

for (const [subject, list] of bySubject.entries()) {
  if (list.length < 2) continue;

  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i];
      const b = list[j];
      checked++;

      const severity = conflictScore(a, b);

      if (severity < 65) continue;

      const id = `conf_${safe(subject)}_${safe(a.id)}_${safe(b.id)}`;
      const reason = `Potential contradiction on ${subject}: severity=${severity}; predicates=${a.predicate}/${b.predicate}`;

      insertConflict.run({
        id,
        topic: a.title || subject,
        claim_a: a.id,
        claim_b: b.id,
        reason,
        severity,
        now
      });

      insertKnownConflict.run({
        id: `kc_${id}`,
        a: a.id,
        b: b.id,
        title_a: a.title,
        title_b: b.title,
        reason,
        now
      });

      created++;

      if (severity >= 80) {
        const target = a.title || subject;
        insertMission.run({
          id: `mission_${id}`,
          topic: target,
          reason: `CONFLICT_RESOLUTION | ${reason} | Compare sources and decide whether this is contradiction, nuance, or complementary explanation.`,
          now
        });

        insertJob.run({
          id: `job_${id}`,
          stage: activeStage,
          topic: `ALAI_CONFLICT_RESOLUTION | stage=${activeStage} | target=${target} | task=${reason}. Resolve by checking evidence, updating claims, and creating a nuanced explanation.`,
          now
        });

        missions++;
      }
    }
  }
}

console.log(JSON.stringify({
  active_stage: activeStage,
  claim_pairs_checked: checked,
  conflict_candidates_created_attempted: created,
  high_severity_missions_created_attempted: missions,
  candidate_summary: db.prepare(`
    SELECT status, COUNT(*) total, ROUND(AVG(severity),2) avg_severity
    FROM claim_conflict_candidates
    GROUP BY status
  `).all(),
  known_conflicts: db.prepare(`
    SELECT status, COUNT(*) total
    FROM knowledge_conflicts
    GROUP BY status
  `).all(),
  top_conflicts: db.prepare(`
    SELECT topic, severity, reason
    FROM claim_conflict_candidates
    ORDER BY severity DESC
    LIMIT 20
  `).all()
}, null, 2));

db.close();
