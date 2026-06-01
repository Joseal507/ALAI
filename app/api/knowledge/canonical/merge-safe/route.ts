import { NextResponse } from 'next/server';
import { db } from '@/lib/alai/storage/db';

export const runtime = 'nodejs';

const SAFE_MERGES: Array<[string, string]> = [
  ['Neural Network', 'Neural Networks'],
  ['Feedforward Neural Network', 'Feedforward Neural Networks'],
];

export async function POST() {
  let merged = 0;

  for (const [fromTitle, toTitle] of SAFE_MERGES) {
    const from = db.prepare(`
      SELECT *
      FROM canonical_knowledge
      WHERE canonical_title = ?
      LIMIT 1
    `).get(fromTitle) as any;

    const to = db.prepare(`
      SELECT *
      FROM canonical_knowledge
      WHERE canonical_title = ?
      LIMIT 1
    `).get(toTitle) as any;

    if (!from || !to) continue;

    db.prepare(`
      UPDATE knowledge_edges
      SET source_id = ?, source_title = ?
      WHERE source_id = ?
    `).run(to.knowledge_id, to.canonical_title, from.knowledge_id);

    db.prepare(`
      UPDATE knowledge_edges
      SET target_id = ?, target_title = ?
      WHERE target_id = ?
    `).run(to.knowledge_id, to.canonical_title, from.knowledge_id);

    db.prepare(`
      UPDATE knowledge_relationships
      SET source_id = ?, source_title = ?
      WHERE source_id = ?
    `).run(to.knowledge_id, to.canonical_title, from.knowledge_id);

    db.prepare(`
      UPDATE knowledge_relationships
      SET target_id = ?, target_title = ?
      WHERE target_id = ?
    `).run(to.knowledge_id, to.canonical_title, from.knowledge_id);

    db.prepare(`
      DELETE FROM canonical_knowledge
      WHERE id = ?
    `).run(from.id);

    db.prepare(`
      DELETE FROM knowledge_units
      WHERE id = ?
    `).run(from.knowledge_id);

    merged++;
  }

  return NextResponse.json({
    success: true,
    merged,
  });
}
