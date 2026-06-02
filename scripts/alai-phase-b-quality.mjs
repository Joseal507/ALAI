import Database from 'better-sqlite3';

const db = new Database('data/alai.db');
const now = Date.now();

db.exec(`
CREATE TABLE IF NOT EXISTS knowledge_reviews (
  id TEXT PRIMARY KEY,
  knowledge_id TEXT NOT NULL,
  topic TEXT NOT NULL,
  critic_score INTEGER NOT NULL DEFAULT 0,
  factual_errors TEXT NOT NULL DEFAULT '[]',
  missing_concepts TEXT NOT NULL DEFAULT '[]',
  unsupported_claims TEXT NOT NULL DEFAULT '[]',
  approved INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
`);

function cleanText(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

function slug(s) {
  return cleanText(s)
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 90);
}

function arr(value) {
  try {
    const x = JSON.parse(String(value || '[]'));
    return Array.isArray(x) ? x.map(String) : [];
  } catch {
    return [];
  }
}

function cleanConcept(raw) {
  let x = cleanText(raw);
  x = x.replace(/^concepto:\s*/i, '');
  x = x.replace(/^concept:\s*/i, '');
  x = x.replace(/^nombre:\s*/i, '');
  x = x.split(/\s+(description|descripcion|relation|relacion|path|mastery_required|task):/i)[0].trim();
  return x.slice(0, 160);
}

const units = db.prepare(`
SELECT id, title, summary, explanation, examples, common_mistakes, related_concepts, confidence
FROM knowledge_units
ORDER BY updated_at DESC
LIMIT 1000
`).all();

const insertReview = db.prepare(`
INSERT OR REPLACE INTO knowledge_reviews
(id, knowledge_id, topic, critic_score, factual_errors, missing_concepts, unsupported_claims, approved, created_at, updated_at)
VALUES
(@id, @knowledge_id, @topic, @critic_score, @factual_errors, @missing_concepts, @unsupported_claims, @approved, @now, @now)
`);

const insertClaim = db.prepare(`
INSERT OR IGNORE INTO knowledge_claims
(id, knowledge_id, title, subject, predicate, object, confidence, created_at, updated_at)
VALUES
(@id, @knowledge_id, @title, @subject, @predicate, @object, @confidence, @now, @now)
`);

let reviews = 0;
let claims = 0;
let normalizedRelations = 0;

for (const u of units) {
  const examples = arr(u.examples);
  const mistakes = arr(u.common_mistakes);
  const related = arr(u.related_concepts);

  const factual = [];
  const missing = [];
  const unsupported = [];

  if (cleanText(u.summary).length < 40) missing.push('summary_too_short');
  if (cleanText(u.explanation).length < 80) missing.push('explanation_too_short');
  if (examples.length < 2) missing.push('not_enough_examples');
  if (mistakes.length < 2) missing.push('not_enough_common_mistakes');
  if (String(u.explanation).includes('[object Object]')) factual.push('object_serialization_bug');

  const score = Math.max(0, Math.min(100, Number(u.confidence || 60) - factual.length * 25 - missing.length * 8 - unsupported.length * 10));

  insertReview.run({
    id: `review_${u.id}`,
    knowledge_id: u.id,
    topic: u.title,
    critic_score: score,
    factual_errors: JSON.stringify(factual),
    missing_concepts: JSON.stringify(missing),
    unsupported_claims: JSON.stringify(unsupported),
    approved: score >= 75 ? 1 : 0,
    now
  });
  reviews++;

  const subject = cleanText(u.title);
  const sentences = cleanText(`${u.summary}. ${u.explanation}`).split(/[.!?]\s+/).filter(x => x.length >= 40).slice(0, 5);

  for (const sentence of sentences) {
    insertClaim.run({
      id: `claim_${u.id}_${slug(sentence)}`,
      knowledge_id: u.id,
      title: subject,
      subject,
      predicate: 'states',
      object: sentence.slice(0, 240),
      confidence: Number(u.confidence || 60),
      now
    });
    claims++;
  }

  const cleaned = [...new Set(related.map(cleanConcept).filter(Boolean))];

  if (cleaned.length && JSON.stringify(cleaned) !== String(u.related_concepts || '[]')) {
    db.prepare(`
      UPDATE knowledge_units
      SET related_concepts=?,
          updated_at=?
      WHERE id=?
    `).run(JSON.stringify(cleaned), now, u.id);
    normalizedRelations++;
  }
}

db.prepare(`
UPDATE learning_jobs
SET priority=50000
WHERE status='pending'
  AND topic LIKE 'ALAI_LEARN_TOPIC%'
  AND topic NOT LIKE '%path=%'
`).run();

db.prepare(`
UPDATE learning_jobs
SET status='archived',
    priority=0
WHERE status='pending'
  AND stage='UNKNOWN'
  AND topic NOT LIKE '%stage=UNIVERSIDAD%'
`).run();

console.log(JSON.stringify({
  reviews,
  claims_attempted: claims,
  normalized_relations: normalizedRelations,
  review_rows: db.prepare("SELECT COUNT(*) total FROM knowledge_reviews").get().total,
  claims_total: db.prepare("SELECT COUNT(*) total FROM knowledge_claims").get().total,
  approved_reviews: db.prepare("SELECT COUNT(*) total FROM knowledge_reviews WHERE approved=1").get().total
}, null, 2));

db.close();
