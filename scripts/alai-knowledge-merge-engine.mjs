import Database from 'better-sqlite3';

const db = new Database('data/alai.db');
const now = Date.now();

function canonical(raw = '') {
  let s = String(raw || '').trim();

  s = s.replace(/^concept:\s*/i, '');
  s = s.replace(/^concepto:\s*/i, '');
  s = s.replace(/^name:\s*/i, '');
  s = s.replace(/^nombre:\s*/i, '');
  s = s.replace(/\([^)]*\)/g, '');
  s = s.replace(/\b(mechanical|academic|complete|completa|completo)\b/gi, '');
  s = s.replace(/\bfacultad\s+completa\s+de\b/gi, '');
  s = s.replace(/\bcarrera\s+completa\s+de\b/gi, '');
  s = s.replace(/\bprograma\s+completo\s+de\b/gi, '');

  const map = {
    force: 'fuerzas',
    forces: 'fuerzas',
    fuerza: 'fuerzas',
    fuerzas: 'fuerzas',
    dynamics: 'dinamica',
    dinámica: 'dinamica',
    dinamica: 'dinamica',
    reaction: 'reacciones',
    reactions: 'reacciones',
    reaccion: 'reacciones',
    reacción: 'reacciones',
    reacciones: 'reacciones',
    thermodynamics: 'termodinamica',
    termodinámica: 'termodinamica',
    termodinamica: 'termodinamica',
    neurophysiology: 'neurofisiologia',
    neurofisiología: 'neurofisiologia',
    neurofisiologia: 'neurofisiologia'
  };

  let key = s.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return map[key] || key;
}

function isStructure(raw = '') {
  const t = String(raw || '').toLowerCase();
  return (
    t.includes('facultad completa') ||
    t.includes('carrera completa') ||
    t.includes('programa completo') ||
    t.includes('alai_') ||
    t.includes('stage=') ||
    t.includes('target=') ||
    t.includes('task=') ||
    t.includes('path=')
  );
}

function safe(s = '') {
  return String(s)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 180);
}

db.exec(`
CREATE TABLE IF NOT EXISTS knowledge_merge_groups (
  id TEXT PRIMARY KEY,
  canonical_key TEXT NOT NULL,
  canonical_title TEXT NOT NULL,
  members TEXT NOT NULL,
  member_count INTEGER NOT NULL,
  action TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS knowledge_source_cleanup (
  id TEXT PRIMARY KEY,
  topic TEXT NOT NULL,
  normalized_topic TEXT NOT NULL,
  action TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
`);

let mergeGroups = 0;
let canonicalUpdates = 0;
let sourceArchived = 0;
let evidenceArchived = 0;

const units = db.prepare(`
SELECT id, title, confidence
FROM knowledge_units
`).all();

const groups = new Map();

for (const u of units) {
  const key = canonical(u.title);
  if (!key) continue;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(u);
}

for (const [key, members] of groups.entries()) {
  if (members.length < 2) continue;

  const best = members
    .slice()
    .sort((a, b) => Number(b.confidence || 0) - Number(a.confidence || 0))[0];

  db.prepare(`
    INSERT OR REPLACE INTO knowledge_merge_groups
    (id, canonical_key, canonical_title, members, member_count, action, created_at, updated_at)
    VALUES
    (@id, @key, @title, @members, @count, 'merge_candidate', @now, @now)
  `).run({
    id: `kmg_${safe(key)}`,
    key,
    title: best.title,
    members: JSON.stringify(members.map(m => ({ id: m.id, title: m.title, confidence: m.confidence }))),
    count: members.length,
    now
  });

  mergeGroups++;

  for (const m of members) {
    db.prepare(`
      UPDATE knowledge_units
      SET confidence = MAX(confidence, ?),
          updated_at=?
      WHERE id=?
    `).run(best.confidence, now, m.id);

    canonicalUpdates++;
  }
}

// Limpiar fuentes históricas que son estructuras curriculares o metadata
const sources = db.prepare(`
SELECT id, topic, normalized_topic
FROM knowledge_sources
WHERE status='ready'
`).all();

for (const s of sources) {
  if (!isStructure(s.topic)) continue;

  db.prepare(`
    UPDATE knowledge_sources
    SET status='archived',
        updated_at=?
    WHERE id=?
  `).run(now, s.id);

  db.prepare(`
    INSERT OR REPLACE INTO knowledge_source_cleanup
    (id, topic, normalized_topic, action, reason, created_at, updated_at)
    VALUES
    (@id, @topic, @normalized, 'archived', @reason, @now, @now)
  `).run({
    id: `ksc_${safe(s.id)}`,
    topic: s.topic,
    normalized: s.normalized_topic,
    reason: 'curriculum structure or internal metadata is not a harvestable knowledge source topic',
    now
  });

  sourceArchived++;
}

// Evidencia sobre estructuras no debe subir confidence
const evidence = db.prepare(`
SELECT id, topic
FROM topic_evidence_aggregation
`).all();

for (const e of evidence) {
  if (!isStructure(e.topic)) continue;

  db.prepare(`
    UPDATE topic_evidence_aggregation
    SET confidence_bonus=0,
        evidence_level='archived_structure',
        reason=reason || '; archived structure topic',
        updated_at=?
    WHERE id=?
  `).run(now, e.id);

  evidenceArchived++;
}

console.log(JSON.stringify({
  merge_groups_found: mergeGroups,
  canonical_confidence_updates: canonicalUpdates,
  archived_structure_sources: sourceArchived,
  archived_structure_evidence: evidenceArchived,
  examples: db.prepare(`
    SELECT canonical_key, canonical_title, member_count
    FROM knowledge_merge_groups
    ORDER BY member_count DESC
    LIMIT 20
  `).all(),
  source_status: db.prepare(`
    SELECT status, COUNT(*) total
    FROM knowledge_sources
    GROUP BY status
  `).all()
}, null, 2));

db.close();
