import { NextResponse } from 'next/server';
import { listResearchMissions } from '@/lib/alai/agents/research-planner';

export const runtime = 'nodejs';

export async function GET() {
  return NextResponse.json({
    success: true,
    missions: listResearchMissions(100),
  });
}
