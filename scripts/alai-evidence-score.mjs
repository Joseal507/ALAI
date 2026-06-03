import Database from 'better-sqlite3';

const db = new Database('data/alai.db');
const now = Date.now();

db.exec(`
CREATE TABLE IF NOT EXISTS evidence_scores (
  id TEXT PRIMARY KEY,
  knowledge_id TEXT NOT NULL,
  title TEXT NOT NULL,
  claims_score INTEGER NOT NULL,
  verification_score INTEGER NOT NULL,
  entity_score INTEGER NOT NULL,
  graph_score INTEGER NOT NULL,
  inference_score INTEGER NOT NULL,
  source_score INTEGER NOT NULL,
  final_score INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
`);

const units = db.prepare(`
SELECT id, title, confidence
FROM knowledge_units
`).all();

const insert = db.prepare(`
INSERT OR REPLACE INTO evidence_scores
(id, knowledge_id, title, claims_score, verification_score, entity_score, graph_score, inference_score, source_score, final_score, created_at, updated_at)
VALUES
(@id, @knowledge_id, @title, @claims_score, @verification_score, @entity_score, @graph_score, @inference_score, @source_score, @final_score, @now, @now)
`);

let scored = 0;

for (const u of units) {
  const claims = db.prepare(`
    SELECT COUNT(*) total
    FROM knowledge_claims
    WHERE knowledge_id=?
  `).get(u.id).total;

  const verified = db.prepare(`
    SELECT COUNT(*) total
    FROM claim_verifications cv
    JOIN knowledge_claims kc ON kc.id=cv.claim_id
    WHERE kc.knowledge_id=?
      AND cv.verdict IN ('supported','weak','needs_review')
  `).get(u.id).total;

  const entities = db.prepare(`
    SELECT COUNT(*) total
    FROM knowledge_entities
    WHERE lower(name)=lower(?)
       OR lower(canonical_name)=lower(?)
  `).get(u.title, u.title).total;

  const edges = db.prepare(`
    SELECT COUNT(*) total
    FROM knowledge_edges
    WHERE lower(source)=lower(?)
       OR lower(target)=lower(?)
  `).get(u.title, u.title).total;

  const inferences = db.prepare(`
    SELECT COUNT(*) total
    FROM knowledge_inferences
    WHERE lower(subject)=lower(?)
  `).get(u.title).total;

  const sources = db.prepare(`
    SELECT COUNT(*) total
    FROM knowledge_sources
    WHERE lower(topic)=lower(?)
  `).get(u.title).total;

  const claims_score = Math.min(20, claims * 4);
  const verification_score = claims > 0 ? Math.round((verified / claims) * 25) : 0;
  const entity_score = Math.min(15, entities * 5);
  const graph_score = Math.min(15, edges * 3);
  const inference_score = Math.min(15, inferences * 3);
  const source_score = Math.min(10, sources * 5);

  const final_score = Math.max(0, Math.min(100,
    claims_score +
    verification_score +
    entity_score +
    graph_score +
    inference_score +
    source_score
  ));

  insert.run({
    id: `es_${u.id}`,
    knowledge_id: u.id,
    title: u.title,
    claims_score,
    verification_score,
    entity_score,
    graph_score,
    inference_score,
    source_score,
    final_score,
    now
  });

  scored++;
}

db.prepare(`
UPDATE knowledge_units
SET confidence = (
  SELECT MAX(knowledge_units.confidence, evidence_scores.final_score)
  FROM evidence_scores
  WHERE evidence_scores.knowledge_id = knowledge_units.id
)
WHERE id IN (
  SELECT knowledge_id
  FROM evidence_scores
  WHERE final_score > 0
)
`).run();

console.log(JSON.stringify({
  scored,
  avg_score: db.prepare("SELECT ROUND(AVG(final_score),2) v FROM evidence_scores").get().v,
  top: db.prepare(`
    SELECT title, final_score
    FROM evidence_scores
    ORDER BY final_score DESC
    LIMIT 10
  `).all(),
  weak: db.prepare(`
    SELECT title, final_score
    FROM evidence_scores
    ORDER BY final_score ASC
    LIMIT 10
  `).all()
}, null, 2));

db.close();
