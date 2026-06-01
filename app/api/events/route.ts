import { NextResponse } from 'next/server';
import { listLearningEvents } from '@/lib/alai/events/store';

export const runtime = 'nodejs';

export async function GET() {
  const events = listLearningEvents(50);

  return NextResponse.json({
    success: true,
    events,
  });
}
