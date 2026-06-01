import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/alai/storage/db';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const node = req.nextUrl.searchParams.get('node') || '';

  if (!node.trim()) {
    return NextResponse.json({
      success: false,
      error: 'Missing node',
    }, { status: 400 });
  }

  const outgoing = db.prepare(`
    SELECT source, target, relation, confidence
    FROM knowledge_edges
    WHERE lower(source) LIKE lower(?)
    ORDER BY confidence DESC
    LIMIT 30
  `).all(`%${node}%`);

  const incoming = db.prepare(`
    SELECT source, target, relation, confidence
    FROM knowledge_edges
    WHERE lower(target) LIKE lower(?)
    ORDER BY confidence DESC
    LIMIT 30
  `).all(`%${node}%`);

  return NextResponse.json({
    success: true,
    node,
    outgoing,
    incoming,
  });
}
