import { db } from '../storage/db';

const PRIORITY_BOOST: Record<string, number> = {
  fundamentals: 50,
  basics: 40,
  introduction: 35,
  beginner: 30,
};

function normalize(s: string) {
  return String(s || '').toLowerCase();
}

function createId(text: string) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
}

function knowledgeExists(id: string) {
  const row = db.prepare(`
    SELECT id
    FROM knowledge_units
    WHERE id = ?
    LIMIT 1
  `).get(id);

  return Boolean(row);
}

function pendingJobExists(id: string) {
  const row = db.prepare(`
    SELECT id
    FROM learning_jobs
    WHERE status IN ('pending','running')
      AND lower(topic) = lower(?)
    LIMIT 1
  `).get(id);

  return Boolean(row);
}

function topicExists(topic: string) {
  const row = db.prepare(`
    SELECT id
    FROM learning_jobs
    WHERE lower(topic) = lower(?)
    LIMIT 1
  `).get(topic);

  return Boolean(row);
}

function ensureJob(topic: string, priority: number) {
  const clean = topic.trim();
  if (!clean) return false;

  if (topicExists(clean)) {
    db.prepare(`
      UPDATE learning_jobs
      SET priority = MAX(priority, ?), updated_at = ?
      WHERE lower(topic) = lower(?)
        AND status = 'pending'
    `).run(priority, Date.now(), clean);

    return false;
  }

  const now = Date.now();
  const id = `job_${now}_${Math.random().toString(36).slice(2)}`;

  db.prepare(`
    INSERT INTO learning_jobs (id, topic, priority, status, created_at, updated_at)
    VALUES (?, ?, ?, 'pending', ?, ?)
  `).run(id, clean, priority, now, now);

  return true;
}

export function curriculumScore(topic: string) {
  const t = normalize(topic);

  let score = 0;

  for (const [key, value] of Object.entries(PRIORITY_BOOST)) {
    if (t.includes(key)) score += value;
  }

  if (t.includes('machine learning')) score += 25;
  if (t.includes('neural network')) score += 20;
  if (t.includes('deep learning')) score += 15;
  if (t.includes('transformer')) score += 10;

  return score;
}

export function reprioritizeQueue() {
  const jobs = db.prepare(`
    SELECT *
    FROM learning_jobs
    WHERE status='pending'
  `).all() as any[];

  let updated = 0;

  for (const job of jobs) {
    const topicId = createId(job.topic);
    let boost = curriculumScore(job.topic);

    const neededBy = db.prepare(`
      SELECT *
      FROM knowledge_relationships
      WHERE target_id = ?
        AND relationship IN ('depends_on','prerequisite_of')
    `).all(topicId) as any[];

    boost += neededBy.length * 18;

    const dependsOn = db.prepare(`
      SELECT *
      FROM knowledge_relationships
      WHERE source_id = ?
        AND relationship = 'depends_on'
    `).all(topicId) as any[];

    const missingDeps = dependsOn.filter((r) => !knowledgeExists(r.target_id));

    if (missingDeps.length > 0) {
      boost -= missingDeps.length * 25;

      for (const dep of missingDeps) {
        ensureJob(dep.target_title, 100);
      }
    }

    const isChatMission = db.prepare(`
      SELECT id
      FROM research_missions
      WHERE lower(topic) = lower(?)
        AND reason LIKE '%Created from chat%'
      LIMIT 1
    `).get(job.topic);

    const isReinforcement = String(job.topic || '').startsWith('Reinforce:');

    const maxPriority = isChatMission ? 999 : isReinforcement ? 160 : 100;

    const newPriority = Math.max(
      10,
      Math.min(
        maxPriority,
        Number(job.priority || 0) + boost
      )
    );

    db.prepare(`
      UPDATE learning_jobs
      SET priority = ?
      WHERE id = ?
    `).run(newPriority, job.id);

    updated++;
  }

  return {
    updated,
  };
}

export function buildPrerequisiteJobs() {
  const rels = db.prepare(`
    SELECT *
    FROM knowledge_relationships
    WHERE relationship = 'depends_on'
    ORDER BY confidence DESC, updated_at DESC
    LIMIT 100
  `).all() as any[];

  let created = 0;
  let boosted = 0;
  let skipped = 0;

  for (const rel of rels) {
    if (knowledgeExists(rel.target_id)) {
      skipped++;
      continue;
    }

    const existed = topicExists(rel.target_title);

    const didCreate = ensureJob(
      rel.target_title,
      Math.min(100, 80 + Math.round(Number(rel.confidence || 0) * 20))
    );

    if (didCreate) created++;
    else if (existed) boosted++;
  }

  return {
    created,
    boosted,
    skipped,
  };
}
