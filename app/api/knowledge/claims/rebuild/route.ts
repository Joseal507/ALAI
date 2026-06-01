import { NextResponse } from 'next/server';
import { rebuildKnowledgeClaims } from '@/lib/alai/knowledge/claims';

export const runtime = 'nodejs';

export async function POST() {
  const result = rebuildKnowledgeClaims();

  return NextResponse.json({
    success: true,
    ...result,
  });
}
