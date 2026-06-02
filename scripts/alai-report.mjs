import Database from 'better-sqlite3';
import fs from 'fs';

const dbPath = 'data/alai.db';

if (!fs.existsSync(dbPath)) {
  console.error('❌ No existe data/alai.db');
  process.exit(1);
}

const db = new Database(dbPath);

function tableExists(name) {
  return db.prepare(`
    SELECT name FROM sqlite_master
    WHERE type='table' AND name=?
  `).get(name);
}

function count(table, where = '1=1') {
  if (!tableExists(table)) return 0;
  return db.prepare(`SELECT COUNT(*) AS total FROM ${table} WHERE ${where}`).get().total || 0;
}

function one(sql, fallback = null) {
  try {
    return db.prepare(sql).get() || fallback;
  } catch {
    return fallback;
  }
}

function all(sql) {
  try {
    return db.prepare(sql).all();
  } catch {
    return [];
  }
}

const active = one(`
  SELECT active_stage FROM education_control WHERE id='main'
`, { active_stage: 'UNKNOWN' });

const stages = [
  'CHAT_PRIORITY',
  'PREESCOLAR',
  'PRIMARIA',
  'PREMEDIA',
  'MEDIA',
  'UNIVERSIDAD',
  'MAESTRIA',
  'DOCTORADO',
  'POST_DOCTORADO'
];

console.log('');
console.log('🧠 ALAI KNOWLEDGE REPORT');
console.log('========================');
console.log('');
console.log(`🎯 Nivel activo: ${active.active_stage}`);
console.log('');

console.log('📚 Progreso educativo');
console.log('---------------------');

for (const stage of stages) {
  const total = count('learning_jobs', `stage='${stage}'`);
  const completed = count('learning_jobs', `stage='${stage}' AND status='completed'`);
  const pending = count('learning_jobs', `stage='${stage}' AND status='pending'`);
  const failed = count('learning_jobs', `stage='${stage}' AND status='failed'`);
  const running = count('learning_jobs', `stage='${stage}' AND status='running'`);
  const pct = total ? Math.round((completed / total) * 100) : 0;

  if (total > 0) {
    console.log(`${stage.padEnd(15)} ${String(pct).padStart(3)}%  completed:${completed} pending:${pending} running:${running} failed:${failed} total:${total}`);
  }
}

console.log('');
console.log('🧩 Conocimiento');
console.log('---------------');
console.log(`knowledge_units:       ${count('knowledge_units')}`);
console.log(`canonical_knowledge:   ${count('canonical_knowledge')}`);
console.log(`knowledge_claims:      ${count('knowledge_claims')}`);
console.log(`claim_verifications:   ${count('claim_verifications')}`);
console.log(`knowledge_entities:    ${count('knowledge_entities')}`);
console.log(`knowledge_edges:       ${count('knowledge_edges')}`);
console.log(`semantic_memory:       ${count('semantic_memory')}`);

const conf = one(`
  SELECT
    ROUND(AVG(confidence), 2) AS avg,
    MIN(confidence) AS min,
    MAX(confidence) AS max
  FROM knowledge_units
`, { avg: 0, min: 0, max: 0 });

console.log('');
console.log('🏆 Confianza');
console.log('------------');
console.log(`avg: ${conf.avg || 0} | min: ${conf.min || 0} | max: ${conf.max || 0}`);

console.log('');
console.log('⚙️ Jobs generales');
console.log('-----------------');

const jobs = all(`
  SELECT status, COUNT(*) AS total
  FROM learning_jobs
  GROUP BY status
  ORDER BY total DESC
`);

for (const j of jobs) {
  console.log(`${j.status.padEnd(12)} ${j.total}`);
}

console.log('');
console.log('🔥 Próximos 20 jobs');
console.log('-------------------');

const next = all(`
  SELECT stage, topic, priority
  FROM learning_jobs
  WHERE status='pending'
  ORDER BY priority DESC, created_at ASC
  LIMIT 20
`);

for (const [i, j] of next.entries()) {
  console.log(`${String(i + 1).padStart(2)}. [${j.stage}] p=${j.priority} ${j.topic}`);
}

console.log('');
console.log('❌ Fallos recientes');
console.log('------------------');

const failed = all(`
  SELECT stage, topic, priority
  FROM learning_jobs
  WHERE status='failed'
  ORDER BY updated_at DESC
  LIMIT 10
`);

if (failed.length === 0) {
  console.log('Sin fallos.');
} else {
  for (const j of failed) {
    console.log(`[${j.stage}] p=${j.priority} ${j.topic}`);
  }
}

console.log('');
console.log('✅ Reporte terminado.');
console.log('');

db.close();
