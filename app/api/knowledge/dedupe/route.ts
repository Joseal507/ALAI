import { NextResponse } from 'next/server';
import { db } from '@/lib/alai/storage/db';
import { topicKey } from '@/lib/alai/knowledge/normalizer';

export const runtime = 'nodejs';

export async function POST() {
  const rows = db.prepare(`
    SELECT id,title,confidence,updated_at
    FROM knowledge_units
    ORDER BY confidence DESC, updated_at DESC
  `).all() as any[];

  const seen = new Map<string,string>();
  let removed = 0;

  for (const row of rows) {
    const key = topicKey(row.title);

    if (!seen.has(key)) {
      seen.set(key, row.id);
      continue;
    }

    const keepId = seen.get(key);

    db.prepare(`
      UPDATE knowledge_edges
      SET source_id = ?
      WHERE source_id = ?
    `).run(keepId, row.id);

    db.prepare(`
      UPDATE knowledge_edges
      SET target_id = ?
      WHERE target_id = ?
    `).run(keepId, row.id);

    db.prepare(`
      UPDATE knowledge_relationships
      SET source_id = ?
      WHERE source_id = ?
    `).run(keepId, row.id);

    db.prepare(`
      UPDATE knowledge_relationships
      SET target_id = ?
      WHERE target_id = ?
    `).run(keepId, row.id);

    db.prepare(`
      DELETE FROM knowledge_units
      WHERE id = ?
    `).run(row.id);

    removed++;
  }

  return NextResponse.json({
    success: true,
    removed,
    remaining: rows.length - removed,
  });
}
