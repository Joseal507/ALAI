import { NextResponse } from 'next/server';
import { getMissingGraphTargets } from '@/lib/alai/knowledge/graph';

export const runtime = 'nodejs';

export async function GET() {
  const data = getMissingGraphTargets(100);

  return NextResponse.json({
    success: true,
    count: data.length,
    data,
  });
}
