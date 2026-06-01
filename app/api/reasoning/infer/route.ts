import { NextResponse } from 'next/server';
import { buildInferences } from '@/lib/alai/reasoning/engine';

export const runtime = 'nodejs';

export async function POST() {
  return NextResponse.json({
    success: true,
    ...buildInferences(),
  });
}
