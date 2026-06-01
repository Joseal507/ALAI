import { NextResponse } from 'next/server';
import { rebuildLearningQuality } from '@/lib/alai/metrics/quality';

export const runtime = 'nodejs';

export async function POST() {
  return NextResponse.json({
    success: true,
    ...rebuildLearningQuality(),
  });
}
