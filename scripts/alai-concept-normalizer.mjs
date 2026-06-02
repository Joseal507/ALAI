import Database from 'better-sqlite3';

const db = new Database('data/alai.db');
const now = Date.now();

function cleanTopic(raw) {
  let s = String(raw || '').trim();

  s = s.replace(/^ALAI_LEARN_TOPIC\s*\|\s*/i, '');
  s = s.replace(/^ALAI_REINFORCE_TOPIC\s*\|\s*/i, '');
  s = s.replace(/^ALAI_CURRICULUM_EXPAND\s*\|\s*/i, '');

  const target = s.match(/target=([^|]+)/i)?.[1];
  if (target) s = target.trim();

  s = s.replace(/^concepto:\s*/i, '');
  s = s.replace(/^concept:\s*/i, '');
  s = s.replace(/^nombre:\s*/i, '');

  s = s.split(/\s+(description|descripcion|relacion|relation|path|mastery_required|task):/i)[0].trim();
  s = s.split(/\s+\|\s+/)[0].trim();

  return s
    .replace(/\s+/g, ' ')
    .replace(/^["'`]+|["'`]+$/g, '')
    .slice(0, 160);
}

function stageIndex(stage) {
  const order = ['PREESCOLAR','PRIMARIA','PREMEDIA','MEDIA','UNIVERSIDAD','MAESTRIA','DOCTORADO','POST_DOCTORADO'];
  const i = order.indexOf(String(stage || '').toUpperCase());
  return i === -1 ? 999 : i;
}

const active = db.prepare("SELECT active_stage FROM education_control WHERE id='main'").get()?.active_stage || 'MEDIA';
const activeIndex = stageIndex(active);

db.exec(`
CREATE TABLE IF NOT EXISTS concept_aliases (
  id TEXT PRIMARY KEY,
  raw_topic TEXT NOT NULL,
  normalized_topic TEXT NOT NULL,
  stage TEXT NOT NULL DEFAULT 'UNKNOWN',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
`);

const aliasInsert = db.prepare(`
INSERT OR REPLACE INTO concept_aliases
(id, raw_topic, normalized_topic, stage, created_at, updated_at)
VALUES (@id, @raw, @normalized, @stage, @now, @now)
`);

function slug(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/[^a-z0-9]+/g,'_')
    .replace(/^_+|_+$/g,'')
    .slice(0,90);
}

const jobs = db.prepare(`
SELECT id, topic, stage, priority, status
FROM learning_jobs
WHERE status IN ('pending','failed')
`).all();

let normalized = 0;
let archivedAdvanced = 0;
let archivedGarbage = 0;

const garbage = [
  /ingles markets/i,
  /el corte ingles/i,
  /grandes almacenes/i,
  /department stores/i,
  /cadenas de supermercados/i,
  /judaeo[- ]?espanol/i,
  /indo[- ]?europeo/i,
  /peninsula iberica/i,
  /commedia dell/i,
  /arte es un ejemplo/i,
  /television publica/i
];

for (const j of jobs) {
  const clean = cleanTopic(j.topic);
  const jobStageMatch = String(j.topic || '').match(/stage=([A-Z_]+)/i);
  const realStage = (j.stage && j.stage !== 'UNKNOWN') ? j.stage : (jobStageMatch?.[1]?.toUpperCase() || 'UNKNOWN');

  aliasInsert.run({
    id: `alias_${slug(j.id)}`,
    raw: j.topic,
    normalized: clean,
    stage: realStage,
    now
  });

  if (garbage.some(rx => rx.test(j.topic) || rx.test(clean))) {
    db.prepare("UPDATE learning_jobs SET status='archived', priority=0, updated_at=? WHERE id=?").run(now, j.id);
    archivedGarbage++;
    continue;
  }

  if (stageIndex(realStage) > activeIndex + 1) {
    db.prepare("UPDATE learning_jobs SET status='archived', priority=0, updated_at=? WHERE id=?").run(now, j.id);
    archivedAdvanced++;
    continue;
  }

  if (
    String(j.topic).length > 220 &&
    !String(j.topic).includes('path=') &&
    clean &&
    clean.length < 160
  ) {
    db.prepare(`
      UPDATE learning_jobs
      SET topic=?,
          updated_at=?
      WHERE id=?
    `).run(`ALAI_LEARN_TOPIC | stage=${realStage} | target=${clean} | task=Learn this discovered child topic completely.`, now, j.id);
    normalized++;
  }
}

db.prepare(`
UPDATE learning_jobs
SET priority=25000
WHERE status='pending'
  AND stage='UNKNOWN'
`).run();

db.prepare(`
UPDATE learning_jobs
SET priority=50000
WHERE status='pending'
  AND topic LIKE ?
  AND topic NOT LIKE '%path=%'
`).run(`ALAI_LEARN_TOPIC | stage=${active}%`);

console.log(JSON.stringify({
  active_stage: active,
  normalized_jobs: normalized,
  archived_advanced: archivedAdvanced,
  archived_garbage: archivedGarbage,
  aliases: db.prepare("SELECT COUNT(*) total FROM concept_aliases").get().total
}, null, 2));

db.close();
