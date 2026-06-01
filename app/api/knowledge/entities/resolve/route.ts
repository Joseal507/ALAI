import { NextResponse } from 'next/server';
import { entityStats, resolveClaimEntities } from '@/lib/alai/knowledge/entity-resolver';

export const runtime = 'nodejs';

export async function POST() {
  const result = resolveClaimEntities();

  return NextResponse.json({
    success: true,
    ...result,
    stats: entityStats(),
  });
}
