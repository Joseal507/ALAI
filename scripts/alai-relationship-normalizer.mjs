import Database from 'better-sqlite3';

const db = new Database('data/alai.db');
const now = Date.now();

function extractTitle(raw='') {
  let s = String(raw || '').trim();

  const concept = s.match(/concepto?:\s*([^;\n]+)|concept:\s*([^;\n]+)/i);
  if (concept) s = (concept[1] || concept[2] || s).trim();

  s = s.split(/relacion:|relation:|description:|descripcion:/i)[0].trim();
  s = s.replace(/^concepto?:\s*/i, '');
  s = s.replace(/^concept:\s*/i, '');
  s = s.replace(/\s+/g, ' ').trim();

  return s.slice(0, 140);
}

function bad(s='') {
  const t = String(s || '').toLowerCase();
  return !t || t.includes('alai_') || t.includes('stage=') || t.includes('path=') || t.includes('task=');
}

db.exec(`
CREATE TABLE IF NOT EXISTS relationship_normalization_log (
  id TEXT PRIMARY KEY,
  relationship_id TEXT NOT NULL,
  action TEXT NOT NULL,
  before_source TEXT NOT NULL,
  after_source TEXT NOT NULL,
  before_target TEXT NOT NULL,
  after_target TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
`);

const rows = db.prepare(`
SELECT id, source_title, target_title
FROM knowledge_relationships
`).all();

let normalized = 0;
let archived = 0;

for (const r of rows) {
  const source = extractTitle(r.source_title);
  const target = extractTitle(r.target_title);

  if (bad(source) || bad(target)) {
    db.prepare(`DELETE FROM knowledge_relationships WHERE id=?`).run(r.id);
    archived++;
    continue;
  }

  if (source !== r.source_title || target !== r.target_title) {
    db.prepare(`
      UPDATE knowledge_relationships
      SET source_title=?,
          target_title=?,
          updated_at=?
      WHERE id=?
    `).run(source, target, now, r.id);

    db.prepare(`
      INSERT OR REPLACE INTO relationship_normalization_log
      (id, relationship_id, action, before_source, after_source, before_target, after_target, reason, created_at)
      VALUES
      (@id, @rid, 'normalized', @bs, @as, @bt, @at, @reason, @now)
    `).run({
      id: `rnl_${r.id}`,
      rid: r.id,
      bs: r.source_title,
      as: source,
      bt: r.target_title,
      at: target,
      reason: 'cleaned concept/relation wrapper from relationship titles',
      now
    });

    normalized++;
  }
}

console.log(JSON.stringify({
  relationships_scanned: rows.length,
  relationships_normalized: normalized,
  relationships_deleted_bad: archived,
  relationship_summary: db.prepare(`
    SELECT relationship, COUNT(*) total
    FROM knowledge_relationships
    GROUP BY relationship
    ORDER BY total DESC
  `).all()
}, null, 2));

db.close();
