import Database from 'better-sqlite3';

const db = new Database('data/alai.db');
const now = Date.now();

function safe(s = '') {
  return String(s)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 160);
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
CREATE TABLE IF NOT EXISTS knowledge_consolidation_scores (
  id TEXT PRIMARY KEY,
  topic TEXT NOT NULL,
  knowledge_id TEXT,
  confidence INTEGER NOT NULL DEFAULT 0,
  claims INTEGER NOT NULL DEFAULT 0,
  supported_claims INTEGER NOT NULL DEFAULT 0,
  review_claims INTEGER NOT NULL DEFAULT 0,
  relationships INTEGER NOT NULL DEFAULT 0,
  inferences INTEGER NOT NULL DEFAULT 0,
  verified_hypotheses INTEGER NOT NULL DEFAULT 0,
  source_count INTEGER NOT NULL DEFAULT 0,
  evidence_score INTEGER NOT NULL DEFAULT 0,
  graph_score INTEGER NOT NULL DEFAULT 0,
  reasoning_score INTEGER NOT NULL DEFAULT 0,
  consolidation_score INTEGER NOT NULL DEFAULT 0,
  level TEXT NOT NULL DEFAULT 'unknown',
  recommendation TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
`);

const units = db.prepare(`
SELECT id, title, confidence
FROM knowledge_units
`).all();

let scored = 0;
let upgraded = 0;
let queued = 0;

const insertScore = db.prepare(`
INSERT OR REPLACE INTO knowledge_consolidation_scores
(id, topic, knowledge_id, confidence, claims, supported_claims, review_claims, relationships, inferences, verified_hypotheses, source_count, evidence_score, graph_score, reasoning_score, consolidation_score, level, recommendation, created_at, updated_at)
VALUES
(@id, @topic, @knowledge_id, @confidence, @claims, @supported_claims, @review_claims, @relationships, @inferences, @verified_hypotheses, @source_count, @evidence_score, @graph_score, @reasoning_score, @consolidation_score, @level, @recommendation, @now, @now)
`);

for (const u of units) {
  const topic = u.title;
  const n = norm(topic);

  const claims = db.prepare(`
    SELECT COUNT(*) total
    FROM knowledge_claims
    WHERE lower(title)=lower(?)
       OR lower(subject)=lower(?)
       OR lower(canonical_subject)=lower(?)
  `).get(topic, topic, topic)?.total || 0;

  const supported = db.prepare(`
    SELECT COUNT(*) total
    FROM knowledge_claims kc
    JOIN claim_verifications cv ON cv.claim_id=kc.id
    WHERE cv.verdict='supported'
      AND (
        lower(kc.title)=lower(?)
        OR lower(kc.subject)=lower(?)
        OR lower(kc.canonical_subject)=lower(?)
      )
  `).get(topic, topic, topic)?.total || 0;

  const reviewClaims = db.prepare(`
    SELECT COUNT(*) total
    FROM knowledge_claims kc
    JOIN claim_verifications cv ON cv.claim_id=kc.id
    WHERE cv.verdict='needs_review'
      AND (
        lower(kc.title)=lower(?)
        OR lower(kc.subject)=lower(?)
        OR lower(kc.canonical_subject)=lower(?)
      )
  `).get(topic, topic, topic)?.total || 0;

  const relationships = db.prepare(`
    SELECT COUNT(*) total
    FROM knowledge_relationships
    WHERE lower(source_title)=lower(?)
       OR lower(target_title)=lower(?)
  `).get(topic, topic)?.total || 0;

  const inferences = db.prepare(`
    SELECT COUNT(*) total
    FROM knowledge_inferences
    WHERE lower(subject)=lower(?)
       OR lower(inference) LIKE '%' || lower(?) || '%'
  `).get(topic, topic)?.total || 0;

  const verifiedHypotheses = db.prepare(`
    SELECT COUNT(*) total
    FROM knowledge_hypotheses
    WHERE status='verified'
      AND (
        lower(topic)=lower(?)
        OR lower(hypothesis) LIKE '%' || lower(?) || '%'
      )
  `).get(topic, topic)?.total || 0;

  const sourceCount = db.prepare(`
    SELECT COUNT(*) total
    FROM knowledge_sources
    WHERE lower(topic)=lower(?)
      AND COALESCE(status,'ready') != 'archived'
  `).get(topic)?.total || 0;

  const evidenceScore = Math.min(100,
    Math.round(
      Math.min(35, supported * 6) +
      Math.min(20, sourceCount * 5) +
      Math.min(15, Math.max(0, claims - reviewClaims) * 2) -
      Math.min(20, reviewClaims * 4)
    )
  );

  const graphScore = Math.min(100,
    Math.round(
      Math.min(60, relationships * 8) +
      Math.min(20, verifiedHypotheses * 6)
    )
  );

  const reasoningScore = Math.min(100,
    Math.round(
      Math.min(60, inferences * 5) +
      Math.min(25, verifiedHypotheses * 8)
    )
  );

  const consolidationScore = Math.max(0, Math.min(100, Math.round(
    Number(u.confidence || 0) * 0.35 +
    evidenceScore * 0.30 +
    graphScore * 0.20 +
    reasoningScore * 0.15
  )));

  let level = 'weak';
  let recommendation = 'relearn_with_sources';

  if (consolidationScore >= 92) {
    level = 'mastered';
    recommendation = 'maintain';
  } else if (consolidationScore >= 82) {
    level = 'strong';
    recommendation = 'add_reasoning_or_hypothesis_validation';
  } else if (consolidationScore >= 70) {
    level = 'developing';
    recommendation = 'add_claims_sources_relationships';
  }

  insertScore.run({
    id: `kcs_${safe(topic)}`,
    topic,
    knowledge_id: u.id,
    confidence: Number(u.confidence || 0),
    claims,
    supported_claims: supported,
    review_claims: reviewClaims,
    relationships,
    inferences,
    verified_hypotheses: verifiedHypotheses,
    source_count: sourceCount,
    evidence_score: evidenceScore,
    graph_score: graphScore,
    reasoning_score: reasoningScore,
    consolidation_score: consolidationScore,
    level,
    recommendation,
    now
  });

  scored++;

  if (consolidationScore >= 92 && Number(u.confidence || 0) < 94) {
    db.prepare(`
      UPDATE knowledge_units
      SET confidence=MIN(94, confidence + 3),
          updated_at=?
      WHERE id=?
    `).run(now, u.id);
    upgraded++;
  }

  if (consolidationScore < 70) {
    db.prepare(`
      INSERT OR IGNORE INTO learning_jobs
      (id, stage, topic, priority, status, created_at, updated_at, job_type)
      VALUES
      (@id, (SELECT active_stage FROM education_control WHERE id='main'), @topic, 920000, 'pending', @now, @now, 'consolidation')
    `).run({
      id: `job_consolidate_${safe(topic)}`,
      topic: `ALAI_CONSOLIDATE | target=${topic} | task=Improve consolidation score by adding verified claims, sources, relationships, inferences, and hypothesis validation.`,
      now
    });
    queued++;
  }
}

console.log(JSON.stringify({
  scored,
  upgraded,
  consolidation_jobs_queued_attempted: queued,
  level_summary: db.prepare(`
    SELECT level, COUNT(*) total, ROUND(AVG(consolidation_score),2) avg_score
    FROM knowledge_consolidation_scores
    GROUP BY level
    ORDER BY avg_score DESC
  `).all(),
  weakest: db.prepare(`
    SELECT topic, confidence, claims, supported_claims, review_claims, relationships, inferences, verified_hypotheses, consolidation_score, recommendation
    FROM knowledge_consolidation_scores
    ORDER BY consolidation_score ASC
    LIMIT 20
  `).all(),
  strongest: db.prepare(`
    SELECT topic, confidence, consolidation_score, level
    FROM knowledge_consolidation_scores
    ORDER BY consolidation_score DESC
    LIMIT 20
  `).all()
}, null, 2));

db.close();
