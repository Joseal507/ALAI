import { NextResponse } from 'next/server';
import { db } from '@/lib/alai/storage/db';

export const runtime = 'nodejs';

export async function POST() {
  const weak = db.prepare(`
    SELECT *
    FROM learning_quality
    WHERE (claims < 3 OR score < 40)
      AND title NOT LIKE '% vs %'
      AND title NOT LIKE '%Comparison%'
      AND title NOT LIKE 'Verify claim:%'
      AND title NOT LIKE 'Verify conflict:%'
    ORDER BY score ASC, updated_at DESC
    LIMIT 20
  `).all() as any[];

  let created = 0;

  for (const row of weak) {
    const cleanTitle = String(row.title || '').replace(/^Reinforce:\s*/i, '').trim();
    const topic = `Reinforce: ${cleanTitle}`;

    const existingMission = db.prepare(`
      SELECT id
      FROM research_missions
      WHERE lower(topic) = lower(?)
      LIMIT 1
    `).get(topic) as any;

    const existingJob = db.prepare(`
      SELECT id
      FROM learning_jobs
      WHERE lower(topic) = lower(?)
      LIMIT 1
    `).get(topic) as any;

    if (existingMission || existingJob) continue;

    const now = Date.now();
    const id = `reinforce_${now}_${Math.random().toString(36).slice(2)}`;

    db.prepare(`
      INSERT INTO research_missions (
        id, topic, reason, priority, status, created_at, updated_at
      )
      VALUES (?, ?, ?, 90, 'pending', ?, ?)
    `).run(
      id,
      topic,
      `Knowledge quality too low: score=${row.score}, claims=${row.claims}, verified=${row.verified}, inferences=${row.inferences}.`,
      now,
      now
    );

    db.prepare(`
      INSERT INTO learning_jobs (
        id, topic, priority, status, created_at, updated_at
      )
      VALUES (?, ?, 90, 'pending', ?, ?)
    `).run(
      `job_${id}`,
      topic,
      now,
      now
    );

    created++;
  }

  return NextResponse.json({
    success: true,
    created,
    weakTopics: weak.length,
  });
}
