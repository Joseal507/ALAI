import { NextResponse } from 'next/server';
import { buildPrerequisiteJobs } from '@/lib/alai/curriculum/engine';

export const runtime = 'nodejs';

export async function POST() {
  const result = buildPrerequisiteJobs();

  return NextResponse.json({
    success: true,
    ...result,
  });
}
