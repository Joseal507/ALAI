import Database from 'better-sqlite3';

const db = new Database('data/alai.db');
const now = Date.now();

function safe(s = '') {
  return String(s)
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 160);
}

function cleanEntity(s = '') {
  return String(s || '')
    .replace(/[.,;:()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

function titleCase(s = '') {
  return String(s || '')
    .split(' ')
    .filter(Boolean)
    .map(w => w.length <= 3 ? w : w[0].toUpperCase() + w.slice(1))
    .join(' ');
}

function extractStructured(subject, object) {
  const text = String(object || '');
  const lower = text.toLowerCase();
  const out = [];

  const subj = cleanEntity(subject);

  const patterns = [
    {
      predicate: 'depends_on',
      re: /(?:depende de|depends on|se basa en|is based on)\s+([^.;]+)/gi
    },
    {
      predicate: 'causes',
      re: /(?:causa|causes|produce|provoca|genera)\s+([^.;]+)/gi
    },
    {
      predicate: 'part_of',
      re: /(?:es parte de|forma parte de|part of|pertenece a)\s+([^.;]+)/gi
    },
    {
      predicate: 'prerequisite_of',
      re: /(?:es base para|sienta las bases para|prerequisito de|prerequisite for|necesario para)\s+([^.;]+)/gi
    },
    {
      predicate: 'used_for',
      re: /(?:se usa para|sirve para|used for|permite)\s+([^.;]+)/gi
    },
    {
      predicate: 'forms',
      re: /(?:forma|forman|constituyen|componen)\s+([^.;]+)/gi
    },
    {
      predicate: 'measures',
      re: /(?:mide|miden|measures)\s+([^.;]+)/gi
    },
    {
      predicate: 'unit',
      re: /(?:unidad.*?es|unit.*?is)\s+([^.;]+)/gi
    }
  ];

  for (const p of patterns) {
    for (const m of text.matchAll(p.re)) {
      const obj = cleanEntity(m[1]);
      if (obj.length >= 3 && obj.length <= 120) {
        out.push({
          subject: subj,
          predicate: p.predicate,
          object: obj
        });
      }
    }
  }

  if (lower.includes('incluyendo') || lower.includes('including')) {
    const m = text.match(/(?:incluyendo|including)\s+([^.;]+)/i);
    if (m?.[1]) {
      const parts = m[1]
        .split(/,| y | and /i)
        .map(cleanEntity)
        .filter(x => x.length >= 3 && x.length <= 80)
        .slice(0, 5);

      for (const part of parts) {
        out.push({
          subject: subj,
          predicate: 'includes',
          object: part
        });
      }
    }
  }

  return out;
}

db.exec(`
CREATE TABLE IF NOT EXISTS structured_claim_extractions (
  id TEXT PRIMARY KEY,
  source_claim_id TEXT NOT NULL,
  title TEXT NOT NULL,
  subject TEXT NOT NULL,
  predicate TEXT NOT NULL,
  object TEXT NOT NULL,
  confidence INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'inserted',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
`);

const claims = db.prepare(`
SELECT id, knowledge_id, title, subject, predicate, object, confidence
FROM knowledge_claims
WHERE predicate='states'
`).all();

let scanned = 0;
let extracted = 0;
let inserted = 0;

const insertClaim = db.prepare(`
INSERT OR IGNORE INTO knowledge_claims
(id, knowledge_id, title, subject, predicate, object, confidence, created_at, updated_at, entity_type, canonical_subject)
VALUES
(@id, @knowledge_id, @title, @subject, @predicate, @object, @confidence, @now, @now, 'structured', @canonical_subject)
`);

const insertLog = db.prepare(`
INSERT OR IGNORE INTO structured_claim_extractions
(id, source_claim_id, title, subject, predicate, object, confidence, status, created_at, updated_at)
VALUES
(@id, @source_claim_id, @title, @subject, @predicate, @object, @confidence, 'inserted', @now, @now)
`);

for (const c of claims) {
  scanned++;

  const structured = extractStructured(c.subject, c.object);

  for (const x of structured) {
    const title = titleCase(x.subject) || c.title;
    const id = `claim_struct_${safe(x.subject)}_${safe(x.predicate)}_${safe(x.object)}`;

    insertClaim.run({
      id,
      knowledge_id: c.knowledge_id,
      title,
      subject: x.subject.toLowerCase(),
      predicate: x.predicate,
      object: x.object,
      confidence: Math.min(95, Math.max(70, Number(c.confidence || 70))),
      canonical_subject: x.subject.toLowerCase(),
      now
    });

    insertLog.run({
      id: `sce_${id}`,
      source_claim_id: c.id,
      title,
      subject: x.subject.toLowerCase(),
      predicate: x.predicate,
      object: x.object,
      confidence: Math.min(95, Math.max(70, Number(c.confidence || 70))),
      now
    });

    extracted++;
  }
}

inserted = db.prepare(`
SELECT COUNT(*) total
FROM structured_claim_extractions
`).get().total;

console.log(JSON.stringify({
  states_claims_scanned: scanned,
  structured_claims_extracted_attempted: extracted,
  structured_extractions_total: inserted,
  predicate_summary: db.prepare(`
    SELECT predicate, COUNT(*) total
    FROM knowledge_claims
    GROUP BY predicate
    ORDER BY total DESC
    LIMIT 30
  `).all(),
  samples: db.prepare(`
    SELECT subject, predicate, object, confidence
    FROM knowledge_claims
    WHERE entity_type='structured'
    ORDER BY created_at DESC
    LIMIT 20
  `).all()
}, null, 2));

db.close();
