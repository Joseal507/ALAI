import { NextResponse } from 'next/server';
import { reprioritizeQueue } from '@/lib/alai/curriculum/engine';

export const runtime = 'nodejs';

export async function POST() {
  const result = reprioritizeQueue();

  return NextResponse.json({
    success: true,
    ...result,
  });
}
