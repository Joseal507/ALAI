import Database from 'better-sqlite3';

const db = new Database('data/alai.db');
const now = Date.now();

function classifySource(sourceType = '', url = '', title = '') {
  const s = `${sourceType} ${url} ${title}`.toLowerCase();

  if (s.includes('openstax')) return { tier: 'gold', score: 96, reason: 'OpenStax educational textbook source' };
  if (s.includes('mit.edu') || s.includes('ocw.mit')) return { tier: 'gold', score: 95, reason: 'MIT/OpenCourseWare academic source' };
  if (s.includes('khanacademy')) return { tier: 'gold', score: 92, reason: 'Khan Academy educational source' };
  if (s.includes('britannica')) return { tier: 'gold', score: 90, reason: 'Britannica editorial reference source' };
  if (s.includes('arxiv')) return { tier: 'research', score: 88, reason: 'Research preprint source' };
  if (s.includes('wikipedia')) return { tier: 'silver', score: 80, reason: 'Wikipedia overview source' };
  if (s.includes('open_library') || s.includes('openlibrary')) return { tier: 'silver', score: 72, reason: 'Open Library bibliographic/book source' };
  if (s.includes('.edu')) return { tier: 'academic', score: 86, reason: 'Educational domain source' };
  if (s.includes('.gov')) return { tier: 'official', score: 86, reason: 'Government/official source' };
  if (s.includes('youtube')) return { tier: 'media', score: 55, reason: 'Video source requires extra verification' };
  if (s.includes('blog') || s.includes('medium.com')) return { tier: 'low', score: 35, reason: 'Blog/opinion source' };

  return { tier: 'unknown', score: 50, reason: 'Unknown source quality' };
}

db.exec(`
CREATE TABLE IF NOT EXISTS source_rankings (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  topic TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_url TEXT,
  source_title TEXT,
  tier TEXT NOT NULL,
  score INTEGER NOT NULL,
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_source_rankings_topic ON source_rankings(topic);
CREATE INDEX IF NOT EXISTS idx_source_rankings_score ON source_rankings(score);
`);

const cols = db.prepare("PRAGMA table_info(knowledge_sources)").all().map(c => c.name);

const idCol = cols.includes('id') ? 'id' : 'rowid';
const topicCol = cols.includes('topic') ? 'topic' : "''";
const typeCol = cols.includes('source_type') ? 'source_type' : "''";
const urlCol = cols.includes('url') ? 'url' : cols.includes('source_url') ? 'source_url' : "''";
const titleCol = cols.includes('title') ? 'title' : cols.includes('source_title') ? 'source_title' : "''";

const rows = db.prepare(`
SELECT
  ${idCol} AS id,
  ${topicCol} AS topic,
  ${typeCol} AS source_type,
  ${urlCol} AS source_url,
  ${titleCol} AS source_title
FROM knowledge_sources
`).all();

let ranked = 0;

const insert = db.prepare(`
INSERT OR REPLACE INTO source_rankings
(id, source_id, topic, source_type, source_url, source_title, tier, score, reason, created_at, updated_at)
VALUES
(@id, @source_id, @topic, @source_type, @source_url, @source_title, @tier, @score, @reason, @now, @now)
`);

for (const r of rows) {
  const rank = classifySource(r.source_type, r.source_url, r.source_title);

  insert.run({
    id: `sr_${r.id}`,
    source_id: String(r.id),
    topic: r.topic || '',
    source_type: r.source_type || '',
    source_url: r.source_url || '',
    source_title: r.source_title || '',
    tier: rank.tier,
    score: rank.score,
    reason: rank.reason,
    now
  });

  ranked++;
}

// Update knowledge_sources.score if column exists
if (cols.includes('score')) {
  db.prepare(`
    UPDATE knowledge_sources
    SET score = (
      SELECT source_rankings.score
      FROM source_rankings
      WHERE source_rankings.source_id = knowledge_sources.id
      LIMIT 1
    )
    WHERE id IN (
      SELECT source_id FROM source_rankings
    )
  `).run();
}

console.log(JSON.stringify({
  ranked,
  source_summary: db.prepare(`
    SELECT tier, ROUND(AVG(score),2) avg_score, COUNT(*) total
    FROM source_rankings
    GROUP BY tier
    ORDER BY avg_score DESC
  `).all(),
  top_sources: db.prepare(`
    SELECT topic, source_type, tier, score, reason
    FROM source_rankings
    ORDER BY score DESC
    LIMIT 20
  `).all(),
  weak_sources: db.prepare(`
    SELECT topic, source_type, tier, score, reason
    FROM source_rankings
    ORDER BY score ASC
    LIMIT 20
  `).all()
}, null, 2));

db.close();
