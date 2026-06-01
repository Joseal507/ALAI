import { db } from '../storage/db';

export function rebuildKnowledgeGraph() {
  db.prepare(`DELETE FROM knowledge_edges`).run();

  const claims = db.prepare(`
    SELECT subject, predicate, object
    FROM knowledge_claims
  `).all() as any[];

  let created = 0;

  for (const c of claims) {
    const source = String(c.subject || '').trim();
    const target = String(c.object || '').trim();

    if (!source || !target) continue;
    if (target.length > 120) continue;

    db.prepare(`
      INSERT INTO knowledge_edges (
        id,
        source,
        target,
        relation,
        confidence,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      `edge_${created}_${Date.now()}`,
      source,
      target,
      c.predicate || 'related_to',
      0.8,
      Date.now(),
      Date.now()
    );

    created++;
  }

  return { created };
}
