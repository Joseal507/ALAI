import Database from 'better-sqlite3';
import fs from 'fs';
import zlib from 'zlib';

const db = new Database('data/alai.db');
const now = Date.now();

function safe(sql) { try { db.exec(sql); } catch {} }

safe(`ALTER TABLE learning_jobs ADD COLUMN stage TEXT DEFAULT 'POST_DOCTORADO'`);
safe(`ALTER TABLE learning_jobs ADD COLUMN base_priority INTEGER DEFAULT 0`);
safe(`ALTER TABLE learning_jobs ADD COLUMN source TEXT DEFAULT 'auto'`);

db.exec(`
CREATE TABLE IF NOT EXISTS education_nodes (
  id TEXT PRIMARY KEY,
  parent_id TEXT,
  stage TEXT NOT NULL,
  node_type TEXT NOT NULL,
  name TEXT NOT NULL,
  path TEXT NOT NULL UNIQUE,
  priority INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'planned',
  mastery_score INTEGER NOT NULL DEFAULT 0,
  coverage_score INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS education_expansion_requests (
  id TEXT PRIMARY KEY,
  node_path TEXT NOT NULL UNIQUE,
  stage TEXT NOT NULL,
  target TEXT NOT NULL,
  depth INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
`);

function id(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

const addJob = db.prepare(`
INSERT OR IGNORE INTO learning_jobs
(id, topic, priority, status, created_at, updated_at, stage, base_priority, source)
VALUES (@id,@topic,@priority,'pending',@created_at,@updated_at,@stage,@base_priority,@source)
`);

const rows = db.prepare(`
SELECT path, stage, name, node_type, priority
FROM education_nodes
WHERE node_type IN ('subject','career','research_area','unit','required_topic')
ORDER BY priority DESC, created_at ASC
LIMIT 80
`).all();

let created = 0;

for (const r of rows) {
  const already = db.prepare(`
    SELECT id FROM education_expansion_requests
    WHERE node_path=?
  `).get(r.path);

  if (!already) {
    db.prepare(`
    INSERT INTO education_expansion_requests
    (id,node_path,stage,target,depth,status,created_at,updated_at)
    VALUES (?,?,?,?,0,'pending',?,?)
    `).run(id('expand'), r.path, r.stage, r.name, now, now);
  }

  const topic =
    `ALAI_EXPAND_NODE | stage=${r.stage} | path=${r.path} | target=${r.name} | ` +
    `task=Research this academic node deeply. Discover all required child branches, units, topics, subtopics, concepts, exercises, prerequisites, and assessments needed for absolute mastery. ` +
    `Do not learn only the surface. Build the complete curriculum tree until no important educational child is missing.`;

  addJob.run({
    id: id('job'),
    topic,
    priority: Math.max(Number(r.priority || 0) + 5000, 100000),
    created_at: now,
    updated_at: now,
    stage: r.stage,
    base_priority: Math.max(Number(r.priority || 0) + 5000, 100000),
    source: 'auto_expander'
  });

  created++;
}

fs.mkdirSync('seed', { recursive: true });
fs.copyFileSync('data/alai.db', 'seed/alai.seed.db');
fs.writeFileSync('seed/alai.seed.db.gz', zlib.gzipSync(fs.readFileSync('seed/alai.seed.db')));
fs.unlinkSync('seed/alai.seed.db');

console.log(`✅ Auto Expansion Engine created ${created} expansion jobs.`);
