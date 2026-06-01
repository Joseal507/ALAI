import { db } from '../storage/db';

function createId(text: string) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
}

export function saveKnowledgeEdges(args: {
  sourceId: string;
  sourceTitle: string;
  relatedConcepts: string[];
  confidence: number;
}) {
  const now = Date.now();

  for (const concept of args.relatedConcepts) {
    const targetTitle = String(concept || '').trim();
    if (!targetTitle) continue;

    const targetId = createId(targetTitle);
    if (!targetId || targetId === args.sourceId) continue;

    const id = `${args.sourceId}__related__${targetId}`;

    db.prepare(`
      INSERT INTO knowledge_edges (
        id, source_id, source_title, target_id, target_title,
        relationship, confidence, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, 'related', ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        source_title = excluded.source_title,
        target_title = excluded.target_title,
        confidence = excluded.confidence,
        updated_at = excluded.updated_at
    `).run(
      id,
      args.sourceId,
      args.sourceTitle,
      targetId,
      targetTitle,
      args.confidence,
      now,
      now
    );
  }
}

export function getKnowledgeGraph(limit = 300) {
  return db.prepare(`
    SELECT *
    FROM knowledge_edges
    ORDER BY confidence DESC, updated_at DESC
    LIMIT ?
  `).all(limit);
}

export function getMissingGraphTargets(limit = 50) {
  return db.prepare(`
    SELECT e.target_id, e.target_title, MAX(e.confidence) AS confidence, COUNT(*) AS references_count
    FROM knowledge_edges e
    LEFT JOIN knowledge_units k ON k.id = e.target_id
    WHERE k.id IS NULL
    GROUP BY e.target_id, e.target_title
    ORDER BY references_count DESC, confidence DESC
    LIMIT ?
  `).all(limit);
}

export function getGraphNeighbors(idOrTitle: string, limit = 30) {
  const id = createId(idOrTitle);

  return db.prepare(`
    SELECT *
    FROM knowledge_edges
    WHERE source_id = ?
       OR target_id = ?
       OR lower(source_title) = lower(?)
       OR lower(target_title) = lower(?)
    ORDER BY confidence DESC, updated_at DESC
    LIMIT ?
  `).all(id, id, idOrTitle, idOrTitle, limit);
}
