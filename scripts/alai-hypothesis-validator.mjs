import Database from 'better-sqlite3';

const db = new Database('data/alai.db');
const now = Date.now();

function safe(s = '') {
  return String(s)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 140);
}

function extractPair(hypothesis = '') {
  const text = String(hypothesis || '');

  const patterns = [
    /entonces\s+(.+?)\s+y\s+(.+?)\s+podr/i,
    /entre\s+(.+?)\s+y\s+(.+?)\./i,
    /relación conceptual entre\s+(.+?)\s+y\s+(.+?)\./i
  ];

  for (const p of patterns) {
    const m = text.match(p);
    if (m?.[1] && m?.[2]) {
      return {
        a: m[1].trim().slice(0, 140),
        b: m[2].trim().slice(0, 140)
      };
    }
  }

  return null;
}

db.exec(`
CREATE TABLE IF NOT EXISTS hypothesis_validation_log (
  id TEXT PRIMARY KEY,
  hypothesis_id TEXT NOT NULL,
  topic TEXT NOT NULL,
  hypothesis TEXT NOT NULL,
  concept_a TEXT,
  concept_b TEXT,
  score INTEGER NOT NULL,
  verdict TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
`);

const hypotheses = db.prepare(`
SELECT id, topic, hypothesis, confidence
FROM knowledge_hypotheses
WHERE status='needs_verification'
ORDER BY confidence DESC
LIMIT 300
`).all();

let accepted = 0;
let review = 0;
let rejected = 0;
let promoted = 0;
let skipped = 0;

for (const h of hypotheses) {
  const pair = extractPair(h.hypothesis);

  if (!pair) {
    skipped++;
    continue;
  }

  const relA = db.prepare(`
    SELECT COUNT(*) total
    FROM knowledge_relationships
    WHERE lower(source_title)=lower(?)
       OR lower(target_title)=lower(?)
  `).get(pair.a, pair.a)?.total || 0;

  const relB = db.prepare(`
    SELECT COUNT(*) total
    FROM knowledge_relationships
    WHERE lower(source_title)=lower(?)
       OR lower(target_title)=lower(?)
  `).get(pair.b, pair.b)?.total || 0;

  const claimsA = db.prepare(`
    SELECT COUNT(*) total
    FROM knowledge_claims
    WHERE lower(title)=lower(?)
       OR lower(subject)=lower(?)
  `).get(pair.a, pair.a)?.total || 0;

  const claimsB = db.prepare(`
    SELECT COUNT(*) total
    FROM knowledge_claims
    WHERE lower(title)=lower(?)
       OR lower(subject)=lower(?)
  `).get(pair.b, pair.b)?.total || 0;

  const existingRel = db.prepare(`
    SELECT COUNT(*) total
    FROM knowledge_relationships
    WHERE 
      (lower(source_title)=lower(?) AND lower(target_title)=lower(?))
      OR
      (lower(source_title)=lower(?) AND lower(target_title)=lower(?))
  `).get(pair.a, pair.b, pair.b, pair.a)?.total || 0;

  const score = Math.min(
    100,
    Number(h.confidence || 0)
      + Math.min(6, relA)
      + Math.min(6, relB)
      + Math.min(4, claimsA)
      + Math.min(4, claimsB)
      + (existingRel > 0 ? 10 : 0)
  );

  let verdict = 'review';
  if (score >= 96 && existingRel > 0) verdict = 'accepted';
  else if (score < 76) verdict = 'rejected';

  const reason =
    `confidence=${h.confidence}; relA=${relA}; relB=${relB}; claimsA=${claimsA}; claimsB=${claimsB}; existingRel=${existingRel}`;

  db.prepare(`
    INSERT OR REPLACE INTO hypothesis_validation_log
    (id, hypothesis_id, topic, hypothesis, concept_a, concept_b, score, verdict, reason, created_at)
    VALUES
    (@id, @hypothesis_id, @topic, @hypothesis, @a, @b, @score, @verdict, @reason, @now)
  `).run({
    id: `hvl_${safe(h.id)}`,
    hypothesis_id: h.id,
    topic: h.topic,
    hypothesis: h.hypothesis,
    a: pair.a,
    b: pair.b,
    score,
    verdict,
    reason,
    now
  });

  if (verdict === 'accepted') {
    db.prepare(`
      UPDATE knowledge_hypotheses
      SET status='verified',
          updated_at=?
      WHERE id=?
    `).run(now, h.id);

    db.prepare(`
      INSERT OR IGNORE INTO knowledge_relationships
      (id, source_title, target_title, relationship, confidence, reason, created_at, updated_at)
      VALUES
      (@id, @source, @target, 'validated_hypothesis', @confidence, @reason, @now, @now)
    `).run({
      id: `hvrel_${safe(pair.a)}_${safe(pair.b)}`,
      source: pair.a,
      target: pair.b,
      confidence: score / 100,
      reason: `Validated hypothesis: ${h.hypothesis}`,
      now
    });

    accepted++;
    promoted++;
  } else if (verdict === 'rejected') {
    db.prepare(`
      UPDATE knowledge_hypotheses
      SET status='rejected',
          updated_at=?
      WHERE id=?
    `).run(now, h.id);
    rejected++;
  } else {
    db.prepare(`
      UPDATE knowledge_hypotheses
      SET status='review',
          updated_at=?
      WHERE id=?
    `).run(now, h.id);
    review++;
  }
}

console.log(JSON.stringify({
  scanned: hypotheses.length,
  accepted,
  review,
  rejected,
  promoted,
  skipped_unparseable: skipped,
  validation_summary: db.prepare(`
    SELECT verdict, COUNT(*) total, ROUND(AVG(score),2) avg_score
    FROM hypothesis_validation_log
    GROUP BY verdict
  `).all(),
  hypothesis_status: db.prepare(`
    SELECT status, COUNT(*) total
    FROM knowledge_hypotheses
    GROUP BY status
  `).all(),
  relationship_summary: db.prepare(`
    SELECT relationship, COUNT(*) total
    FROM knowledge_relationships
    GROUP BY relationship
    ORDER BY total DESC
  `).all()
}, null, 2));

db.close();
