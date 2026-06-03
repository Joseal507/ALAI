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
  return String(s || '').replace(/\s+/g, ' ').trim();
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
    if (m?.[1]) return cleanText(m[1]).slice(0, 900);
  }
  return '';
}

function isPacked(raw = '') {
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

const packedUnits = db.prepare(`
SELECT id, title, summary, explanation, examples, common_mistakes, related_concepts, sources, confidence
FROM knowledge_units
WHERE title LIKE '%concept:%'
   OR title LIKE '%concepto:%'
   OR title LIKE '%nombre:%'
   OR title LIKE '%description:%'
   OR title LIKE '%descripcion:%'
   OR title LIKE '%relation:%'
   OR title LIKE '%relacion:%'
`).all();

let scanned = packedUnits.length;
let renamed = 0;
let merged = 0;
let claimsCreated = 0;
let relationshipsCreated = 0;
let semanticUpdated = 0;
let relsUpdated = 0;

for (const u of packedUnits) {
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

  let targetId = u.id;
  let targetTitle = canonical;

  if (existing) {
    targetId = existing.id;
    targetTitle = existing.title;

    db.prepare(`
      UPDATE knowledge_units
      SET confidence=MAX(confidence, ?),
          summary=CASE WHEN length(summary) < length(?) THEN ? ELSE summary END,
          explanation=CASE WHEN length(explanation) < length(?) THEN ? ELSE explanation END,
          examples=CASE WHEN length(examples) < length(?) THEN ? ELSE examples END,
          common_mistakes=CASE WHEN length(common_mistakes) < length(?) THEN ? ELSE common_mistakes END,
          related_concepts=CASE WHEN length(related_concepts) < length(?) THEN ? ELSE related_concepts END,
          sources=CASE WHEN length(sources) < length(?) THEN ? ELSE sources END,
          updated_at=?
      WHERE id=?
    `).run(
      Number(u.confidence || 60),
      u.summary, u.summary,
      u.explanation, u.explanation,
      u.examples, u.examples,
      u.common_mistakes, u.common_mistakes,
      u.related_concepts, u.related_concepts,
      u.sources, u.sources,
      now,
      existing.id
    );

    db.prepare(`
      UPDATE knowledge_claims
      SET knowledge_id=?,
          title=?,
          subject=CASE WHEN lower(subject)=lower(?) THEN ? ELSE subject END,
          canonical_subject=?
      WHERE knowledge_id=?
    `).run(
      existing.id,
      existing.title,
      before,
      existing.title.toLowerCase(),
      existing.title.toLowerCase(),
      u.id
    );

    db.prepare(`
      UPDATE semantic_memory
      SET knowledge_id=?,
          title=?
      WHERE knowledge_id=?
    `).run(existing.id, existing.title, u.id);

    const srcUpdate = db.prepare(`
      UPDATE knowledge_relationships
      SET source_id=?,
          source_title=?,
          updated_at=?
      WHERE source_id=? OR lower(source_title)=lower(?)
    `).run(existing.id, existing.title, now, u.id, before);

    const tgtUpdate = db.prepare(`
      UPDATE knowledge_relationships
      SET target_id=?,
          target_title=?,
          updated_at=?
      WHERE target_id=? OR lower(target_title)=lower(?)
    `).run(existing.id, existing.title, now, u.id, before);

    relsUpdated += Number(srcUpdate.changes || 0) + Number(tgtUpdate.changes || 0);

    db.prepare(`DELETE FROM knowledge_units WHERE id=?`).run(u.id);

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
          summary=CASE WHEN summary='' AND ?!='' THEN ? ELSE summary END,
          explanation=CASE WHEN explanation='' AND ?!='' THEN ? ELSE explanation END,
          updated_at=?
      WHERE id=?
    `).run(
      canonical,
      description, description,
      description, description,
      now,
      u.id
    );

    db.prepare(`
      UPDATE knowledge_claims
      SET title=?,
          subject=CASE WHEN lower(subject)=lower(?) THEN ? ELSE subject END,
          canonical_subject=?
      WHERE knowledge_id=?
    `).run(canonical, before, canonical.toLowerCase(), canonical.toLowerCase(), u.id);

    const sm = db.prepare(`
      UPDATE semantic_memory
      SET title=?
      WHERE knowledge_id=?
    `).run(canonical, u.id);
    semanticUpdated += Number(sm.changes || 0);

    const srcUpdate = db.prepare(`
      UPDATE knowledge_relationships
      SET source_title=?,
          updated_at=?
      WHERE source_id=? OR lower(source_title)=lower(?)
    `).run(canonical, now, u.id, before);

    const tgtUpdate = db.prepare(`
      UPDATE knowledge_relationships
      SET target_title=?,
          updated_at=?
      WHERE target_id=? OR lower(target_title)=lower(?)
    `).run(canonical, now, u.id, before);

    relsUpdated += Number(srcUpdate.changes || 0) + Number(tgtUpdate.changes || 0);

    db.prepare(`
      INSERT OR REPLACE INTO canonical_knowledge_v2_log
      (id, knowledge_id, before_title, after_title, extracted_description, extracted_relation, action, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'renamed', ?)
    `).run(`ckv2_${safe(u.id)}`, u.id, before, canonical, description, relation, now);

    renamed++;
  }

  db.prepare(`
    INSERT OR IGNORE INTO knowledge_entities
    (id, name, canonical_name, entity_type, confidence, created_at, updated_at)
    VALUES (?, ?, ?, 'concept', 0.85, ?, ?)
  `).run(`ent_${safe(targetTitle)}`, targetTitle, targetTitle.toLowerCase(), now, now);

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
      (id, source_id, source_title, target_id, target_title, relationship, reason, confidence, created_at, updated_at)
      VALUES
      (?, ?, ?, ?, ?, 'related_to', ?, 72, ?, ?)
    `).run(
      `rel_context_${safe(targetTitle)}`,
      targetId,
      targetTitle,
      'context',
      'Contexto relacionado',
      relation,
      now,
      now
    );
    relationshipsCreated++;
  }
}

const packedRels = db.prepare(`
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

for (const r of packedRels) {
  const source = isPacked(r.source_title) ? extractCanonical(r.source_title) : r.source_title;
  const target = isPacked(r.target_title) ? extractCanonical(r.target_title) : r.target_title;

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
  semantic_memory_updated: semanticUpdated,
  relationship_rows_updated: relsUpdated,
  packed_relationships_cleaned: relCleaned,
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
