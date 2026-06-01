import { NextResponse } from 'next/server';
import { rebuildKnowledgeGraph } from '@/lib/alai/graph/build';

export const runtime = 'nodejs';

export async function POST() {
  const result = rebuildKnowledgeGraph();

  return NextResponse.json({
    success: true,
    ...result,
  });
}
