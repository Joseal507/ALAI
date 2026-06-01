import { NextResponse } from 'next/server';
import { listLearningJobs, seedInitialGoals } from '@/lib/alai/learning/queue';

export const runtime = 'nodejs';

export async function GET() {
  return NextResponse.json({
    success: true,
    jobs: listLearningJobs(100),
  });
}

export async function POST() {
  const seeded = seedInitialGoals();

  return NextResponse.json({
    success: true,
    seeded,
    jobs: listLearningJobs(100),
  });
}
