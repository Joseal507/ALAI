import Database from 'better-sqlite3';

const db = new Database('data/alai.db');
const now = Date.now();

function cleanTopic(raw = '') {
  let s = String(raw || '').trim();

  const matches = [...s.matchAll(/target=([^|]+)/gi)];
  if (matches.length) s = matches[matches.length - 1][1].trim();

  s = s.replace(/ALAI_[A-Z_]+/g, '');
  s = s.replace(/stage=[^|]+/gi, '');
  s = s.replace(/path=[^|]+/gi, '');
  s = s.replace(/task=[^|]+/gi, '');
  s = s.replace(/mastery_required=[^|]+/gi, '');
  s = s.replace(/reason=[^|]+/gi, '');
  s = s.replace(/^concept:\s*/i, '');
  s = s.replace(/^concepto:\s*/i, '');
  s = s.replace(/^name:\s*/i, '');
  s = s.replace(/^nombre:\s*/i, '');
  s = s.replace(/\|/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();

  return s.slice(0, 160);
}

function kind(topic = '') {
  const t = String(topic).toLowerCase();

  if (!topic || topic.length < 2) return 'invalid';
  if (t.includes('alai_') || t.includes('stage=') || t.includes('target=') || t.includes('task=') || t.includes('path=')) return 'metadata';
  if (t.includes('facultad completa')) return 'faculty';
  if (t.includes('carrera completa')) return 'career';
  if (t.includes('programa completo')) return 'program';
  if (topic.length > 140) return 'too_long';

  return 'concept';
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

db.exec(`
CREATE TABLE IF NOT EXISTS canonical_topic_registry (
  id TEXT PRIMARY KEY,
  raw_topic TEXT NOT NULL,
  canonical_topic TEXT NOT NULL,
  topic_kind TEXT NOT NULL,
  action TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
`);

let registered = 0;
let jobsCleaned = 0;
let jobsArchived = 0;
let missionsCleaned = 0;
let missionsArchived = 0;
let masteryFixed = 0;

const register = db.prepare(`
INSERT OR REPLACE INTO canonical_topic_registry
(id, raw_topic, canonical_topic, topic_kind, action, created_at, updated_at)
VALUES
(@id, @raw, @canonical, @kind, @action, @now, @now)
`);

// 1) Learning jobs hygiene
const jobs = db.prepare(`
SELECT id, topic, stage, status
FROM learning_jobs
WHERE status IN ('pending','failed')
`).all();

for (const j of jobs) {
  const raw = String(j.topic || '');
  const canonical = cleanTopic(raw);
  const k = kind(canonical);

  let action = 'keep';

  if (k === 'metadata' || k === 'invalid' || k === 'too_long') {
    action = 'archive';
    db.prepare(`
      UPDATE learning_jobs
      SET status='archived',
          priority=0,
          updated_at=?
      WHERE id=?
    `).run(now, j.id);
    jobsArchived++;
  }

  if (k === 'faculty' || k === 'career' || k === 'program') {
    action = 'curriculum_expand_only';
    db.prepare(`
      UPDATE learning_jobs
      SET priority=200000,
          updated_at=?
      WHERE id=?
    `).run(now, j.id);
  }

  if (k === 'concept' && raw.includes('target=ALAI_')) {
    action = 'clean_nested';
    db.prepare(`
      UPDATE learning_jobs
      SET topic=?,
          updated_at=?
      WHERE id=?
    `).run(
      `ALAI_LEARN_TOPIC | stage=${j.stage || activeStage} | target=${canonical} | task=Learn this clean canonical topic.`,
      now,
      j.id
    );
    jobsCleaned++;
  }

  register.run({
    id: `ctr_job_${safe(j.id)}`,
    raw,
    canonical,
    kind: k,
    action,
    now
  });
  registered++;
}

// 2) Research missions hygiene
const missions = db.prepare(`
SELECT id, topic, reason, status
FROM research_missions
WHERE status='pending'
`).all();

for (const m of missions) {
  const raw = String(m.topic || '');
  const canonical = cleanTopic(raw);
  const k = kind(canonical);

  let action = 'keep';

  if (k === 'metadata' || k === 'invalid' || k === 'too_long') {
    action = 'archive';
    db.prepare(`
      UPDATE research_missions
      SET status='archived',
          updated_at=?
      WHERE id=?
    `).run(now, m.id);
    missionsArchived++;
  } else if (canonical !== raw) {
    action = 'clean';
    db.prepare(`
      UPDATE research_missions
      SET topic=?,
          updated_at=?
      WHERE id=?
    `).run(canonical, now, m.id);
    missionsCleaned++;
  }

  if (k === 'faculty' || k === 'career' || k === 'program') {
    action = 'deprioritize_structure';
    db.prepare(`
      UPDATE research_missions
      SET priority=300000,
          updated_at=?
      WHERE id=?
    `).run(now, m.id);
  }

  register.run({
    id: `ctr_mission_${safe(m.id)}`,
    raw,
    canonical,
    kind: k,
    action,
    now
  });
  registered++;
}

// 3) Mastery consistency: completed/verified only if confidence >=90
db.prepare(`
UPDATE mastery_progress
SET completed=CASE WHEN confidence >= 90 THEN 1 ELSE 0 END,
    verified=CASE WHEN confidence >= 90 THEN 1 ELSE 0 END,
    updated_at=?
WHERE stage=?
`).run(now, activeStage);

masteryFixed = db.prepare("SELECT changes() c").get().c;

// 4) Keep required weak topics at the top; research below exact required.
db.prepare(`
UPDATE learning_jobs
SET priority=999999,
    status='pending',
    updated_at=?
WHERE stage=?
  AND topic LIKE 'ALAI_LEARN_TOPIC%'
  AND topic LIKE '%path=%'
  AND topic LIKE '%mastery_required=90%'
  AND status!='completed'
`).run(now, activeStage);

db.prepare(`
UPDATE learning_jobs
SET priority=940000,
    updated_at=?
WHERE stage=?
  AND topic LIKE 'ALAI_RESEARCH_TOPIC%'
  AND status='pending'
`).run(now, activeStage);

db.prepare(`
UPDATE learning_jobs
SET priority=200000,
    updated_at=?
WHERE stage=?
  AND topic LIKE 'ALAI_CURRICULUM_EXPAND%'
  AND status='pending'
`).run(now, activeStage);

console.log(JSON.stringify({
  active_stage: activeStage,
  registry_rows_written: registered,
  jobs_cleaned: jobsCleaned,
  jobs_archived: jobsArchived,
  missions_cleaned: missionsCleaned,
  missions_archived: missionsArchived,
  mastery_rows_normalized: masteryFixed,
  topic_kinds: db.prepare(`
    SELECT topic_kind, COUNT(*) total
    FROM canonical_topic_registry
    GROUP BY topic_kind
    ORDER BY total DESC
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
