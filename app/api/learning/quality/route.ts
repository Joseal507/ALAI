import { NextResponse } from 'next/server';
import { listLearningQuality } from '@/lib/alai/metrics/quality';

export const runtime = 'nodejs';

export async function GET() {
  return NextResponse.json({
    success: true,
    quality: listLearningQuality(30),
  });
}
