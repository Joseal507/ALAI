import { db } from '../storage/db';

const STOP = new Set([
  'the','a','an','and','or','of','in','on','for','to','with','by','from','as','is','are',
  'una','uno','el','la','los','las','de','del','en','por','para','con','como','es','son'
]);

function normalizeText(value: string) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function titleCase(value: string) {
  const lowerWords = new Set([
    'de','del','la','las','el','los','en','por','para','con','y',
    'of','the','in','on','for','with','and'
  ]);

  return normalizeText(value)
    .split(' ')
    .filter(Boolean)
    .map((w, index) => {
      if (index !== 0 && lowerWords.has(w)) return w;
      if (w.length <= 2 && !lowerWords.has(w)) return w.toUpperCase();
      if (w === 'ai') return 'AI';
      if (w === 'cnns') return 'CNNs';
      if (w === 'rnns') return 'RNNs';
      if (w === 'llms') return 'LLMs';
      return w.charAt(0).toUpperCase() + w.slice(1);
    })
    .join(' ');
}

function fingerprintFor(title: string, summary: string, related: string[]) {
  const tokens = normalizeText([title, summary, related.join(' ')].join(' '))
    .split(' ')
    .filter((t) => t.length > 2 && !STOP.has(t))
    .map((t) => {
      if (t.endsWith('ies')) return t.slice(0, -3) + 'y';
      if (t.endsWith('s') && t.length > 4) return t.slice(0, -1);
      return t;
    });

  return [...new Set(tokens)].sort().slice(0, 14).join('_');
}

function hashText(value: string) {
  let hash = 0;

  for (let i = 0; i < value.length; i++) {
    hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0;
  }

  return Math.abs(hash).toString(36);
}

function parseArray(value: any): string[] {
  try {
    const parsed = JSON.parse(String(value || '[]'));
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export function canonicalizeKnowledgeUnit(row: any) {
  const related = parseArray(row.related_concepts);
  const sources = parseArray(row.sources);

  const canonicalTitle = titleCase(row.title);
  const canonicalSummary = String(row.summary || '').trim();
  const fingerprint = fingerprintFor(canonicalTitle, canonicalSummary, related);

  if (!fingerprint) return false;

  const now = Date.now();

  db.prepare(`
    INSERT INTO canonical_knowledge (
      id, knowledge_id, title, canonical_title, canonical_summary,
      fingerprint, confidence, sources, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(fingerprint) DO UPDATE SET
      confidence = MAX(confidence, excluded.confidence),
      sources = excluded.sources,
      updated_at = excluded.updated_at
  `).run(
    `ck_${fingerprint.slice(0, 64)}_${hashText(fingerprint)}`,
    row.id,
    row.title,
    canonicalTitle,
    canonicalSummary,
    fingerprint,
    Number(row.confidence || 60) <= 1
      ? Math.round(Number(row.confidence || 0.6) * 100)
      : Number(row.confidence || 60),
    JSON.stringify(sources),
    now,
    now
  );

  return true;
}

export function rebuildCanonicalKnowledge() {
  const rows = db.prepare(`
    SELECT *
    FROM knowledge_units
    ORDER BY updated_at DESC
  `).all() as any[];

  let indexed = 0;

  for (const row of rows) {
    if (canonicalizeKnowledgeUnit(row)) indexed++;
  }

  const total = db.prepare(`SELECT COUNT(*) AS count FROM canonical_knowledge`).get() as any;

  return {
    indexed,
    canonicalTotal: total?.count || 0,
  };
}

export function listCanonicalKnowledge(limit = 50) {
  return db.prepare(`
    SELECT *
    FROM canonical_knowledge
    ORDER BY confidence DESC, updated_at DESC
    LIMIT ?
  `).all(limit);
}
