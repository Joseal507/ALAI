import { NextRequest, NextResponse } from 'next/server';
import { listKnowledge, searchKnowledge } from '@/lib/alai/knowledge/store';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q');

  const data = q
    ? searchKnowledge(q, 10)
    : listKnowledge(50);

  return NextResponse.json({
    success: true,
    count: data.length,
    data,
  });
}
