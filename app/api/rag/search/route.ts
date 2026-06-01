import { NextRequest, NextResponse } from 'next/server';
import { ragSearch } from '@/lib/alai/rag/search';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q') || '';
  const limit = Number(req.nextUrl.searchParams.get('limit') || 5);

  const results = ragSearch(q, limit);

  return NextResponse.json({
    success: true,
    query: q,
    count: results.length,
    results,
  });
}
