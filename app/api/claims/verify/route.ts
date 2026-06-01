import { NextRequest, NextResponse } from 'next/server';
import { verificationStats, verifyOneClaim } from '@/lib/alai/verifier/claims';

export const runtime = 'nodejs';
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const count = Math.max(1, Math.min(10, Number(body.count || 1)));

  const results = [];

  for (let i = 0; i < count; i++) {
    const result = await verifyOneClaim();
    results.push(result);
    if (!result.verified) break;
  }

  return NextResponse.json({
    success: true,
    results,
    stats: verificationStats(),
  });
}

export async function GET() {
  return NextResponse.json({
    success: true,
    stats: verificationStats(),
  });
}
