import Database from 'better-sqlite3';

const db = new Database('data/alai.db');
const now = Date.now();

function safe(s = '') {
  return String(s)
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 160);
}

function norm(s = '') {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9ñ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 140);
}

function nice(s = '') {
  return String(s || '').trim();
}

db.exec(`
CREATE TABLE IF NOT EXISTS semantic_inference_log (
  id TEXT PRIMARY KEY,
  rule TEXT NOT NULL,
  subject_a TEXT NOT NULL,
  bridge_b TEXT NOT NULL,
  object_c TEXT NOT NULL,
  inference TEXT NOT NULL,
  confidence INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
`);

const rels = db.prepare(`
SELECT
  id,
  source_title,
  target_title,
  relationship,
  reason,
  confidence
FROM knowledge_relationships
WHERE relationship IN (
  'prerequisite_of',
  'depends_on',
  'specialization_of',
  'application_of',
  'example_of'
)
`).all();

const byType = new Map();

for (const r of rels) {
  const type = r.relationship;
  if (!byType.has(type)) byType.set(type, []);
  byType.get(type).push({
    id: r.id,
    source: nice(r.source_title),
    target: nice(r.target_title),
    s: norm(r.source_title),
    t: norm(r.target_title),
    relationship: type,
    confidence: Math.round(Number(r.confidence || 0.75) * 100)
  });
}

const insertInference = db.prepare(`
INSERT OR IGNORE INTO knowledge_inferences
(id, claim_a, claim_b, subject, inference, confidence, created_at, updated_at)
VALUES
(@id, @claim_a, @claim_b, @subject, @inference, @confidence, @now, @now)
`);

const insertLog = db.prepare(`
INSERT OR IGNORE INTO semantic_inference_log
(id, rule, subject_a, bridge_b, object_c, inference, confidence, created_at, updated_at)
VALUES
(@id, @rule, @a, @b, @c, @inference, @confidence, @now, @now)
`);

function addInference({ id, claimA, claimB, subject, rule, a, b, c, inference, confidence }) {
  insertInference.run({
    id,
    claim_a: claimA,
    claim_b: claimB,
    subject,
    inference,
    confidence,
    now
  });

  insertLog.run({
    id,
    rule,
    a,
    b,
    c,
    inference,
    confidence,
    now
  });
}

let attempted = 0;
let cyclesSkipped = 0;

// Rule 1: prerequisite chain
for (const a of byType.get('prerequisite_of') || []) {
  for (const b of byType.get('prerequisite_of') || []) {
    if (a.id === b.id) continue;
    if (a.t !== b.s) continue;
    if (a.s === b.t) {
      cyclesSkipped++;
      continue;
    }

    const confidence = Math.min(95, Math.round((a.confidence + b.confidence) / 2));
    const inference = `${a.source} es prerequisito indirecto de ${b.target} porque prepara para ${a.target}, y ${a.target} prepara para ${b.target}.`;

    addInference({
      id: `sem_prereq_${safe(a.s)}_${safe(a.t)}_${safe(b.t)}`,
      claimA: a.id,
      claimB: b.id,
      subject: a.s,
      rule: 'indirect_prerequisite_of',
      a: a.source,
      b: a.target,
      c: b.target,
      inference,
      confidence
    });

    attempted++;
  }
}

// Rule 2: dependency chain
for (const a of byType.get('depends_on') || []) {
  for (const b of byType.get('depends_on') || []) {
    if (a.id === b.id) continue;
    if (a.t !== b.s) continue;
    if (a.s === b.t) {
      cyclesSkipped++;
      continue;
    }

    const confidence = Math.min(95, Math.round((a.confidence + b.confidence) / 2));
    const inference = `${a.source} depende indirectamente de ${b.target} porque depende de ${a.target}, y ${a.target} depende de ${b.target}.`;

    addInference({
      id: `sem_dep_${safe(a.s)}_${safe(a.t)}_${safe(b.t)}`,
      claimA: a.id,
      claimB: b.id,
      subject: a.s,
      rule: 'indirectly_depends_on',
      a: a.source,
      b: a.target,
      c: b.target,
      inference,
      confidence
    });

    attempted++;
  }
}

// Rule 3: specialization inheritance
for (const a of byType.get('specialization_of') || []) {
  for (const b of byType.get('application_of') || []) {
    if (a.t !== b.s) continue;
    if (a.s === b.t) continue;

    const confidence = Math.min(92, Math.round((a.confidence + b.confidence) / 2));
    const inference = `${a.source} puede heredar aplicaciones de ${a.target}; si ${a.target} se aplica en ${b.target}, entonces ${a.source} puede relacionarse con ${b.target}.`;

    addInference({
      id: `sem_spec_app_${safe(a.s)}_${safe(a.t)}_${safe(b.t)}`,
      claimA: a.id,
      claimB: b.id,
      subject: a.s,
      rule: 'inherits_application',
      a: a.source,
      b: a.target,
      c: b.target,
      inference,
      confidence
    });

    attempted++;
  }
}

// Rule 4: example supports concept
for (const a of byType.get('example_of') || []) {
  for (const b of byType.get('application_of') || []) {
    if (a.t !== b.s) continue;
    if (a.s === b.t) continue;

    const confidence = Math.min(90, Math.round((a.confidence + b.confidence) / 2));
    const inference = `${a.source} puede servir como ejemplo aplicado de ${b.target} porque ejemplifica ${a.target}, y ${a.target} se aplica en ${b.target}.`;

    addInference({
      id: `sem_example_app_${safe(a.s)}_${safe(a.t)}_${safe(b.t)}`,
      claimA: a.id,
      claimB: b.id,
      subject: a.s,
      rule: 'example_supports_application',
      a: a.source,
      b: a.target,
      c: b.target,
      inference,
      confidence
    });

    attempted++;
  }
}

console.log(JSON.stringify({
  relationships_used: rels.length,
  semantic_inferences_attempted: attempted,
  cycles_skipped: cyclesSkipped,
  semantic_log_total: db.prepare("SELECT COUNT(*) total FROM semantic_inference_log").get().total,
  total_inferences: db.prepare("SELECT COUNT(*) total FROM knowledge_inferences").get().total,
  by_rule: db.prepare(`
    SELECT rule, COUNT(*) total, ROUND(AVG(confidence),2) avg_confidence
    FROM semantic_inference_log
    GROUP BY rule
    ORDER BY total DESC
  `).all(),
  samples: db.prepare(`
    SELECT rule, subject_a, bridge_b, object_c, confidence
    FROM semantic_inference_log
    ORDER BY created_at DESC
    LIMIT 20
  `).all()
}, null, 2));

db.close();
