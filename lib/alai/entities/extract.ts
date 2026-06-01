import { db } from '../storage/db';

function normalize(text: string) {
  return String(text || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

export function rebuildEntities() {
  const now = Date.now();

  db.prepare(`DELETE FROM knowledge_entities`).run();

  const claims = db.prepare(`
    SELECT subject, object
    FROM knowledge_claims
  `).all() as any[];

  const entities = new Map<string, string>();

  function shouldKeepObject(value: string) {
    const text = String(value || '').trim();
    const words = text.split(/\s+/).filter(Boolean);
    if (words.length > 3) return false;

    const lower = text.toLowerCase();
    const conceptSignals = [
      'attention', 'transformer', 'network', 'learning', 'gradient',
      'function', 'logic', 'calculus', 'optimization', 'token',
      'embedding', 'model', 'algorithm', 'derivative', 'sequence'
    ];

    return conceptSignals.some((x) => lower.includes(x));
  }

  for (const row of claims) {
    for (const value of [row.subject, ...(shouldKeepObject(row.object) ? [row.object] : [])]) {
      const text = String(value || '').trim();

      if (!text) continue;
      if (text.length < 3) continue;
      if (text.length > 60) continue;

      const words = text.split(/\s+/).filter(Boolean);
      if (words.length > 4) continue;

      if (/^(a|an|the|for|of|to|in|on|with)\b/i.test(text)) continue;

      const cleanedText = text.replace(/^Reinforce:\s*/i, '').trim();

      const lower = cleanedText.toLowerCase();
      const phraseNoise = [
        'rather than',
        'such as',
        'where a',
        'that ',
        'which ',
        'where ',
        'used in',
        'based on',
        'type of',
        'field of',
        'framework for',
        'information about',
        'importance of',
        'goal or criterion',
        'spaces and punctuation',
        'bits to represent',
      ];

      if (phraseNoise.some((n) => lower.includes(n))) continue;

      if (cleanedText.length < 3) continue;

      const canonical = normalize(cleanedText);

      entities.set(canonical, cleanedText);
    }
  }

  let created = 0;

  for (const [canonical, original] of entities.entries()) {
    db.prepare(`
      INSERT INTO knowledge_entities (
        id,
        name,
        canonical_name,
        entity_type,
        confidence,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      `entity_${created}`,
      original,
      canonical,
      'concept',
      0.8,
      now,
      now
    );

    created++;
  }

  return { created };
}
