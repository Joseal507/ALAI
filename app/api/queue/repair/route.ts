import { NextResponse } from 'next/server';
import { db } from '@/lib/alai/storage/db';

export const runtime = 'nodejs';

export async function POST() {
  const cutoff = Date.now() - 5 * 60 * 1000;

  const result = db.prepare(`
    UPDATE learning_jobs
    SET status='pending', updated_at=?
    WHERE status='running'
      AND updated_at < ?
  `).run(Date.now(), cutoff);

  return NextResponse.json({
    success: true,
    repaired: result.changes,
  });
}
