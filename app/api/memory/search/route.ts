import { NextRequest, NextResponse } from 'next/server';
import { semanticSearch } from '@/lib/alai/memory/semantic';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q') || '';
  const limit = Number(req.nextUrl.searchParams.get('limit') || 8);

  const results = semanticSearch(q, limit);

  return NextResponse.json({
    success: true,
    query: q,
    count: results.length,
    results,
  });
}
