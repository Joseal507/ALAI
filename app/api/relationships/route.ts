import { NextResponse } from 'next/server';
import { getSmartRelationships } from '@/lib/alai/knowledge/relationships';

export const runtime = 'nodejs';

export async function GET() {
  const data = getSmartRelationships(300);

  return NextResponse.json({
    success: true,
    count: data.length,
    data,
  });
}
