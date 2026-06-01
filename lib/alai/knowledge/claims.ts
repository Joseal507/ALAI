import { db } from '../storage/db';

function clean(value: string) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeId(value: string) {
  return clean(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 90);
}

function splitSentences(text: string) {
  return clean(text)
    .split(/(?<=[.!?])\s+/)
    .map(clean)
    .filter((s) => s.length > 25);
}

function titleSubject(title: string) {
  return clean(title)
    .replace(/\s*\([^)]*\)/g, '')
    .replace(/\bCNNs\b/g, 'Convolutional Neural Networks')
    .replace(/\bRNNs\b/g, 'Recurrent Neural Networks')
    .trim();
}

function extractFromSentence(title: string, sentence: string) {
  const subject = titleSubject(title);
  const s = sentence.toLowerCase();

  const rules: Array<[string, string]> = [
    [' is a ', 'is_a'],
    [' is an ', 'is_a'],
    [' are a ', 'is_a'],
    [' are an ', 'is_a'],
    [' uses ', 'uses'],
    [' use ', 'uses'],
    [' utilizes ', 'uses'],
    [' utilize ', 'uses'],
    [' based on ', 'based_on'],
    [' relies on ', 'relies_on'],
    [' rely on ', 'relies_on'],
    [' provides ', 'provides'],
    [' provide ', 'provides'],
    [' converts ', 'converts'],
    [' convert ', 'converts'],
    [' represents ', 'represents'],
    [' represent ', 'represents'],
    [' requires ', 'requires'],
    [' require ', 'requires'],
    [' does not require ', 'does_not_require'],
    [' do not require ', 'does_not_require'],
    [' does not use ', 'does_not_use'],
    [' do not use ', 'does_not_use'],
  ];

  for (const [needle, predicate] of rules) {
    const idx = s.indexOf(needle);
    if (idx === -1) continue;

    const after = sentence.slice(idx + needle.length).trim();
    const object = after
      .replace(/[,;:].*$/g, '')
      .replace(/\.$/g, '')
      .slice(0, 120)
      .trim();

    if (object.length < 3) continue;

    const badObjects = new Set([
      'human',
      'of statistics',
      'of multiple layers in the network',
      'the input data to improve the network s accuracy in making predictions or classifications',
      'the input data and desired output'
    ]);

    const lowerObject = object.toLowerCase();

    if (badObjects.has(lowerObject)) continue;
    if (lowerObject.startsWith('of ')) continue;
    if (lowerObject.split(' ').length < 2 && predicate !== 'is_a') continue;

    return {
      subject,
      predicate,
      object,
    };
  }

  return null;
}

export function extractClaimsForKnowledge(row: any) {
  const title = clean(row.title);
  const summary = clean(row.summary);
  const explanation = clean(row.explanation || '');

  const sentences = splitSentences(`${summary} ${explanation}`).slice(0, 8);
  const now = Date.now();

  let inserted = 0;

  db.prepare(`DELETE FROM knowledge_claims WHERE knowledge_id = ?`).run(row.id);

  for (const sentence of sentences) {
    const claim = extractFromSentence(title, sentence);
    if (!claim) continue;

    const id = `claim_${row.id}_${normalizeId(claim.subject)}_${claim.predicate}_${normalizeId(claim.object)}`;

    db.prepare(`
      INSERT OR IGNORE INTO knowledge_claims (
        id, knowledge_id, title, subject, predicate, object,
        confidence, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      row.id,
      title,
      claim.subject,
      claim.predicate,
      claim.object,
      Number(row.confidence || 60),
      now,
      now
    );

    inserted++;
  }

  return inserted;
}

export function rebuildKnowledgeClaims() {
  const rows = db.prepare(`
    SELECT *
    FROM knowledge_units
    ORDER BY updated_at DESC
  `).all() as any[];

  let claims = 0;

  for (const row of rows) {
    claims += extractClaimsForKnowledge(row);
  }

  const total = db.prepare(`SELECT COUNT(*) AS count FROM knowledge_claims`).get() as any;

  return {
    knowledge: rows.length,
    claims,
    totalClaims: total?.count || 0,
  };
}

export function listKnowledgeClaims(limit = 100) {
  return db.prepare(`
    SELECT *
    FROM knowledge_claims
    ORDER BY updated_at DESC
    LIMIT ?
  `).all(limit);
}
