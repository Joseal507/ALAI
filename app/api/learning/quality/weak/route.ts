import { NextResponse } from 'next/server';
import { db } from '@/lib/alai/storage/db';

export const runtime = 'nodejs';

export async function GET() {
  const weak = db.prepare(`
    SELECT *
    FROM learning_quality
    ORDER BY score ASC, updated_at DESC
    LIMIT 10
  `).all();

  return NextResponse.json({
    success: true,
    weak,
  });
}
