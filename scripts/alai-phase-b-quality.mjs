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

CREATE TABLE IF NOT EXISTS knowledge_claims (
  id TEXT PRIMARY KEY,
  knowledge_id TEXT NOT NULL,
  claim TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'knowledge_unit',
  verification_status TEXT NOT NULL DEFAULT 'pending',
  confidence INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS claim_verifications (
  id TEXT PRIMARY KEY,
  claim_id TEXT NOT NULL,
  status TEXT NOT NULL,
  evidence TEXT NOT NULL DEFAULT '',
  score INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
`);

function slug(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 100);
}

function cleanConcept(raw) {
  let s = String(raw || '').trim();

  const target = s.match(/target=([^|]+)/i)?.[1];
  if (target) s = target.trim();

  s = s.replace(/^concepto:\s*/i, '');
  s = s.replace(/^concept:\s*/i, '');
  s = s.replace(/^nombre:\s*/i, '');
  s = s.split(/\s+(description|descripcion|relacion|relation|path|mastery_required|task):/i)[0].trim();
  s = s.split(/\s+\|\s+/)[0].trim();

  return s.replace(/\s+/g, ' ').replace(/^["'`]+|["'`]+$/g, '').slice(0, 160);
}

function asArray(text) {
  try {
    const x = JSON.parse(text || '[]');
    return Array.isArray(x) ? x : [];
  } catch {
    return [];
  }
}

const units = db.prepare(`
SELECT id, title, summary, explanation, examples, common_mistakes, related_concepts, confidence, stage
FROM knowledge_units
ORDER BY updated_at DESC
LIMIT 500
`).all();

const insertReview = db.prepare(`
INSERT OR REPLACE INTO knowledge_reviews
(id, knowledge_id, topic, critic_score, factual_errors, missing_concepts, unsupported_claims, approved, created_at, updated_at)
VALUES
(@id, @knowledge_id, @topic, @critic_score, @factual_errors, @missing_concepts, @unsupported_claims, @approved, @now, @now)
`);

const insertClaim = db.prepare(`
INSERT OR IGNORE INTO knowledge_claims
(id, knowledge_id, claim, source, verification_status, confidence, created_at, updated_at)
VALUES
(@id, @knowledge_id, @claim, 'knowledge_unit', 'pending', @confidence, @now, @now)
`);

let reviews = 0;
let claims = 0;
let normalizedRelations = 0;

for (const u of units) {
  const confidence = Number(u.confidence || 0);
  const summary = String(u.summary || '');
  const explanation = String(u.explanation || '');
  const examples = asArray(u.examples);
  const mistakes = asArray(u.common_mistakes);
  const related = asArray(u.related_concepts);

  const factualErrors = [];
  const missing = [];
  const unsupported = [];

  if (summary.length < 40) missing.push('summary_too_short');
  if (explanation.length < 80) missing.push('explanation_too_short');
  if (examples.length < 2) missing.push('not_enough_examples');
  if (mistakes.length < 2) missing.push('not_enough_common_mistakes');
  if (String(explanation).includes('[object Object]')) factualErrors.push('object_serialization_bug');

  const critic_score = Math.max(
    0,
    Math.min(
      100,
      confidence
      - factualErrors.length * 25
      - missing.length * 8
      - unsupported.length * 10
    )
  );

  insertReview.run({
    id: `review_${u.id}`,
    knowledge_id: u.id,
    topic: u.title,
    critic_score,
    factual_errors: JSON.stringify(factualErrors),
    missing_concepts: JSON.stringify(missing),
    unsupported_claims: JSON.stringify(unsupported),
    approved: critic_score >= 75 ? 1 : 0,
    now
  });
  reviews++;

  const candidateClaims = [
    summary,
    ...explanation.split(/[.!?]\s+/).slice(0, 4)
  ]
    .map(x => String(x || '').trim())
    .filter(x => x.length >= 40 && x.length <= 280)
    .slice(0, 5);

  for (const claim of candidateClaims) {
    insertClaim.run({
      id: `claim_${u.id}_${slug(claim)}`,
      knowledge_id: u.id,
      claim,
      confidence,
      now
    });
    claims++;
  }

  const cleanedRelated = related
    .map(cleanConcept)
    .filter(Boolean)
    .filter(x => x.length > 1);

  if (cleanedRelated.length && JSON.stringify(cleanedRelated) !== u.related_concepts) {
    db.prepare(`
      UPDATE knowledge_units
      SET related_concepts=?,
          updated_at=?
      WHERE id=?
    `).run(JSON.stringify([...new Set(cleanedRelated)]), now, u.id);
    normalizedRelations++;
  }
}

db.prepare(`
UPDATE learning_jobs
SET topic = 'ALAI_LEARN_TOPIC | stage=' ||
  COALESCE(
    NULLIF(stage, 'UNKNOWN'),
    COALESCE((SELECT active_stage FROM education_control WHERE id='main'), 'MEDIA')
  )
  || ' | target=' ||
  TRIM(
    REPLACE(
      REPLACE(
        REPLACE(
          substr(topic, instr(topic, 'target=') + 7),
          'concept:', ''
        ),
        'concepto:', ''
      ),
      'nombre:', ''
    )
  )
  || ' | task=Learn this discovered child topic completely.'
WHERE status IN ('pending','failed')
  AND topic LIKE '%target=%'
  AND topic LIKE '%description:%'
`).run();

const summary = {
  reviews,
  claims_attempted: claims,
  review_rows: db.prepare("SELECT COUNT(*) total FROM knowledge_reviews").get().total,
  pending_claims: db.prepare("SELECT COUNT(*) total FROM knowledge_claims WHERE verification_status='pending'").get().total,
  approved_reviews: db.prepare("SELECT COUNT(*) total FROM knowledge_reviews WHERE approved=1").get().total,
  normalized_relations: normalizedRelations
};

console.log(JSON.stringify(summary, null, 2));
db.close();
