import { NextRequest, NextResponse } from 'next/server';
import { getGraphNeighbors, getKnowledgeGraph } from '@/lib/alai/knowledge/graph';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q');

  const data = q
    ? getGraphNeighbors(q, 50)
    : getKnowledgeGraph(300);

  return NextResponse.json({
    success: true,
    count: data.length,
    data,
  });
}
