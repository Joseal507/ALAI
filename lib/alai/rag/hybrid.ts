import { db } from '../storage/db';
import { scoreDocuments, buildVectorDocument } from '../vector/engine';
import { ragSearch } from './search';

export function hybridSearch(query: string, limit = 5) {
  const keywordResults = ragSearch(query, limit * 3);

  const rows = db.prepare(`
    SELECT *
    FROM knowledge_units
  `).all() as any[];

  const docs = rows.map((row) => ({
    id: row.id,
    text: buildVectorDocument({
      title: row.title,
      summary: row.summary,
      explanation: row.explanation,
      relatedConcepts: JSON.parse(row.related_concepts || '[]'),
    }),
  }));

  const vectorScores = scoreDocuments(query, docs);

  const vectorMap = new Map(
    vectorScores.map((v) => [v.id, v.score])
  );

  const merged = keywordResults.map((item) => ({
    ...item,
    hybridScore:
      item.score +
      (vectorMap.get(item.id) || 0) * 10,
  }));

  return merged
    .sort((a, b) => b.hybridScore - a.hybridScore)
    .slice(0, limit);
}
