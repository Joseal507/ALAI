import { NextResponse } from 'next/server';
import { rebuildCanonicalKnowledge } from '@/lib/alai/knowledge/canonical';

export const runtime = 'nodejs';

export async function POST() {
  const result = rebuildCanonicalKnowledge();

  return NextResponse.json({
    success: true,
    ...result,
  });
}
