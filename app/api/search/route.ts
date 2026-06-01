import { NextRequest, NextResponse } from 'next/server';
import { researchTopic } from '@/lib/alai/search/research';

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q') || '';

  const results = await researchTopic(q);

  return NextResponse.json({
    success: true,
    query: q,
    count: results.length,
    results,
  });
}
