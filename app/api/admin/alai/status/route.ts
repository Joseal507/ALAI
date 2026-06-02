import { NextResponse } from 'next/server';
import Database from 'better-sqlite3';
import path from 'path';

export const dynamic = 'force-dynamic';

function db() {
  return new Database(path.join(process.cwd(), 'data', 'alai.db'));
}

function exists(database: Database.Database, table: string) {
  return database.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(table);
}

function count(database: Database.Database, table: string, where = '1=1') {
  if (!exists(database, table)) return 0;
  const row = database.prepare(`SELECT COUNT(*) AS total FROM ${table} WHERE ${where}`).get() as { total?: number } | undefined;
  return Number(row?.total || 0);
}

export async function GET() {
  const database = db();

  const control = (database.prepare(`
    SELECT active_stage, mode, chat_priority_enabled
    FROM education_control
    WHERE id='main'
  `).get() as any) || { active_stage: 'UNKNOWN', mode: 'UNKNOWN', chat_priority_enabled: 0 };

  const stages = ['CHAT_PRIORITY','PREESCOLAR','PRIMARIA','PREMEDIA','MEDIA','UNIVERSIDAD','MAESTRIA','DOCTORADO','POST_DOCTORADO'];

  const progress = stages.map((stage) => {
    const total = count(database, 'learning_jobs', `stage='${stage}'`);
    const completed = count(database, 'learning_jobs', `stage='${stage}' AND status='completed'`);
    const pending = count(database, 'learning_jobs', `stage='${stage}' AND status='pending'`);
    const running = count(database, 'learning_jobs', `stage='${stage}' AND status='running'`);
    const failed = count(database, 'learning_jobs', `stage='${stage}' AND status='failed'`);
    return { stage, total, completed, pending, running, failed, pct: total ? Math.round((completed / total) * 100) : 0 };
  }).filter((x) => x.total > 0);

  const nodes = exists(database, 'education_nodes')
    ? database.prepare(`
      SELECT stage, node_type, COUNT(*) AS total
      FROM education_nodes
      GROUP BY stage, node_type
      ORDER BY stage, node_type
    `).all()
    : [];

  const nextJobs = exists(database, 'learning_jobs')
    ? database.prepare(`
      SELECT stage, topic, priority, status
      FROM learning_jobs
      WHERE status='pending'
      ORDER BY priority DESC, created_at ASC
      LIMIT 30
    `).all()
    : [];

  const knowledge = {
    knowledge_units: count(database, 'knowledge_units'),
    canonical_knowledge: count(database, 'canonical_knowledge'),
    knowledge_claims: count(database, 'knowledge_claims'),
    claim_verifications: count(database, 'claim_verifications'),
    knowledge_entities: count(database, 'knowledge_entities'),
    knowledge_edges: count(database, 'knowledge_edges'),
    semantic_memory: count(database, 'semantic_memory'),
    mastery_progress: count(database, 'mastery_progress')
  };

  const coverage = exists(database, 'education_required_coverage') && exists(database, 'mastery_progress')
    ? database.prepare(`
      SELECT c.stage,
             COUNT(*) AS total,
             SUM(CASE WHEN mp.completed=1 THEN 1 ELSE 0 END) AS completed,
             ROUND(AVG(CASE WHEN mp.completed=1 THEN mp.confidence ELSE NULL END),2) AS avg_confidence
      FROM education_required_coverage c
      LEFT JOIN mastery_progress mp
        ON mp.path = c.path
      GROUP BY c.stage
      ORDER BY c.stage
    `).all()
    : [];

  const confidence = exists(database, 'knowledge_units')
    ? (database.prepare(`SELECT ROUND(AVG(confidence),2) AS avg, MIN(confidence) AS min, MAX(confidence) AS max FROM knowledge_units`).get() as any)
    : { avg: 0, min: 0, max: 0 };

  database.close();

  return NextResponse.json({
    ok: true,
    control,
    progress,
    nodes,
    nextJobs,
    knowledge,
    confidence,
    coverage
  });
}
