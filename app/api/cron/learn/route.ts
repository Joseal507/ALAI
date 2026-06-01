import { NextRequest, NextResponse } from 'next/server';
import { runLearningCycle } from '@/lib/alai/learning/runner';

export const runtime = 'nodejs';
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const secret = req.headers.get('authorization')?.replace('Bearer ', '');

  if (process.env.CRON_SECRET && secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const result = await runLearningCycle();

  return NextResponse.json({
    success: true,
    mode: 'cron-learning-cycle',
    result,
  });
}
