import Database from 'better-sqlite3';

const db = new Database('data/alai.db');
const now = Date.now();

function canonical(raw = '') {
  let s = String(raw || '').trim();

  const conceptMatch = s.match(/concept[o]?:\s*([^|]+?)(?:\s+description:|\s+descripcion:|$)/i);
  if (conceptMatch?.[1]) s = conceptMatch[1].trim();

  s = s.replace(/^concept[o]?:\s*/i, '');
  s = s.replace(/^name:\s*/i, '');
  s = s.replace(/^nombre:\s*/i, '');
  s = s.split(/\s+(description|descripcion|relation|relacion):/i)[0].trim();

  return s
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9ñ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

function isBadText(text = '') {
  const t = String(text || '').toLowerCase();
  return (
    !t ||
    t === 'null' ||
    t === 'undefined' ||
    t.includes('[object object]') ||
    t.includes('objeto serializado') ||
    t.includes('serialized object') ||
    t.includes('explicación pendiente de reparación') ||
    t.includes('explicacion pendiente de reparacion')
  );
}

function predicateClean(p = '') {
  const x = String(p || '').trim().toLowerCase();
  if (!x) return 'states';
  if (['is', 'is_a', 'type_of'].includes(x)) return 'is_a';
  if (['states', 'state', 'says'].includes(x)) return 'states';
  if (['represents', 'representa'].includes(x)) return 'represents';
  if (['causes', 'causa'].includes(x)) return 'causes';
  if (['depends_on', 'depende_de'].includes(x)) return 'depends_on';
  return x.replace(/[^a-z0-9_]+/g, '_').slice(0, 60) || 'states';
}

function titleCaseFromCanonical(s = '') {
  return String(s || '')
    .split(' ')
    .filter(Boolean)
    .map(w => w.length <= 3 ? w : w[0].toUpperCase() + w.slice(1))
    .join(' ');
}

db.exec(`
CREATE TABLE IF NOT EXISTS claim_normalization_log (
  id TEXT PRIMARY KEY,
  claim_id TEXT NOT NULL,
  action TEXT NOT NULL,
  before_subject TEXT NOT NULL,
  after_subject TEXT NOT NULL,
  before_predicate TEXT NOT NULL,
  after_predicate TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS atomic_claim_candidates (
  id TEXT PRIMARY KEY,
  claim_id TEXT NOT NULL,
  title TEXT NOT NULL,
  subject TEXT NOT NULL,
  source_object TEXT NOT NULL,
  candidate_text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
`);

const claims = db.prepare(`
SELECT id, knowledge_id, title, subject, predicate, object, confidence
FROM knowledge_claims
`).all();

let deleted = 0;
let normalized = 0;
let candidates = 0;
let seen = new Set();

for (const c of claims) {
  const beforeSubject = String(c.subject || '');
  const beforePredicate = String(c.predicate || '');
  const obj = String(c.object || '').trim();

  if (isBadText(beforeSubject) || isBadText(obj)) {
    db.prepare(`DELETE FROM claim_verifications WHERE claim_id=?`).run(c.id);
    db.prepare(`DELETE FROM knowledge_claims WHERE id=?`).run(c.id);

    db.prepare(`
      INSERT OR REPLACE INTO claim_normalization_log
      (id, claim_id, action, before_subject, after_subject, before_predicate, after_predicate, reason, created_at)
      VALUES
      (@id, @claim_id, 'deleted', @before_subject, '', @before_predicate, '', @reason, @now)
    `).run({
      id: `cnl_deleted_${c.id}`,
      claim_id: c.id,
      before_subject: beforeSubject,
      before_predicate: beforePredicate,
      reason: 'bad serialized/empty/repair placeholder text',
      now
    });

    deleted++;
    continue;
  }

  const afterSubject = canonical(beforeSubject);
  const afterPredicate = predicateClean(beforePredicate);
  const afterTitle = titleCaseFromCanonical(afterSubject) || c.title;

  const dedupeKey = `${afterSubject}|${afterPredicate}|${obj.toLowerCase()}`;

  if (seen.has(dedupeKey)) {
    db.prepare(`DELETE FROM claim_verifications WHERE claim_id=?`).run(c.id);
    db.prepare(`DELETE FROM knowledge_claims WHERE id=?`).run(c.id);

    db.prepare(`
      INSERT OR REPLACE INTO claim_normalization_log
      (id, claim_id, action, before_subject, after_subject, before_predicate, after_predicate, reason, created_at)
      VALUES
      (@id, @claim_id, 'deleted_duplicate', @before_subject, @after_subject, @before_predicate, @after_predicate, @reason, @now)
    `).run({
      id: `cnl_dupe_${c.id}`,
      claim_id: c.id,
      before_subject: beforeSubject,
      after_subject: afterSubject,
      before_predicate: beforePredicate,
      after_predicate: afterPredicate,
      reason: 'duplicate normalized claim',
      now
    });

    deleted++;
    continue;
  }

  seen.add(dedupeKey);

  if (afterSubject && (afterSubject !== beforeSubject || afterPredicate !== beforePredicate || afterTitle !== c.title)) {
    db.prepare(`
      UPDATE knowledge_claims
      SET title=?,
          subject=?,
          predicate=?,
          canonical_subject=?,
          updated_at=?
      WHERE id=?
    `).run(afterTitle, afterSubject, afterPredicate, afterSubject, now, c.id);

    db.prepare(`
      INSERT OR REPLACE INTO claim_normalization_log
      (id, claim_id, action, before_subject, after_subject, before_predicate, after_predicate, reason, created_at)
      VALUES
      (@id, @claim_id, 'normalized', @before_subject, @after_subject, @before_predicate, @after_predicate, @reason, @now)
    `).run({
      id: `cnl_norm_${c.id}`,
      claim_id: c.id,
      before_subject: beforeSubject,
      after_subject: afterSubject,
      before_predicate: beforePredicate,
      after_predicate: afterPredicate,
      reason: 'canonicalized subject/predicate/title',
      now
    });

    normalized++;
  }

  if (obj.length > 220 && afterPredicate === 'states') {
    const parts = obj
      .split(/(?<=[.!?])\s+/)
      .map(x => x.trim())
      .filter(x => x.length >= 40)
      .slice(0, 5);

    for (const part of parts) {
      db.prepare(`
        INSERT OR IGNORE INTO atomic_claim_candidates
        (id, claim_id, title, subject, source_object, candidate_text, status, created_at, updated_at)
        VALUES
        (@id, @claim_id, @title, @subject, @source_object, @candidate_text, 'pending', @now, @now)
      `).run({
        id: `acc_${c.id}_${candidates}`,
        claim_id: c.id,
        title: afterTitle,
        subject: afterSubject,
        source_object: obj.slice(0, 500),
        candidate_text: part,
        now
      });

      candidates++;
    }
  }
}

console.log(JSON.stringify({
  claims_scanned: claims.length,
  deleted_bad_or_duplicate_claims: deleted,
  normalized_claims: normalized,
  atomic_candidates_created: candidates,
  verification_summary: db.prepare(`
    SELECT verdict, COUNT(*) total
    FROM claim_verifications
    GROUP BY verdict
  `).all(),
  sample_normalized: db.prepare(`
    SELECT title, subject, predicate, substr(object,1,120) object, confidence
    FROM knowledge_claims
    LIMIT 15
  `).all()
}, null, 2));

db.close();
