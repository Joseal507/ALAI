import { db } from '../storage/db';
import { createResearchMission } from '../agents/research-planner';

function norm(value: string) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(value: string) {
  return norm(value)
    .split(' ')
    .filter((t) => t.length > 2);
}

function jaccard(a: string, b: string) {
  const A = new Set(tokens(a));
  const B = new Set(tokens(b));

  const inter = [...A].filter((x) => B.has(x)).length;
  const union = new Set([...A, ...B]).size || 1;

  return inter / union;
}

const OPPOSITES: Record<string, string[]> = {
  requires: ['does_not_require'],
  does_not_require: ['requires'],
  uses: ['does_not_use'],
  does_not_use: ['uses'],
};

function conflictExists(a: string, b: string) {
  const row = db.prepare(`
    SELECT id
    FROM knowledge_conflicts
    WHERE (knowledge_a = ? AND knowledge_b = ?)
       OR (knowledge_a = ? AND knowledge_b = ?)
    LIMIT 1
  `).get(a, b, b, a);

  return Boolean(row);
}

function createConflict(a: any, b: any, score: number) {
  if (conflictExists(a.knowledge_id, b.knowledge_id)) return false;

  const now = Date.now();
  const id = `conflict_${now}_${Math.random().toString(36).slice(2)}`;

  const reason =
    `Claim contradiction: ${a.subject} ${a.predicate} ${a.object} vs ` +
    `${b.subject} ${b.predicate} ${b.object}. Object similarity: ${score.toFixed(2)}.`;

  db.prepare(`
    INSERT INTO knowledge_conflicts (
      id, knowledge_a, knowledge_b, title_a, title_b,
      reason, status, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)
  `).run(
    id,
    a.knowledge_id,
    b.knowledge_id,
    a.title,
    b.title,
    reason,
    now,
    now
  );

  createResearchMission(
    `Verify conflict: ${a.subject} ${a.object}`,
    reason,
    990
  );

  return true;
}

export function detectKnowledgeConflicts(limit = 500) {
  const claims = db.prepare(`
    SELECT *
    FROM knowledge_claims
    ORDER BY updated_at DESC
    LIMIT ?
  `).all(limit) as any[];

  let checked = 0;
  let created = 0;

  for (let i = 0; i < claims.length; i++) {
    for (let j = i + 1; j < claims.length; j++) {
      checked++;

      const a = claims[i];
      const b = claims[j];

      if (a.knowledge_id === b.knowledge_id) continue;
      if (norm(a.subject) !== norm(b.subject)) continue;

      const oppositePredicates = OPPOSITES[a.predicate] || [];
      if (!oppositePredicates.includes(b.predicate)) continue;

      const score = jaccard(a.object, b.object);
      if (score < 0.5) continue;

      if (createConflict(a, b, score)) created++;
    }
  }

  return {
    checked,
    created,
    pending: countPendingConflicts(),
  };
}

export function countPendingConflicts() {
  const row = db.prepare(`
    SELECT COUNT(*) AS count
    FROM knowledge_conflicts
    WHERE status = 'pending'
  `).get() as any;

  return row?.count || 0;
}

export function listKnowledgeConflicts(limit = 50) {
  return db.prepare(`
    SELECT *
    FROM knowledge_conflicts
    ORDER BY
      CASE status
        WHEN 'pending' THEN 1
        WHEN 'verifying' THEN 2
        WHEN 'resolved' THEN 3
        ELSE 4
      END,
      updated_at DESC
    LIMIT ?
  `).all(limit);
}
