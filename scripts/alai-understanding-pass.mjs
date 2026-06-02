import Database from 'better-sqlite3';

const db = new Database('data/alai.db');
const now = Date.now();

function clean(s) {
  return String(s || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function canonical(s) {
  return clean(s)
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 100);
}

function splitTerms(text) {
  const raw = clean(text)
    .split(/[,;:.()|/]+|\s+y\s+|\s+e\s+|\s+de\s+/i)
    .map(x => clean(x))
    .filter(x => x.length >= 4 && x.length <= 80);

  return [...new Set(raw)];
}

const insertEntity = db.prepare(`
INSERT OR IGNORE INTO knowledge_entities
(id, name, canonical_name, entity_type, confidence, created_at, updated_at)
VALUES
(@id, @name, @canonical_name, 'concept', @confidence, @now, @now)
`);

const insertVerification = db.prepare(`
INSERT OR IGNORE INTO claim_verifications
(id, claim_id, verdict, reason, confidence_delta, provider, model, created_at)
VALUES
(@id, @claim_id, @verdict, @reason, @confidence_delta, 'alai_local_verifier', 'heuristic-v1', @now)
`);

const insertQuality = db.prepare(`
INSERT OR REPLACE INTO learning_quality
(id, knowledge_id, title, claims, verified, inferences, conflicts, confidence, score, created_at, updated_at)
VALUES
(@id, @knowledge_id, @title, @claims, @verified, @inferences, @conflicts, @confidence, @score, @now, @now)
`);

const insertConflict = db.prepare(`
INSERT OR IGNORE INTO knowledge_conflicts
(id, knowledge_a, knowledge_b, title_a, title_b, reason, status, created_at, updated_at)
VALUES
(@id, @knowledge_a, @knowledge_b, @title_a, @title_b, @reason, 'open', @now, @now)
`);

const units = db.prepare(`
SELECT id, title, summary, explanation, examples, common_mistakes, related_concepts, confidence
FROM knowledge_units
`).all();

let entities = 0;
let verifications = 0;
let qualityRows = 0;
let conflicts = 0;

for (const u of units) {
  const title = clean(u.title);
  const confidence = Number(u.confidence || 60);

  const terms = [
    title,
    ...splitTerms(u.summary),
    ...splitTerms(u.related_concepts)
  ]
    .map(clean)
    .filter(Boolean)
    .filter(x => !/^\d+$/.test(x))
    .slice(0, 20);

  for (const t of [...new Set(terms)]) {
    const c = canonical(t);
    if (!c || c.length < 3) continue;

    insertEntity.run({
      id: `ent_${c}`,
      name: t.slice(0, 120),
      canonical_name: c,
      confidence: Math.min(0.99, Math.max(0.5, confidence / 100)),
      now
    });
    entities++;
  }
}

const claims = db.prepare(`
SELECT id, knowledge_id, title, subject, predicate, object, confidence
FROM knowledge_claims
`).all();

for (const c of claims) {
  const text = clean(`${c.subject} ${c.predicate} ${c.object}`);
  const confidence = Number(c.confidence || 60);

  let verdict = 'supported';
  let reason = 'Heuristic verification: claim has sufficient structure and comes from an accepted knowledge unit.';
  let delta = 0;

  if (text.length < 40) {
    verdict = 'weak';
    reason = 'Claim is too short to verify strongly.';
    delta = -5;
  }

  if (/\[object Object\]/i.test(text)) {
    verdict = 'rejected';
    reason = 'Claim contains serialized object corruption.';
    delta = -25;
  }

  if (/always|never|todos|nunca|imposible|garantiza/i.test(text)) {
    verdict = 'needs_review';
    reason = 'Claim uses absolute language and should be verified with external sources.';
    delta = -10;
  }

  insertVerification.run({
    id: `ver_${c.id}`,
    claim_id: c.id,
    verdict,
    reason,
    confidence_delta: delta,
    now
  });
  verifications++;
}


const claimRowsForInference = db.prepare(`
SELECT id, knowledge_id, subject, predicate, object, confidence
FROM knowledge_claims
ORDER BY updated_at DESC
LIMIT 300
`).all();

const insertInference = db.prepare(`
INSERT OR IGNORE INTO knowledge_inferences
(id, claim_a, claim_b, subject, inference, confidence, created_at, updated_at)
VALUES
(@id, @claim_a, @claim_b, @subject, @inference, @confidence, @now, @now)
`);

for (let i = 0; i < claimRowsForInference.length; i++) {
  for (let j = i + 1; j < Math.min(claimRowsForInference.length, i + 25); j++) {
    const a = claimRowsForInference[i];
    const b = claimRowsForInference[j];

    if (canonical(a.subject) !== canonical(b.subject)) continue;
    if (a.id === b.id) continue;

    const inf = `${a.subject} conecta "${clean(a.object).slice(0, 90)}" con "${clean(b.object).slice(0, 90)}".`;

    insertInference.run({
      id: `inf_${canonical(a.id)}_${canonical(b.id)}`,
      claim_a: a.id,
      claim_b: b.id,
      subject: a.subject,
      inference: inf,
      confidence: Math.min(Number(a.confidence || 60), Number(b.confidence || 60)),
      now
    });
  }
}

const qualityUnits = db.prepare(`
SELECT
  ku.id,
  ku.title,
  ku.confidence,
  COUNT(DISTINCT kc.id) AS claims,
  COUNT(DISTINCT cv.id) AS verified,
  COUNT(DISTINCT kf.id) AS conflicts
FROM knowledge_units ku
LEFT JOIN knowledge_claims kc ON kc.knowledge_id = ku.id
LEFT JOIN claim_verifications cv ON cv.claim_id = kc.id AND cv.verdict IN ('supported','needs_review','weak')
LEFT JOIN knowledge_conflicts kf ON kf.knowledge_a = ku.id OR kf.knowledge_b = ku.id
GROUP BY ku.id
`).all();

const inferenceCountBySubject = new Map();
const infRows = db.prepare(`
SELECT subject, COUNT(*) total
FROM knowledge_inferences
GROUP BY subject
`).all();

for (const r of infRows) {
  inferenceCountBySubject.set(canonical(r.subject), Number(r.total || 0));
}

for (const q of qualityUnits) {
  const confidence = Number(q.confidence || 60);
  const claimScore = Math.min(20, Number(q.claims || 0) * 4);
  const verifyScore = Math.min(25, Number(q.verified || 0) * 5);
  const inferenceScore = Math.min(10, (inferenceCountBySubject.get(canonical(q.title)) || 0) * 2);
  const conflictPenalty = Math.min(30, Number(q.conflicts || 0) * 10);

  const score = Math.max(0, Math.min(100,
    Math.round(confidence * 0.45 + claimScore + verifyScore + inferenceScore - conflictPenalty)
  ));

  insertQuality.run({
    id: `lq_${q.id}`,
    knowledge_id: q.id,
    title: q.title,
    claims: Number(q.claims || 0),
    verified: Number(q.verified || 0),
    inferences: inferenceCountBySubject.get(canonical(q.title)) || 0,
    conflicts: Number(q.conflicts || 0),
    confidence,
    score,
    now
  });
  qualityRows++;
}

const allUnits = db.prepare(`
SELECT id, title, summary
FROM knowledge_units
`).all();

for (let i = 0; i < allUnits.length; i++) {
  for (let j = i + 1; j < Math.min(allUnits.length, i + 40); j++) {
    const a = allUnits[i];
    const b = allUnits[j];

    const ta = canonical(a.title);
    const tb = canonical(b.title);

    if (!ta || !tb || ta === tb) continue;

    const text = `${a.summary} ${b.summary}`.toLowerCase();

    if (
      text.includes('no es') &&
      text.includes('es ') &&
      ta.split('_')[0] === tb.split('_')[0]
    ) {
      insertConflict.run({
        id: `conf_${canonical(a.id)}_${canonical(b.id)}`,
        knowledge_a: a.id,
        knowledge_b: b.id,
        title_a: a.title,
        title_b: b.title,
        reason: 'Potential contradiction detected by heuristic pattern.',
        now
      });
      conflicts++;
    }
  }
}

console.log(JSON.stringify({
  entities_attempted: entities,
  entities_total: db.prepare("SELECT COUNT(*) total FROM knowledge_entities").get().total,
  verifications_attempted: verifications,
  verifications_total: db.prepare("SELECT COUNT(*) total FROM claim_verifications").get().total,
  inferences_total: db.prepare("SELECT COUNT(*) total FROM knowledge_inferences").get().total,
  quality_rows: qualityRows,
  conflicts_attempted: conflicts,
  conflicts_total: db.prepare("SELECT COUNT(*) total FROM knowledge_conflicts").get().total
}, null, 2));

db.close();
