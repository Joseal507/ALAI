import { db } from '../storage/db';
import { normalizeTopic, topicKey } from '../knowledge/normalizer';
import type { AlaiLearningJob } from '../types';

export function enqueueLearningJob(topic: string, priority = 50) {
  const cleanTopic = normalizeTopic(topic);
  if (!cleanTopic) return null;

  const existing = db.prepare(`
    SELECT id FROM learning_jobs
    WHERE lower(?) = lower(topic)
       OR lower(?) = lower(topic)
    LIMIT 1
  `).get(cleanTopic, normalizeTopic(cleanTopic)) as any;

  if (existing?.id) return existing.id;

  const now = Date.now();
  const id = `job_${now}_${Math.random().toString(36).slice(2)}`;

  db.prepare(`
    INSERT INTO learning_jobs (id, topic, priority, status, created_at, updated_at)
    VALUES (?, ?, ?, 'pending', ?, ?)
  `).run(id, cleanTopic, priority, now, now);

  return id;
}

export function getNextLearningJob(): AlaiLearningJob | null {
  const row = db.prepare(`
    SELECT * FROM learning_jobs
    WHERE status = 'pending'
    ORDER BY priority DESC, created_at ASC
    LIMIT 1
  `).get() as any;

  if (!row) return null;

  return {
    id: row.id,
    topic: row.topic,
    priority: row.priority,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function markLearningJobStatus(id: string, status: AlaiLearningJob['status']) {
  db.prepare(`
    UPDATE learning_jobs
    SET status = ?, updated_at = ?
    WHERE id = ?
  `).run(status, Date.now(), id);
}

export function listLearningJobs(limit = 50) {
  return db.prepare(`
    SELECT * FROM learning_jobs
    ORDER BY
      CASE status
        WHEN 'running' THEN 1
        WHEN 'pending' THEN 2
        WHEN 'failed' THEN 3
        WHEN 'completed' THEN 4
        ELSE 5
      END,
      priority DESC,
      updated_at DESC
    LIMIT ?
  `).all(limit);
}

export function seedInitialGoals() {
  const goals = [
    'Artificial Intelligence fundamentals',
    'Programming fundamentals',
    'Mathematics fundamentals',
    'Physics fundamentals',
    'Biology fundamentals',
    'History fundamentals',
    'Economics fundamentals',
    'Psychology fundamentals',
    'Learning science fundamentals',
    'Logic and reasoning fundamentals'
  ];

  for (const goal of goals) {
    enqueueLearningJob(goal, 100);
  }

  return goals.length;
}
