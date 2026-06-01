import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const dataDir = path.join(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const dbPath = path.join(dataDir, 'alai.db');

export const db = new Database(dbPath);

db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS knowledge_units (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  explanation TEXT NOT NULL,
  examples TEXT NOT NULL,
  common_mistakes TEXT NOT NULL,
  related_concepts TEXT NOT NULL,
  sources TEXT NOT NULL,
  confidence INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS learning_jobs (
  id TEXT PRIMARY KEY,
  topic TEXT NOT NULL,
  priority INTEGER NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);





CREATE TABLE IF NOT EXISTS knowledge_entities (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  canonical_name TEXT NOT NULL,
  entity_type TEXT DEFAULT 'concept',
  confidence REAL DEFAULT 0.5,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_entities_name
ON knowledge_entities(canonical_name);
\nCREATE TABLE IF NOT EXISTS knowledge_edges (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  target TEXT NOT NULL,
  relation TEXT NOT NULL,
  confidence REAL DEFAULT 0.5,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_edges_source ON knowledge_edges(source);
CREATE INDEX IF NOT EXISTS idx_edges_target ON knowledge_edges(target);

CREATE TABLE IF NOT EXISTS knowledge_inferences (
  id TEXT PRIMARY KEY,
  claim_a TEXT NOT NULL,
  claim_b TEXT NOT NULL,
  subject TEXT NOT NULL,
  inference TEXT NOT NULL,
  confidence INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_knowledge_inferences_subject ON knowledge_inferences(subject);

CREATE TABLE IF NOT EXISTS claim_verifications (
  id TEXT PRIMARY KEY,
  claim_id TEXT NOT NULL,
  verdict TEXT NOT NULL,
  reason TEXT NOT NULL,
  confidence_delta INTEGER NOT NULL,
  provider TEXT,
  model TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_claim_verifications_claim ON claim_verifications(claim_id);
CREATE INDEX IF NOT EXISTS idx_claim_verifications_verdict ON claim_verifications(verdict);

CREATE TABLE IF NOT EXISTS knowledge_claims (
  id TEXT PRIMARY KEY,
  knowledge_id TEXT NOT NULL,
  title TEXT NOT NULL,
  subject TEXT NOT NULL,
  predicate TEXT NOT NULL,
  object TEXT NOT NULL,
  confidence INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_knowledge_claims_subject ON knowledge_claims(subject);
CREATE INDEX IF NOT EXISTS idx_knowledge_claims_object ON knowledge_claims(object);
CREATE INDEX IF NOT EXISTS idx_knowledge_claims_predicate ON knowledge_claims(predicate);


CREATE TABLE IF NOT EXISTS knowledge_conflicts (
  id TEXT PRIMARY KEY,
  knowledge_a TEXT NOT NULL,
  knowledge_b TEXT NOT NULL,
  title_a TEXT NOT NULL,
  title_b TEXT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_knowledge_conflicts_status ON knowledge_conflicts(status);

CREATE TABLE IF NOT EXISTS canonical_knowledge (
  id TEXT PRIMARY KEY,
  knowledge_id TEXT NOT NULL,
  title TEXT NOT NULL,
  canonical_title TEXT NOT NULL,
  canonical_summary TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  confidence INTEGER NOT NULL,
  sources TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_canonical_knowledge_fingerprint ON canonical_knowledge(fingerprint);

CREATE TABLE IF NOT EXISTS semantic_memory (
  id TEXT PRIMARY KEY,
  knowledge_id TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  tokens TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_semantic_memory_knowledge ON semantic_memory(knowledge_id);

CREATE TABLE IF NOT EXISTS research_missions (
  id TEXT PRIMARY KEY,
  topic TEXT NOT NULL,
  reason TEXT NOT NULL,
  priority INTEGER NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_research_missions_status ON research_missions(status);

CREATE TABLE IF NOT EXISTS learning_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  topic TEXT,
  title TEXT,
  provider TEXT,
  confidence INTEGER,
  message TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_learning_events_created ON learning_events(created_at);

`);


try {
  db.prepare("ALTER TABLE knowledge_claims ADD COLUMN entity_type TEXT DEFAULT 'general'").run();
} catch (err: any) {
  if (!String(err?.message || '').includes('duplicate column name')) throw err;
}

try {
  db.prepare("ALTER TABLE knowledge_claims ADD COLUMN canonical_subject TEXT DEFAULT ''").run();
} catch (err: any) {
  if (!String(err?.message || '').includes('duplicate column name')) throw err;
}
