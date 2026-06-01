import { NextResponse } from 'next/server';
import { listInferences } from '@/lib/alai/reasoning/engine';

export const runtime = 'nodejs';

export async function GET() {
  return NextResponse.json({
    success: true,
    inferences: listInferences(50),
  });
}
