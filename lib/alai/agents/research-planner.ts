import { db } from '../storage/db';
import { enqueueLearningJob } from '../learning/queue';

function missionExists(topic: string) {
  const row = db.prepare(`
    SELECT id FROM research_missions
    WHERE lower(topic) = lower(?)
    LIMIT 1
  `).get(topic);

  return Boolean(row);
}

function knowledgeExists(id: string) {
  const row = db.prepare(`
    SELECT id FROM knowledge_units
    WHERE id = ?
    LIMIT 1
  `).get(id);

  return Boolean(row);
}

export function createResearchMission(topic: string, reason: string, priority = 85) {
  return createMission(topic, reason, priority);
}

function createMission(topic: string, reason: string, priority: number) {
  const clean = topic.trim();
  if (!clean || missionExists(clean)) return false;

  const now = Date.now();
  const id = `mission_${now}_${Math.random().toString(36).slice(2)}`;

  db.prepare(`
    INSERT INTO research_missions (
      id, topic, reason, priority, status, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, 'pending', ?, ?)
  `).run(id, clean, reason, priority, now, now);

  enqueueLearningJob(clean, priority);

  return true;
}

export function planResearchMissions(limit = 25) {
  let created = 0;
  let skipped = 0;

  const missingFromEdges = db.prepare(`
    SELECT e.target_id, e.target_title, COUNT(*) AS refs, MAX(e.confidence) AS confidence
    FROM knowledge_edges e
    LEFT JOIN knowledge_units k ON k.id = e.target_id
    WHERE k.id IS NULL
    GROUP BY e.target_id, e.target_title
    ORDER BY refs DESC, confidence DESC
    LIMIT ?
  `).all(limit) as any[];

  for (const item of missingFromEdges) {
    if (knowledgeExists(item.target_id)) {
      skipped++;
      continue;
    }

    const ok = createMission(
      item.target_title,
      `Missing graph concept referenced ${item.refs} time(s).`,
      Math.min(100, 70 + Number(item.refs || 1) * 5)
    );

    if (ok) created++;
    else skipped++;
  }

  const missingPrereqs = db.prepare(`
    SELECT r.target_id, r.target_title, COUNT(*) AS refs, MAX(r.confidence) AS confidence
    FROM knowledge_relationships r
    LEFT JOIN knowledge_units k ON k.id = r.target_id
    WHERE k.id IS NULL
      AND r.relationship = 'depends_on'
    GROUP BY r.target_id, r.target_title
    ORDER BY refs DESC, confidence DESC
    LIMIT ?
  `).all(limit) as any[];

  for (const item of missingPrereqs) {
    if (knowledgeExists(item.target_id)) {
      skipped++;
      continue;
    }

    const ok = createMission(
      item.target_title,
      `Missing prerequisite needed by existing knowledge.`,
      100
    );

    if (ok) created++;
    else skipped++;
  }

  const centralSeeds = [
    'Optimization Algorithms',
    'Supervised Learning',
    'Unsupervised Learning',
    'Statistical Learning',
    'Model Evaluation',
    'Data Preprocessing',
    'Regularization',
    'Feature Engineering',
    'Knowledge Representation',
    'Reasoning Systems'
  ];

  for (const topic of centralSeeds) {
    const ok = createMission(
      topic,
      'Central curriculum seed for autonomous expansion.',
      85
    );

    if (ok) created++;
    else skipped++;
  }

  return {
    created,
    skipped,
  };
}

export function listResearchMissions(limit = 100) {
  return db.prepare(`
    SELECT *
    FROM research_missions
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

export function completeMissionForTopic(topic: string) {
  db.prepare(`
    UPDATE research_missions
    SET status='completed', updated_at=?
    WHERE lower(topic)=lower(?)
      AND status IN ('pending','running')
  `).run(Date.now(), topic);
}
