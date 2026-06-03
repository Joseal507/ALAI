import Database from 'better-sqlite3';

const db = new Database('data/alai.db');
const now = Date.now();

function slug(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120);
}

db.exec(`
CREATE TABLE IF NOT EXISTS topic_evidence_aggregation (
  id TEXT PRIMARY KEY,
  topic TEXT NOT NULL,
  sources INTEGER NOT NULL,
  gold_sources INTEGER NOT NULL,
  silver_sources INTEGER NOT NULL,
  avg_source_score REAL NOT NULL,
  evidence_level TEXT NOT NULL,
  confidence_bonus INTEGER NOT NULL,
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
`);

const topics = db.prepare(`
SELECT
  ks.topic,
  COUNT(*) sources,
  SUM(CASE WHEN sr.tier='gold' THEN 1 ELSE 0 END) gold_sources,
  SUM(CASE WHEN sr.tier='silver' THEN 1 ELSE 0 END) silver_sources,
  ROUND(AVG(COALESCE(sr.score, ks.score)), 2) avg_score
FROM knowledge_sources ks
LEFT JOIN source_rankings sr ON sr.source_id = ks.id
GROUP BY ks.topic
`).all();

let aggregated = 0;
let upgradedKnowledge = 0;

for (const t of topics) {
  const sources = Number(t.sources || 0);
  const gold = Number(t.gold_sources || 0);
  const silver = Number(t.silver_sources || 0);
  const avg = Number(t.avg_score || 0);

  let level = 'weak';
  let bonus = 0;

  if (gold >= 2 && sources >= 3) {
    level = 'strong';
    bonus = 10;
  } else if (gold >= 1 && sources >= 2) {
    level = 'good';
    bonus = 7;
  } else if (silver >= 2 || avg >= 75) {
    level = 'moderate';
    bonus = 4;
  }

  db.prepare(`
    INSERT OR REPLACE INTO topic_evidence_aggregation
    (id, topic, sources, gold_sources, silver_sources, avg_source_score, evidence_level, confidence_bonus, reason, created_at, updated_at)
    VALUES
    (@id, @topic, @sources, @gold, @silver, @avg, @level, @bonus, @reason, @now, @now)
  `).run({
    id: `tea_${slug(t.topic)}`,
    topic: t.topic,
    sources,
    gold,
    silver,
    avg,
    level,
    bonus,
    reason: `sources=${sources}; gold=${gold}; silver=${silver}; avg=${avg}`,
    now
  });

  aggregated++;

  if (bonus > 0) {
    const row = db.prepare(`
      SELECT id
      FROM knowledge_units
      WHERE lower(title)=lower(?)
      ORDER BY updated_at DESC
      LIMIT 1
    `).get(t.topic);

    if (row) {
      db.prepare(`
        UPDATE knowledge_units
        SET confidence = MIN(98, confidence + ?),
            updated_at=?
        WHERE id=?
      `).run(bonus, now, row.id);
      upgradedKnowledge++;
    }
  }
}

console.log(JSON.stringify({
  aggregated_topics: aggregated,
  upgraded_knowledge_units: upgradedKnowledge,
  summary: db.prepare(`
    SELECT evidence_level, COUNT(*) total, ROUND(AVG(confidence_bonus),2) avg_bonus
    FROM topic_evidence_aggregation
    GROUP BY evidence_level
    ORDER BY avg_bonus DESC
  `).all(),
  top_evidence: db.prepare(`
    SELECT topic, sources, gold_sources, silver_sources, avg_source_score, evidence_level, confidence_bonus
    FROM topic_evidence_aggregation
    ORDER BY confidence_bonus DESC, avg_source_score DESC
    LIMIT 20
  `).all()
}, null, 2));

db.close();
