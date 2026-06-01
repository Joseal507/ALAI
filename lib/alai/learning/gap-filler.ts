import { getMissingGraphTargets } from '../knowledge/graph';
import { enqueueLearningJob } from './queue';
import { db } from '../storage/db';

type MissingGraphTarget = {
  target_id: string;
  target_title: string;
  confidence: number;
  references_count: number;
};

function knowledgeExists(id: string) {
  const row = db.prepare(`
    SELECT id
    FROM knowledge_units
    WHERE id = ?
    LIMIT 1
  `).get(id);

  return Boolean(row);
}

function pendingJobExists(topic: string) {
  const row = db.prepare(`
    SELECT id
    FROM learning_jobs
    WHERE lower(topic) = lower(?)
      AND status IN ('pending','running')
    LIMIT 1
  `).get(topic);

  return Boolean(row);
}

function queueSize() {
  const row = db.prepare(`
    SELECT COUNT(*) AS total
    FROM learning_jobs
    WHERE status IN ('pending','running')
  `).get() as any;

  return Number(row?.total || 0);
}

export function fillKnowledgeGaps(limit = 10) {
  const currentQueue = queueSize();

  if (currentQueue >= 200) {
    return {
      created: 0,
      skipped: 0,
      reason: 'queue_limit_reached',
      queueSize: currentQueue,
    };
  }

  const missing = getMissingGraphTargets(limit) as MissingGraphTarget[];

  let created = 0;
  let skipped = 0;

  for (const item of missing) {
    const topic = String(item.target_title || '').trim();

    if (!topic) {
      skipped++;
      continue;
    }

    if (knowledgeExists(item.target_id)) {
      skipped++;
      continue;
    }

    if (pendingJobExists(topic)) {
      skipped++;
      continue;
    }

    enqueueLearningJob(
      topic,
      Math.min(
        100,
        Number(item.confidence || 50) +
        Number(item.references_count || 1)
      )
    );

    created++;
  }

  return {
    created,
    skipped,
    queueSize: queueSize(),
    missing: missing.length,
  };
}
