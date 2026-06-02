import dotenv from 'dotenv';
import Database from 'better-sqlite3';

dotenv.config({ path: '.env.local' });

const BASE = process.env.ALAI_BASE_URL || 'http://localhost:6969';
const cycles = Number(process.env.ALAI_CYCLES || 10000);
const delayMs = Number(process.env.ALAI_DELAY_MS || 15000);
const db = new Database('data/alai.db');

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function call(path, opts = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 180000);

  try {
    const res = await fetch(`${BASE}${path}`, { ...opts, signal: controller.signal });
    const text = await res.text();

    try {
      return JSON.parse(text);
    } catch {
      return { success: false, error: `NON_JSON_RESPONSE: ${text.slice(0, 1000)}` };
    }
  } catch (err) {
    return { success: false, error: String(err?.message || err) };
  } finally {
    clearTimeout(timeout);
  }
}

function one(sql, params = []) {
  return db.prepare(sql).get(...params);
}

function run(sql, params = []) {
  return db.prepare(sql).run(...params);
}

function activeStage() {
  return one("SELECT active_stage FROM education_control WHERE id='main'")?.active_stage || 'MEDIA';
}

function cleanupPriorities() {
  const stage = activeStage();

  run("UPDATE learning_jobs SET status='pending' WHERE status='running'");

  run(`
    UPDATE learning_jobs
    SET priority=25000
    WHERE status='pending'
      AND stage='UNKNOWN'
  `);

  run(`
    UPDATE learning_jobs
    SET priority=400000
    WHERE status='pending'
      AND stage=?
      AND topic LIKE 'ALAI_LEARN_TOPIC | stage=%'
      AND topic LIKE '%path=%'
  `, [stage]);

  run(`
    UPDATE learning_jobs
    SET priority=200000
    WHERE status='pending'
      AND stage=?
      AND topic LIKE 'ALAI_CURRICULUM_EXPAND%'
  `, [stage]);

  run(`
    UPDATE learning_jobs
    SET priority=50000
    WHERE status='pending'
      AND topic LIKE ?
      AND topic NOT LIKE '%path=%'
  `, [`ALAI_LEARN_TOPIC | stage=${stage}%`]);

  return stage;
}

function reviveFailedRequired() {
  const stage = activeStage();

  run(`
    UPDATE learning_jobs
    SET status='pending',
        priority=450000
    WHERE status='failed'
      AND stage=?
      AND topic LIKE 'ALAI_LEARN_TOPIC | stage=%'
      AND topic LIKE '%path=%'
  `, [stage]);
}

function topJob() {
  return one(`
    SELECT stage, priority, topic
    FROM learning_jobs
    WHERE status='pending'
    ORDER BY priority DESC, created_at ASC
    LIMIT 1
  `);
}

function metrics() {
  const stage = activeStage();

  const coverage = one(`
    SELECT
      COUNT(*) total,
      SUM(CASE WHEN mp.completed=1 THEN 1 ELSE 0 END) completed
    FROM education_required_coverage c
    LEFT JOIN mastery_progress mp ON mp.path=c.path
    WHERE c.stage=?
  `, [stage]);

  const queue = one(`
    SELECT
      SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) pending,
      SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) failed,
      SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) completed
    FROM learning_jobs
    WHERE stage=?
  `, [stage]);

  return { stage, coverage, queue };
}

for (let i = 1; i <= cycles; i++) {
  console.log(`\n🧠 ALAI autonomous core cycle ${i}/${cycles}`);

  cleanupPriorities();
  reviveFailedRequired();

  const top = topJob();
  const m = metrics();

  console.log(JSON.stringify({
    active_stage: m.stage,
    coverage: `${m.coverage?.completed || 0}/${m.coverage?.total || 0}`,
    queue: m.queue,
    next: {
      stage: top?.stage,
      priority: top?.priority,
      topic: String(top?.topic || '').slice(0, 220)
    }
  }, null, 2));

  await call('/api/gaps/fill', { method: 'POST' });
  await call('/api/focus/apply', { method: 'POST' });

  const learn = await call('/api/learn', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}'
  });

  console.log(JSON.stringify({
    success: learn.success,
    status: learn.job?.status,
    topic: learn.job?.topic,
    confidence: learn.knowledge?.confidence,
    error: learn.error
  }, null, 2));

  const error = String(learn.error || '').toLowerCase();

  if (
    error.includes('invalid json') ||
    error.includes('teacher returned invalid json') ||
    error.includes('non_json_response')
  ) {
    console.log('⚠️ JSON failure detected. Auto-requeueing required topics and continuing.');
    reviveFailedRequired();
    await sleep(5000);
    continue;
  }

  if (error.includes('429') || error.includes('rate') || error.includes('quota')) {
    console.log('⏳ Rate limit detected. Cooling down.');
    await sleep(300000);
    continue;
  }

  await sleep(delayMs);
}

db.close();
