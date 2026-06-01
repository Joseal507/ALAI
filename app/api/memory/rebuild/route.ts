import { NextResponse } from 'next/server';
import { buildSemanticMemory } from '@/lib/alai/memory/semantic';

export const runtime = 'nodejs';

export async function POST() {
  const result = buildSemanticMemory();

  return NextResponse.json({
    success: true,
    ...result,
  });
}
