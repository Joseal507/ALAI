import { db } from '../storage/db';

export function getHealthMetrics() {
  const knowledge =
    (db.prepare(`SELECT COUNT(*) AS count FROM knowledge_units`).get() as any)?.count || 0;

  const claims =
    (db.prepare(`SELECT COUNT(*) AS count FROM knowledge_claims`).get() as any)?.count || 0;

  const verified =
    (db.prepare(`SELECT COUNT(*) AS count FROM claim_verifications`).get() as any)?.count || 0;

  const inferences =
    (db.prepare(`SELECT COUNT(*) AS count FROM knowledge_inferences`).get() as any)?.count || 0;

  const conflicts =
    (db.prepare(`
      SELECT COUNT(*) AS count
      FROM knowledge_conflicts
      WHERE status='pending'
    `).get() as any)?.count || 0;

  const canonical =
    (db.prepare(`SELECT COUNT(*) AS count FROM canonical_knowledge`).get() as any)?.count || 0;

  const verificationCoverage =
    claims > 0 ? verified / claims : 0;

  const canonicalCoverage =
    knowledge > 0 ? canonical / knowledge : 0;

  const conflictPenalty =
    Math.min(0.25, conflicts * 0.05);

  const score =
    Math.max(
      0,
      Math.min(
        100,
        Math.round(
          (
            verificationCoverage * 0.5 +
            canonicalCoverage * 0.5 -
            conflictPenalty
          ) * 100
        )
      )
    );

  return {
    knowledge,
    claims,
    verified,
    inferences,
    conflicts,
    canonical,
    healthScore: score,
    verificationCoverage: Math.round(verificationCoverage * 100),
    canonicalCoverage: Math.round(canonicalCoverage * 100),
  };
}
