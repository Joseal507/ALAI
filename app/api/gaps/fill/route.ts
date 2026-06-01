import { NextResponse } from 'next/server';
import { fillKnowledgeGaps } from '@/lib/alai/learning/gap-filler';

export const runtime = 'nodejs';

export async function POST() {
  const result = fillKnowledgeGaps(20);

  return NextResponse.json({
    success: true,
    ...result,
  });
}
