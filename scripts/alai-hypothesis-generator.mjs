import Database from 'better-sqlite3';

const db = new Database('data/alai.db');
const now = Date.now();

function safe(s='') {
  return String(s)
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 160);
}

function norm(s='') {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9ñ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

db.exec(`
CREATE TABLE IF NOT EXISTS knowledge_hypotheses (
  id TEXT PRIMARY KEY,
  topic TEXT NOT NULL,
  hypothesis TEXT NOT NULL,
  support_a TEXT NOT NULL,
  support_b TEXT NOT NULL,
  confidence INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'needs_verification',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
`);

const rels = db.prepare(`
SELECT source_title, target_title, relationship, confidence
FROM knowledge_relationships
WHERE relationship IN ('depends_on','prerequisite_of','application_of','specialization_of','example_of')
`).all();

const bySource = new Map();

for (const r of rels) {
  const s = norm(r.source_title);
  if (!s) continue;
  if (!bySource.has(s)) bySource.set(s, []);
  bySource.get(s).push(r);
}

let attempted = 0;

for (const [source, items] of bySource.entries()) {
  if (items.length < 2) continue;

  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i];
      const b = items[j];

      if (norm(a.target_title) === norm(b.target_title)) continue;

      const confidence = Math.min(88, Math.round(((Number(a.confidence || 0.75) + Number(b.confidence || 0.75)) / 2) * 100));

      let hypothesis = '';
      if (a.relationship === b.relationship) {
        hypothesis = `Si ${a.source_title} se relaciona con ${a.target_title} y también con ${b.target_title} mediante ${a.relationship}, entonces puede existir una relación conceptual entre ${a.target_title} y ${b.target_title}.`;
      } else {
        hypothesis = `Si ${a.source_title} tiene relación ${a.relationship} con ${a.target_title} y relación ${b.relationship} con ${b.target_title}, entonces ${a.target_title} y ${b.target_title} podrían interactuar dentro del mismo marco conceptual.`;
      }

      db.prepare(`
        INSERT OR IGNORE INTO knowledge_hypotheses
        (id, topic, hypothesis, support_a, support_b, confidence, status, created_at, updated_at)
        VALUES
        (@id, @topic, @hypothesis, @support_a, @support_b, @confidence, 'needs_verification', @now, @now)
      `).run({
        id: `hyp_${safe(source)}_${safe(a.target_title)}_${safe(b.target_title)}`,
        topic: a.source_title,
        hypothesis,
        support_a: `${a.source_title} --${a.relationship}--> ${a.target_title}`,
        support_b: `${b.source_title} --${b.relationship}--> ${b.target_title}`,
        confidence,
        now
      });

      attempted++;
    }
  }
}

console.log(JSON.stringify({
  hypotheses_attempted: attempted,
  hypotheses_total: db.prepare("SELECT COUNT(*) total FROM knowledge_hypotheses").get().total,
  samples: db.prepare(`
    SELECT topic, hypothesis, confidence, status
    FROM knowledge_hypotheses
    ORDER BY confidence DESC
    LIMIT 15
  `).all()
}, null, 2));

db.close();
