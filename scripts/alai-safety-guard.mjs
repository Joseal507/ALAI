import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const mode = process.argv[2];
const dbPath = 'data/alai.db';
const backupDir = 'data/safety-backups';
const statePath = path.join(backupDir, 'latest-safety.json');

if (!['before', 'after'].includes(mode)) {
  console.error('Usage: node scripts/alai-safety-guard.mjs before|after');
  process.exit(1);
}

fs.mkdirSync(backupDir, { recursive: true });

const db = new Database(dbPath);

const tables = [
  'knowledge_claims',
  'knowledge_entities',
  'semantic_memory',
  'knowledge_units',
  'knowledge_relationships',
];

function count(table) {
  return db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
}

function exists(table) {
  return db.prepare(`
    SELECT COUNT(*) AS n
    FROM sqlite_master
    WHERE type='table' AND name=?
  `).get(table).n > 0;
}

function backupTable(table) {
  const backup = `safety_backup_${table}`;
  db.exec(`DROP TABLE IF EXISTS ${backup}`);
  db.exec(`CREATE TABLE ${backup} AS SELECT * FROM ${table}`);
}

function restoreTable(table) {
  const backup = `safety_backup_${table}`;
  if (!exists(backup)) return false;

  db.exec('BEGIN');
  try {
    db.exec(`DELETE FROM ${table}`);
    db.exec(`INSERT INTO ${table} SELECT * FROM ${backup}`);
    db.exec('COMMIT');
    return true;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

if (mode === 'before') {
  const snapshot = {
    created_at: new Date().toISOString(),
    counts: {},
  };

  for (const table of tables) {
    snapshot.counts[table] = count(table);
    backupTable(table);
  }

  fs.writeFileSync(statePath, JSON.stringify(snapshot, null, 2));
  console.log(JSON.stringify({ ok: true, mode, snapshot }, null, 2));
  db.close();
  process.exit(0);
}

const before = fs.existsSync(statePath)
  ? JSON.parse(fs.readFileSync(statePath, 'utf8'))
  : null;

if (!before) {
  console.error('No safety snapshot found. Run before first.');
  db.close();
  process.exit(2);
}

const after = {};
const restored = [];
const warnings = [];

for (const table of tables) {
  const prev = Number(before.counts[table] || 0);
  const now = count(table);
  after[table] = now;

  const catastrophic =
    prev >= 100 && now < Math.floor(prev * 0.5);

  if (catastrophic) {
    restoreTable(table);
    restored.push({
      table,
      before: prev,
      unsafe_after: now,
      restored_to: count(table),
    });
  } else if (prev >= 100 && now < Math.floor(prev * 0.9)) {
    warnings.push({
      table,
      before: prev,
      after: now,
      drop_percent: Math.round((1 - now / prev) * 100),
    });
  }
}

const finalCounts = {};
for (const table of tables) finalCounts[table] = count(table);

const result = {
  ok: restored.length === 0,
  mode,
  before: before.counts,
  unsafe_after: after,
  restored,
  warnings,
  finalCounts,
};

fs.writeFileSync(path.join(backupDir, `safety-result-${Date.now()}.json`), JSON.stringify(result, null, 2));

console.log(JSON.stringify(result, null, 2));

db.close();

if (restored.length > 0) {
  process.exit(10);
}
