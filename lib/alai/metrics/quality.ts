import { db } from '../storage/db';

export function scoreKnowledgeUnit(knowledgeId: string) {
  const unit = db.prepare(`
    SELECT *
    FROM knowledge_units
    WHERE id = ?
    LIMIT 1
  `).get(knowledgeId) as any;

  if (!unit) return null;

  const claims =
    (db.prepare(`SELECT COUNT(*) AS count FROM knowledge_claims WHERE knowledge_id = ?`).get(knowledgeId) as any)?.count || 0;

  const verified =
    (db.prepare(`
      SELECT COUNT(*) AS count
      FROM claim_verifications v
      JOIN knowledge_claims c ON c.id = v.claim_id
      WHERE c.knowledge_id = ?
    `).get(knowledgeId) as any)?.count || 0;

  const inferences =
    (db.prepare(`
      SELECT COUNT(*) AS count
      FROM knowledge_inferences i
      JOIN knowledge_claims c ON c.id = i.claim_a OR c.id = i.claim_b
      WHERE c.knowledge_id = ?
    `).get(knowledgeId) as any)?.count || 0;

  const conflicts =
    (db.prepare(`
      SELECT COUNT(*) AS count
      FROM knowledge_conflicts
      WHERE status != 'resolved'
        AND (knowledge_a = ? OR knowledge_b = ?)
    `).get(knowledgeId, knowledgeId) as any)?.count || 0;

  const rawConfidence = Number(unit.confidence || 60);
  const confidence = rawConfidence <= 1 ? Math.round(rawConfidence * 100) : rawConfidence;

  const score = Math.max(0, Math.min(100, Math.round(
    confidence * 0.35 +
    Math.min(30, claims * 10) +
    Math.min(20, verified * 10) +
    Math.min(15, inferences * 3) -
    Math.min(30, conflicts * 15)
  )));

  const now = Date.now();

  db.prepare(`
    INSERT INTO learning_quality (
      id, knowledge_id, title, claims, verified, inferences,
      conflicts, confidence, score, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(knowledge_id) DO UPDATE SET
      title = excluded.title,
      claims = excluded.claims,
      verified = excluded.verified,
      inferences = excluded.inferences,
      conflicts = excluded.conflicts,
      confidence = excluded.confidence,
      score = excluded.score,
      updated_at = excluded.updated_at
  `).run(
    `quality_${knowledgeId}`,
    knowledgeId,
    unit.title,
    claims,
    verified,
    inferences,
    conflicts,
    confidence,
    score,
    now,
    now
  );

  return {
    knowledgeId,
    title: unit.title,
    claims,
    verified,
    inferences,
    conflicts,
    confidence,
    score,
  };
}

export function rebuildLearningQuality() {
  const rows = db.prepare(`
    SELECT id
    FROM knowledge_units
    ORDER BY updated_at DESC
  `).all() as any[];

  let updated = 0;

  for (const row of rows) {
    if (scoreKnowledgeUnit(row.id)) updated++;
  }

  const total = (db.prepare(`SELECT COUNT(*) AS count FROM learning_quality`).get() as any)?.count || 0;
  const avg = (db.prepare(`SELECT AVG(score) AS avg FROM learning_quality`).get() as any)?.avg || 0;

  return {
    updated,
    total,
    averageScore: Math.round(avg),
  };
}

export function listLearningQuality(limit = 30) {
  return db.prepare(`
    SELECT *
    FROM learning_quality
    ORDER BY updated_at DESC
    LIMIT ?
  `).all(limit);
}
