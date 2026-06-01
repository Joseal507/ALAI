import { NextResponse } from 'next/server';
import { db } from '@/lib/alai/storage/db';

export const runtime = 'nodejs';

export async function GET() {
  const pending = db.prepare(`
    SELECT COUNT(*) AS total
    FROM learning_jobs
    WHERE status='pending'
  `).get() as any;

  const running = db.prepare(`
    SELECT COUNT(*) AS total
    FROM learning_jobs
    WHERE status='running'
  `).get() as any;

  const completed = db.prepare(`
    SELECT COUNT(*) AS total
    FROM learning_jobs
    WHERE status='completed'
  `).get() as any;

  const failed = db.prepare(`
    SELECT COUNT(*) AS total
    FROM learning_jobs
    WHERE status='failed'
  `).get() as any;

  return NextResponse.json({
    success: true,
    pending: Number(pending.total || 0),
    running: Number(running.total || 0),
    completed: Number(completed.total || 0),
    failed: Number(failed.total || 0),
  });
}
