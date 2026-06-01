import { NextResponse } from 'next/server';
import { planResearchMissions } from '@/lib/alai/agents/research-planner';

export const runtime = 'nodejs';

export async function POST() {
  const result = planResearchMissions(25);

  return NextResponse.json({
    success: true,
    ...result,
  });
}
