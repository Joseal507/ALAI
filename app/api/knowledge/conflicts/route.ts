import { NextResponse } from 'next/server';
import { listKnowledgeConflicts } from '@/lib/alai/knowledge/conflicts';

export const runtime = 'nodejs';

export async function GET() {
  return NextResponse.json({
    success: true,
    conflicts: listKnowledgeConflicts(50),
  });
}
