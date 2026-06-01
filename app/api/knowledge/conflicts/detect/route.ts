import { NextResponse } from 'next/server';
import { detectKnowledgeConflicts } from '@/lib/alai/knowledge/conflicts';

export const runtime = 'nodejs';

export async function POST() {
  const result = detectKnowledgeConflicts();

  return NextResponse.json({
    success: true,
    ...result,
  });
}
