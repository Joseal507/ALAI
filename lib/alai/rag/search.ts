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

function tokenize(value: string) {
  return normalize(value)
    .split(' ')
    .filter((w) => w.length > 2)
    .filter((w) => ![
      'the','and','for','with','that','this','una','uno','los','las','del','que','por','para','con',
      'what','how','why','are','you','como','que','cual','cuales','explica','explique'
    ].includes(w));
}

function parseJsonArray(value: any): string[] {
  try {
    const parsed = JSON.parse(String(value || '[]'));
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export function ragSearch(query: string, limit = 5) {
  const qTokens = tokenize(query);
  const rows = db.prepare(`
    SELECT *
    FROM knowledge_units
    ORDER BY updated_at DESC
    LIMIT 1000
  `).all() as any[];

  const scored = rows.map((row) => {
    const examples = parseJsonArray(row.examples);
    const mistakes = parseJsonArray(row.common_mistakes);
    const related = parseJsonArray(row.related_concepts);
    const sources = parseJsonArray(row.sources);

    const haystack = normalize([
      row.title,
      row.summary,
      row.explanation,
      examples.join(' '),
      mistakes.join(' '),
      related.join(' '),
    ].join(' '));

    let score = 0;

    for (const token of qTokens) {
      if (normalize(row.title).includes(token)) score += 8;
      if (normalize(row.summary).includes(token)) score += 5;
      if (normalize(row.explanation).includes(token)) score += 3;
      if (haystack.includes(token)) score += 2;
      for (const r of related) {
        if (normalize(r).includes(token)) score += 4;
      }
    }

    return {
      id: row.id,
      title: row.title,
      summary: row.summary,
      explanation: row.explanation,
      examples,
      commonMistakes: mistakes,
      relatedConcepts: related,
      sources,
      confidence: row.confidence,
      score,
    };
  });

  return scored
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || b.confidence - a.confidence)
    .slice(0, limit);
}

export function formatRagContext(results: ReturnType<typeof ragSearch>) {
  if (!results.length) return 'No relevant ALAI knowledge found.';

  return results.map((r, i) => `
RAG RESULT ${i + 1}
Title: ${r.title}
Score: ${r.score}
Confidence: ${r.confidence}
Summary: ${r.summary}
Explanation: ${r.explanation}
Examples: ${r.examples.join('; ')}
Common mistakes: ${r.commonMistakes.join('; ')}
Related concepts: ${r.relatedConcepts.join('; ')}
Sources: ${r.sources.join('; ')}
`).join('\n---\n');
}
