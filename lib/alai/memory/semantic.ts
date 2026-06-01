import { db } from '../storage/db';

function normalize(value: string) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(value: string) {
  const stop = new Set([
    'the','and','for','with','that','this','from','into','are','was','were','you',
    'una','uno','los','las','del','que','por','para','con','como','esta','este',
    'what','how','why','when','where','which','explica','explique'
  ]);

  return normalize(value)
    .split(' ')
    .filter((t) => t.length > 2 && !stop.has(t));
}

function parseJsonArray(value: any): string[] {
  try {
    const parsed = JSON.parse(String(value || '[]'));
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function unique(arr: string[]) {
  return [...new Set(arr)];
}

export function buildSemanticMemory() {
  const rows = db.prepare(`
    SELECT *
    FROM knowledge_units
    ORDER BY updated_at DESC
  `).all() as any[];

  let indexed = 0;

  for (const row of rows) {
    const examples = parseJsonArray(row.examples);
    const mistakes = parseJsonArray(row.common_mistakes);
    const related = parseJsonArray(row.related_concepts);

    const content = [
      row.title,
      row.summary,
      row.explanation,
      examples.join(' '),
      mistakes.join(' '),
      related.join(' '),
    ].join(' ');

    const memoryTokens = unique(tokens(content));

    db.prepare(`
      INSERT INTO semantic_memory (
        id, knowledge_id, title, content, tokens, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        content = excluded.content,
        tokens = excluded.tokens,
        updated_at = excluded.updated_at
    `).run(
      `mem_${row.id}`,
      row.id,
      row.title,
      content,
      JSON.stringify(memoryTokens),
      Date.now()
    );

    indexed++;
  }

  return { indexed };
}

export function semanticSearch(query: string, limit = 8) {
  const qTokens = unique(tokens(query));
  const rows = db.prepare(`
    SELECT *
    FROM semantic_memory
  `).all() as any[];

  const scored = rows.map((row) => {
    let memTokens: string[] = [];

    try {
      memTokens = JSON.parse(row.tokens || '[]');
    } catch {}

    const memSet = new Set(memTokens);

    let overlap = 0;
    let soft = 0;

    for (const qt of qTokens) {
      if (memSet.has(qt)) overlap += 4;

      for (const mt of memTokens) {
        if (mt.includes(qt) || qt.includes(mt)) {
          soft += 0.6;
        }
      }
    }

    const score = overlap + soft;

    return {
      knowledgeId: row.knowledge_id,
      title: row.title,
      content: row.content,
      score: Math.round(score * 100) / 100,
    };
  });

  return scored
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
