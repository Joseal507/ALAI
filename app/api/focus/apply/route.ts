import { NextResponse } from 'next/server';
import { db } from '@/lib/alai/storage/db';
import { focusPriority } from '@/lib/alai/config/focus';

export const runtime = 'nodejs';

export async function POST() {
  const rows = db.prepare(`
    SELECT id, topic, priority
    FROM learning_jobs
    WHERE status='pending'
  `).all() as any[];

  let changed = 0;

  for (const row of rows) {
    const nextPriority = focusPriority(row.topic, Number(row.priority || 50));

    if (nextPriority !== Number(row.priority || 50)) {
      db.prepare(`
        UPDATE learning_jobs
        SET priority = ?, updated_at = ?
        WHERE id = ?
      `).run(nextPriority, Date.now(), row.id);

      changed++;
    }
  }

  return NextResponse.json({
    success: true,
    changed,
  });
}
