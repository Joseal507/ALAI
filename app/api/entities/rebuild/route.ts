import { NextResponse } from 'next/server';
import { rebuildEntities } from '@/lib/alai/entities/extract';

export const runtime = 'nodejs';

export async function POST() {
  return NextResponse.json({
    success: true,
    ...rebuildEntities(),
  });
}
