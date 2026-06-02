import Database from 'better-sqlite3';
import fs from 'fs';

const db = new Database('data/alai.db');

function table(name) {
  return db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(name);
}

function count(t, where = '1=1') {
  if (!table(t)) return 0;
  return db.prepare(`SELECT COUNT(*) total FROM ${t} WHERE ${where}`).get().total || 0;
}

function one(sql, fallback = {}) {
  try { return db.prepare(sql).get() || fallback; } catch { return fallback; }
}

function all(sql) {
  try { return db.prepare(sql).all(); } catch { return []; }
}

const active = one(`SELECT active_stage, mode FROM education_control WHERE id='main'`, {active_stage:'UNKNOWN', mode:'UNKNOWN'});

console.log('');
console.log('🧠 ALAI KNOWLEDGE CONTROL');
console.log('========================');
console.log('');
console.log(`🎯 Nivel activo: ${active.active_stage}`);
console.log(`⚙️ Modo: ${active.mode}`);
console.log('');

const stages = ['CHAT_PRIORITY','PREESCOLAR','PRIMARIA','PREMEDIA','MEDIA','UNIVERSIDAD','MAESTRIA','DOCTORADO','POST_DOCTORADO'];

console.log('📚 Progreso por nivel');
console.log('---------------------');
for (const s of stages) {
  const total = count('learning_jobs', `stage='${s}'`);
  if (!total) continue;
  const completed = count('learning_jobs', `stage='${s}' AND status='completed'`);
  const pending = count('learning_jobs', `stage='${s}' AND status='pending'`);
  const running = count('learning_jobs', `stage='${s}' AND status='running'`);
  const failed = count('learning_jobs', `stage='${s}' AND status='failed'`);
  const pct = Math.round((completed / total) * 100);
  console.log(`${s.padEnd(15)} ${String(pct).padStart(3)}% completed:${completed} pending:${pending} running:${running} failed:${failed} total:${total}`);
}

console.log('');
console.log('🏛️ Curriculum OS');
console.log('----------------');
for (const r of all(`
  SELECT stage, node_type, COUNT(*) total
  FROM education_nodes
  GROUP BY stage, node_type
  ORDER BY stage, node_type
`)) {
  console.log(`${r.stage.padEnd(15)} ${r.node_type.padEnd(16)} ${r.total}`);
}

console.log('');
console.log('🧩 Conocimiento');
console.log('---------------');
for (const t of ['knowledge_units','canonical_knowledge','knowledge_claims','claim_verifications','knowledge_entities','knowledge_edges','semantic_memory']) {
  console.log(`${t.padEnd(24)} ${count(t)}`);
}

const conf = one(`SELECT ROUND(AVG(confidence),2) avg, MIN(confidence) min, MAX(confidence) max FROM knowledge_units`, {avg:0,min:0,max:0});
console.log('');
console.log('🏆 Confianza');
console.log('------------');
console.log(`avg:${conf.avg || 0} min:${conf.min || 0} max:${conf.max || 0}`);

console.log('');
console.log('🔥 Próximos 20 aprendizajes');
console.log('---------------------------');
for (const [i,j] of all(`
  SELECT stage, topic, priority
  FROM learning_jobs
  WHERE status='pending'
  ORDER BY priority DESC, created_at ASC
  LIMIT 20
`).entries()) {
  console.log(`${String(i+1).padStart(2)}. [${j.stage}] p=${j.priority} ${j.topic}`);
}

console.log('');
console.log('❌ Fallos recientes');
console.log('------------------');
const fails = all(`SELECT stage, topic, priority FROM learning_jobs WHERE status='failed' ORDER BY updated_at DESC LIMIT 10`);
if (!fails.length) console.log('Sin fallos.');
for (const f of fails) console.log(`[${f.stage}] p=${f.priority} ${f.topic}`);

console.log('');
console.log('✅ Reporte terminado.');
console.log('');
db.close();
