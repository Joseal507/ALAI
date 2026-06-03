import Database from 'better-sqlite3';

const db = new Database('data/alai.db');
const now = Date.now();


function isStructureTopic(topic = '') {
  const t = String(topic || '').toLowerCase();
  return (
    t.includes('facultad completa') ||
    t.includes('carrera completa') ||
    t.includes('programa completo') ||
    t.startsWith('facultad ') ||
    t.startsWith('carrera ')
  );
}

function isInternalTopic(topic = '') {
  const t = String(topic || '');
  return (
    t.includes('ALAI_') ||
    t.includes('stage=') ||
    t.includes('path=') ||
    t.includes('task=') ||
    t.includes('mastery_required=')
  );
}

function safe(s) {
  return String(s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 180);
}

const activeStage = db.prepare(
  "SELECT active_stage FROM education_control WHERE id='main'"
).get()?.active_stage || 'UNIVERSIDAD';

const insertMission = db.prepare(`
INSERT OR IGNORE INTO research_missions
(id, topic, reason, priority, status, created_at, updated_at)
VALUES
(@id, @topic, @reason, @priority, 'pending', @now, @now)
`);

let missions = 0;
let jobs = 0;

// 1) Missions por required topics bajo 90
const weakRequired = db.prepare(`
SELECT path, topic, confidence
FROM mastery_progress
WHERE stage=?
  AND confidence < 90
ORDER BY confidence ASC
`).all(activeStage);

for (const w of weakRequired) {
  if (isStructureTopic(w.topic) || isInternalTopic(w.topic)) {
    continue;
  }

  insertMission.run({
    id: `mission_gap_${safe(w.path)}`,
    topic: w.topic,
    reason: `KNOWLEDGE_GAP | stage=${activeStage} | path=${w.path} | confidence=${w.confidence} | goal=Raise mastery to 90+ with missing concepts, examples, claims, sources, and prerequisite reinforcement.`,
    priority: 950000,
    now
  });
  missions++;

  db.prepare(`
    INSERT OR IGNORE INTO learning_jobs
    (id, topic, stage, priority, status, created_at, updated_at)
    VALUES
    (@id, @topic, @stage, 940000, 'pending', @now, @now)
  `).run({
    id: `job_mission_gap_${safe(w.path)}`,
    topic: `ALAI_RESEARCH_TOPIC | stage=${activeStage} | target=${w.topic} | task=Diagnose why mastery is below 90 and produce missing concepts, examples, claims, sources, and study plan.`,
    stage: activeStage,
    now
  });
  jobs++;
}

// 2) Missions por prerequisitos faltantes
const missingPrereqs = db.prepare(`
SELECT topic, prerequisite, confidence
FROM education_prerequisite_links
WHERE stage=?
  AND status='missing'
ORDER BY topic ASC
LIMIT 80
`).all(activeStage);

for (const p of missingPrereqs) {
  insertMission.run({
    id: `mission_prereq_${safe(activeStage)}_${safe(p.topic)}_${safe(p.prerequisite)}`,
    topic: p.prerequisite,
    reason: `PREREQUISITE_GAP | stage=${activeStage} | parent=${p.topic} | prerequisite=${p.prerequisite} | confidence=${p.confidence} | goal=Learn prerequisite before retrying parent topic.`,
    priority: 930000,
    now
  });
  missions++;

  db.prepare(`
    INSERT OR IGNORE INTO learning_jobs
    (id, topic, stage, priority, status, created_at, updated_at)
    VALUES
    (@id, @topic, @stage, 930000, 'pending', @now, @now)
  `).run({
    id: `job_mission_prereq_${safe(activeStage)}_${safe(p.topic)}_${safe(p.prerequisite)}`,
    topic: `ALAI_LEARN_TOPIC | stage=${activeStage} | parent=${p.topic} | target=${p.prerequisite} | task=Learn missing prerequisite deeply and connect it back to ${p.topic}.`,
    stage: activeStage,
    now
  });
  jobs++;
}

// 3) Missions por evidence score bajo
const weakEvidence = db.prepare(`
SELECT title, final_score
FROM evidence_scores
WHERE final_score < 50
ORDER BY final_score ASC
LIMIT 80
`).all();

for (const e of weakEvidence) {
  if (String(e.title).startsWith('ALAI_')) continue;
  if (isStructureTopic(e.title) || isInternalTopic(e.title)) continue;

  insertMission.run({
    id: `mission_evidence_${safe(e.title)}`,
    topic: e.title,
    reason: `EVIDENCE_GAP | final_score=${e.final_score} | goal=Add claims, verifications, entities, graph edges, inferences, and sources.`,
    priority: 850000,
    now
  });
  missions++;
}

// 4) Missions por conflictos reales pendientes
const conflicts = db.prepare(`
SELECT id, title_a, title_b, reason
FROM knowledge_conflicts
WHERE status='open'
LIMIT 50
`).all();

for (const c of conflicts) {
  insertMission.run({
    id: `mission_conflict_${safe(c.id)}`,
    topic: c.title_a,
    reason: `CONFLICT_INVESTIGATION | conflict_id=${c.id} | title_a=${c.title_a} | title_b=${c.title_b} | reason=${c.reason} | goal=Resolve contradiction using stronger evidence.`,
    priority: 900000,
    now
  });
  missions++;
}

// 5) Bajar curriculum expansion por debajo de research/prereq
db.prepare(`
UPDATE learning_jobs
SET priority=200000,
    updated_at=?
WHERE status='pending'
  AND topic LIKE 'ALAI_CURRICULUM_EXPAND%'
`).run(now);

console.log(JSON.stringify({
  active_stage: activeStage,
  missions_attempted: missions,
  research_jobs_attempted: jobs,
  mission_counts: db.prepare(`
    SELECT status, COUNT(*) total
    FROM research_missions
    GROUP BY status
  `).all(),
  top_jobs: db.prepare(`
    SELECT stage, priority, substr(topic,1,180) topic
    FROM learning_jobs
    WHERE status='pending'
    ORDER BY priority DESC
    LIMIT 20
  `).all()
}, null, 2));

db.close();
