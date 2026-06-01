import { NextResponse } from 'next/server';
import { entityStats } from '@/lib/alai/knowledge/entity-resolver';

export const runtime = 'nodejs';

export async function GET() {
  return NextResponse.json({
    success: true,
    stats: entityStats(),
  });
}
