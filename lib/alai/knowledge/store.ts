import { db } from '../storage/db';
import type { AlaiKnowledgeUnit } from '../types';
import { saveKnowledgeEdges } from './graph';
import { buildSemanticMemory } from '../memory/semantic';
import { canonicalizeKnowledgeUnit } from './canonical';
import { extractClaimsForKnowledge } from './claims';

function normalizeText(value: string) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

export function saveKnowledge(unit: AlaiKnowledgeUnit) {
  db.prepare(`
    INSERT INTO knowledge_units (
      id, title, summary, explanation, examples, common_mistakes,
      related_concepts, sources, confidence, created_at, updated_at
    )
    VALUES (
      @id, @title, @summary, @explanation, @examples, @commonMistakes,
      @relatedConcepts, @sources, @confidence, @createdAt, @updatedAt
    )
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      summary = excluded.summary,
      explanation = excluded.explanation,
      examples = excluded.examples,
      common_mistakes = excluded.common_mistakes,
      related_concepts = excluded.related_concepts,
      sources = excluded.sources,
      confidence = excluded.confidence,
      updated_at = excluded.updated_at
  `).run({
    ...unit,
    searchable: normalizeText([
      unit.title,
      unit.summary,
      unit.explanation,
      unit.examples.join(' '),
      unit.commonMistakes.join(' '),
      unit.relatedConcepts.join(' '),
      unit.sources.join(' '),
    ].join(' ')),
    examples: JSON.stringify(unit.examples),
    commonMistakes: JSON.stringify(unit.commonMistakes),
    relatedConcepts: JSON.stringify(unit.relatedConcepts),
    sources: JSON.stringify(unit.sources),
  });

  saveKnowledgeEdges({
    sourceId: unit.id,
    sourceTitle: unit.title,
    relatedConcepts: unit.relatedConcepts,
    confidence: unit.confidence,
  });

  canonicalizeKnowledgeUnit({
    id: unit.id,
    title: unit.title,
    summary: unit.summary,
    related_concepts: JSON.stringify(unit.relatedConcepts),
    sources: JSON.stringify(unit.sources),
    confidence: unit.confidence,
  });

  extractClaimsForKnowledge({
    id: unit.id,
    title: unit.title,
    summary: unit.summary,
    explanation: unit.explanation,
    confidence: unit.confidence,
  });

  buildSemanticMemory();
}

export function listKnowledge(limit = 50) {
  return db.prepare(`
    SELECT * FROM knowledge_units
    ORDER BY updated_at DESC
    LIMIT ?
  `).all(limit);
}

export function searchKnowledge(query: string, limit = 5) {
  const q = `%${normalizeText(query)}%`;

  return db.prepare(`
    SELECT * FROM knowledge_units
    WHERE lower(title) LIKE ?
       OR lower(summary) LIKE ?
       OR lower(explanation) LIKE ?
       OR lower(examples) LIKE ?
       OR lower(common_mistakes) LIKE ?
       OR lower(related_concepts) LIKE ?
       OR lower(sources) LIKE ?
    ORDER BY confidence DESC, updated_at DESC
    LIMIT ?
  `).all(q, q, q, q, q, q, q, limit);
}
