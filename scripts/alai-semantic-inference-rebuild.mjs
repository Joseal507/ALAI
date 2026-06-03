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

const rules = {
  depends_on: {
    result: 'indirectly_depends_on',
    text: (a, b, c) => `${a} depende indirectamente de ${c} porque depende de ${b}, y ${b} también depende de ${c}.`
  },
  part_of: {
    result: 'contributes_to',
    text: (a, b, c) => `${a} contribuye a ${c} porque forma parte de ${b}, y ${b} forma parte de ${c}.`
  },
  prerequisite_of: {
    result: 'indirect_prerequisite_of',
    text: (a, b, c) => `${a} es prerequisito indirecto de ${c} porque prepara para ${b}, y ${b} prepara para ${c}.`
  },
  causes: {
    result: 'may_cause',
    text: (a, b, c) => `${a} puede causar indirectamente ${c} porque causa ${b}, y ${b} causa ${c}.`
  },
  includes: {
    result: 'contains_nested_concept',
    text: (a, b, c) => `${a} contiene indirectamente ${c} porque incluye ${b}, y ${b} incluye ${c}.`
  }
};

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

const structured = db.prepare(`
SELECT id, title, subject, predicate, object, confidence
FROM knowledge_claims
WHERE predicate IN ('depends_on','part_of','prerequisite_of','causes','includes')
`).all();

let inserted = 0;
let skipped = 0;

const byPredicate = new Map();

for (const c of structured) {
  const p = c.predicate;
  if (!byPredicate.has(p)) byPredicate.set(p, []);
  byPredicate.get(p).push({
    ...c,
    s: norm(c.subject),
    o: norm(c.object)
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

for (const [predicate, claims] of byPredicate.entries()) {
  const rule = rules[predicate];
  if (!rule) continue;

  for (const a of claims) {
    for (const b of claims) {
      if (a.id === b.id) continue;
      if (!a.o || !b.s) continue;
      if (a.o !== b.s) continue;
      if (a.s === b.o) {
        skipped++;
        continue;
      }

      const confidence = Math.min(95, Math.round((Number(a.confidence || 70) + Number(b.confidence || 70)) / 2));
      const inference = rule.text(a.s, a.o, b.o);
      const id = `sem_${safe(predicate)}_${safe(a.s)}_${safe(a.o)}_${safe(b.o)}`;

      insertInference.run({
        id,
        claim_a: a.id,
        claim_b: b.id,
        subject: a.s,
        inference,
        confidence,
        now
      });

      insertLog.run({
        id,
        rule: rule.result,
        a: a.s,
        b: a.o,
        c: b.o,
        inference,
        confidence,
        now
      });

      inserted++;
    }
  }
}

// Also infer from knowledge_relationships because they are cleaner than old claim text.
const rels = db.prepare(`
SELECT source_name, target_name, relation_type, confidence
FROM knowledge_relationships
WHERE relation_type IN ('depends_on','prerequisite_of','specialization_of','application_of')
`).all();

const relClaims = rels.map((r, idx) => ({
  id: `rel_${idx}_${safe(r.source_name)}_${safe(r.relation_type)}_${safe(r.target_name)}`,
  s: norm(r.source_name),
  o: norm(r.target_name),
  predicate: r.relation_type,
  confidence: Math.round(Number(r.confidence || 0.75) * 100)
}));

for (const type of ['depends_on', 'prerequisite_of']) {
  const claims = relClaims.filter(r => r.predicate === type);
  const rule = rules[type];
  if (!rule) continue;

  for (const a of claims) {
    for (const b of claims) {
      if (a.id === b.id) continue;
      if (a.o !== b.s) continue;
      if (a.s === b.o) continue;

      const confidence = Math.min(95, Math.round((a.confidence + b.confidence) / 2));
      const inference = rule.text(a.s, a.o, b.o);
      const id = `sem_rel_${safe(type)}_${safe(a.s)}_${safe(a.o)}_${safe(b.o)}`;

      insertInference.run({
        id,
        claim_a: a.id,
        claim_b: b.id,
        subject: a.s,
        inference,
        confidence,
        now
      });

      insertLog.run({
        id,
        rule: rule.result,
        a: a.s,
        b: a.o,
        c: b.o,
        inference,
        confidence,
        now
      });

      inserted++;
    }
  }
}

console.log(JSON.stringify({
  structured_claims_used: structured.length,
  semantic_inferences_attempted: inserted,
  skipped_cycles: skipped,
  semantic_log_total: db.prepare("SELECT COUNT(*) total FROM semantic_inference_log").get().total,
  total_inferences: db.prepare("SELECT COUNT(*) total FROM knowledge_inferences").get().total,
  samples: db.prepare(`
    SELECT rule, subject_a, bridge_b, object_c, confidence
    FROM semantic_inference_log
    ORDER BY created_at DESC
    LIMIT 20
  `).all()
}, null, 2));

db.close();
