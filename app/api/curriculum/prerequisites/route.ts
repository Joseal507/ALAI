import { NextResponse } from 'next/server';
import { getPrerequisiteOrder } from '@/lib/alai/knowledge/relationships';

export const runtime = 'nodejs';

export async function GET() {
  const data = getPrerequisiteOrder(100);

  return NextResponse.json({
    success: true,
    count: data.length,
    data,
  });
}
