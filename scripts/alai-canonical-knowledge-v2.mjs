import Database from 'better-sqlite3';

const db = new Database('data/alai.db');
const now = Date.now();

function safe(s = '') {
  return String(s)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 160);
}

function cleanText(s = '') {
  return String(s || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractCanonical(raw = '') {
  const s = cleanText(raw);

  const patterns = [
    /(?:^|\s)concepto?:\s*([^:;]+?)(?:\s+description:|\s+descripcion:|\s+relation:|\s+relacion:|;|$)/i,
    /(?:^|\s)nombre:\s*([^:;]+?)(?:\s+description:|\s+descripcion:|\s+relation:|\s+relacion:|;|$)/i,
    /^([^:;]+?)\s+descripcion:/i,
    /^([^:;]+?)\s+description:/i
  ];

  for (const p of patterns) {
    const m = s.match(p);
    if (m?.[1]) return cleanText(m[1]).slice(0, 140);
  }

  return s.slice(0, 140);
}

function extractField(raw = '', names = []) {
  const s = cleanText(raw);
  for (const name of names) {
    const re = new RegExp(`${name}:\\s*([^:;]+?)(?=\\s+(?:concept|concepto|nombre|description|descripcion|relation|relacion):|;|$)`, 'i');
    const m = s.match(re);
    if (m?.[1]) return cleanText(m[1]).slice(0, 500);
  }
  return '';
}

function isBadPacked(raw = '') {
  const t = String(raw || '').toLowerCase();
  return (
    t.includes('concept:') ||
    t.includes('concepto:') ||
    t.includes('nombre:') ||
    t.includes('description:') ||
    t.includes('descripcion:') ||
    t.includes('relation:') ||
    t.includes('relacion:')
  );
}

db.exec(`
CREATE TABLE IF NOT EXISTS canonical_knowledge_v2_log (
  id TEXT PRIMARY KEY,
  knowledge_id TEXT NOT NULL,
  before_title TEXT NOT NULL,
  after_title TEXT NOT NULL,
  extracted_description TEXT,
  extracted_relation TEXT,
  action TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
`);

const units = db.prepare(`
SELECT id, title, confidence
FROM knowledge_units
WHERE title LIKE '%concept:%'
   OR title LIKE '%concepto:%'
   OR title LIKE '%nombre:%'
   OR title LIKE '%description:%'
   OR title LIKE '%descripcion:%'
   OR title LIKE '%relation:%'
   OR title LIKE '%relacion:%'
`).all();

let scanned = units.length;
let renamed = 0;
let merged = 0;
let claimsCreated = 0;
let relationshipsCreated = 0;

for (const u of units) {
  const before = u.title;
  const canonical = extractCanonical(before);
  const description = extractField(before, ['description', 'descripcion']);
  const relation = extractField(before, ['relation', 'relacion']);

  if (!canonical || canonical.length < 2 || canonical === before) continue;

  const existing = db.prepare(`
    SELECT id, title, confidence
    FROM knowledge_units
    WHERE lower(title)=lower(?)
      AND id != ?
    LIMIT 1
  `).get(canonical, u.id);

  if (existing) {
    db.prepare(`
      UPDATE knowledge_units
      SET confidence=MAX(confidence, ?),
          updated_at=?
      WHERE id=?
    `).run(Number(u.confidence || 60), now, existing.id);

    db.prepare(`
      UPDATE knowledge_claims
      SET knowledge_id=?,
          title=?,
          subject=CASE WHEN lower(subject)=lower(?) THEN ? ELSE subject END,
          canonical_subject=?
      WHERE knowledge_id=?
    `).run(existing.id, existing.title, before, existing.title, existing.title.toLowerCase(), u.id);

    db.prepare(`
      UPDATE knowledge_entities
      SET knowledge_id=?
      WHERE knowledge_id=?
    `).run(existing.id, u.id);

    db.prepare(`
      UPDATE semantic_memory
      SET knowledge_id=?,
          title=?
      WHERE knowledge_id=?
    `).run(existing.id, existing.title, u.id);

    db.prepare(`
      DELETE FROM knowledge_units
      WHERE id=?
    `).run(u.id);

    db.prepare(`
      INSERT OR REPLACE INTO canonical_knowledge_v2_log
      (id, knowledge_id, before_title, after_title, extracted_description, extracted_relation, action, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'merged_into_existing', ?)
    `).run(`ckv2_${safe(u.id)}`, existing.id, before, existing.title, description, relation, now);

    merged++;
  } else {
    db.prepare(`
      UPDATE knowledge_units
      SET title=?,
          updated_at=?
      WHERE id=?
    `).run(canonical, now, u.id);

    db.prepare(`
      UPDATE knowledge_claims
      SET title=?,
          subject=CASE WHEN lower(subject)=lower(?) THEN ? ELSE subject END,
          canonical_subject=?
      WHERE knowledge_id=?
    `).run(canonical, before, canonical.toLowerCase(), canonical.toLowerCase(), u.id);

    db.prepare(`
      UPDATE semantic_memory
      SET title=?
      WHERE knowledge_id=?
    `).run(canonical, u.id);

    db.prepare(`
      INSERT OR REPLACE INTO canonical_knowledge_v2_log
      (id, knowledge_id, before_title, after_title, extracted_description, extracted_relation, action, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'renamed', ?)
    `).run(`ckv2_${safe(u.id)}`, u.id, before, canonical, description, relation, now);

    renamed++;
  }

  const targetId = existing?.id || u.id;
  const targetTitle = existing?.title || canonical;

  if (description) {
    db.prepare(`
      INSERT OR IGNORE INTO knowledge_claims
      (id, knowledge_id, title, subject, predicate, object, confidence, created_at, updated_at, entity_type, canonical_subject)
      VALUES
      (?, ?, ?, ?, 'states', ?, ?, ?, ?, 'canonical_description', ?)
    `).run(
      `claim_desc_${safe(targetTitle)}`,
      targetId,
      targetTitle,
      targetTitle.toLowerCase(),
      description,
      Math.max(70, Number(u.confidence || 60)),
      now,
      now,
      targetTitle.toLowerCase()
    );
    claimsCreated++;
  }

  if (relation) {
    db.prepare(`
      INSERT OR IGNORE INTO knowledge_claims
      (id, knowledge_id, title, subject, predicate, object, confidence, created_at, updated_at, entity_type, canonical_subject)
      VALUES
      (?, ?, ?, ?, 'related_context', ?, ?, ?, ?, 'canonical_relation', ?)
    `).run(
      `claim_rel_${safe(targetTitle)}`,
      targetId,
      targetTitle,
      targetTitle.toLowerCase(),
      relation,
      Math.max(70, Number(u.confidence || 60)),
      now,
      now,
      targetTitle.toLowerCase()
    );
    claimsCreated++;

    db.prepare(`
      INSERT OR IGNORE INTO knowledge_relationships
      (id, source_title, target_title, relationship, confidence, reason, created_at, updated_at)
      VALUES
      (?, ?, ?, 'related_to', ?, ?, ?, ?)
    `).run(
      `rel_context_${safe(targetTitle)}`,
      targetTitle,
      'Contexto relacionado',
      0.72,
      relation,
      now,
      now
    );
    relationshipsCreated++;
  }
}

// Clean relationships whose titles are still packed.
const rels = db.prepare(`
SELECT id, source_title, target_title
FROM knowledge_relationships
WHERE source_title LIKE '%concept:%'
   OR source_title LIKE '%concepto:%'
   OR source_title LIKE '%nombre:%'
   OR source_title LIKE '%description:%'
   OR source_title LIKE '%descripcion:%'
   OR source_title LIKE '%relation:%'
   OR source_title LIKE '%relacion:%'
   OR target_title LIKE '%concept:%'
   OR target_title LIKE '%concepto:%'
   OR target_title LIKE '%nombre:%'
   OR target_title LIKE '%description:%'
   OR target_title LIKE '%descripcion:%'
   OR target_title LIKE '%relation:%'
   OR target_title LIKE '%relacion:%'
`).all();

let relCleaned = 0;

for (const r of rels) {
  const source = isBadPacked(r.source_title) ? extractCanonical(r.source_title) : r.source_title;
  const target = isBadPacked(r.target_title) ? extractCanonical(r.target_title) : r.target_title;

  db.prepare(`
    UPDATE knowledge_relationships
    SET source_title=?,
        target_title=?,
        updated_at=?
    WHERE id=?
  `).run(source, target, now, r.id);

  relCleaned++;
}

console.log(JSON.stringify({
  packed_units_scanned: scanned,
  renamed,
  merged,
  description_relation_claims_created_attempted: claimsCreated,
  relationships_created_attempted: relationshipsCreated,
  relationships_cleaned: relCleaned,
  remaining_packed_units: db.prepare(`
    SELECT COUNT(*) total
    FROM knowledge_units
    WHERE title LIKE '%concept:%'
       OR title LIKE '%concepto:%'
       OR title LIKE '%nombre:%'
       OR title LIKE '%description:%'
       OR title LIKE '%descripcion:%'
       OR title LIKE '%relation:%'
       OR title LIKE '%relacion:%'
  `).get().total,
  sample_log: db.prepare(`
    SELECT before_title, after_title, action
    FROM canonical_knowledge_v2_log
    ORDER BY created_at DESC
    LIMIT 20
  `).all()
}, null, 2));

db.close();
