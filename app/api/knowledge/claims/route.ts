import { NextResponse } from 'next/server';
import { listKnowledgeClaims } from '@/lib/alai/knowledge/claims';

export const runtime = 'nodejs';

export async function GET() {
  return NextResponse.json({
    success: true,
    claims: listKnowledgeClaims(100),
  });
}
