import { db } from '../storage/db';
import { askTeachers } from '../teachers/studyai';
import type { AlaiKnowledgeUnit, AlaiMessage } from '../types';

type RelationshipType =
  | 'related_to'
  | 'prerequisite_of'
  | 'depends_on'
  | 'specialization_of'
  | 'example_of'
  | 'application_of';

function createId(text: string) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
}

function extractJson(text: string) {
  try {
    return JSON.parse(text.trim());
  } catch {}

  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;

  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

export function saveRelationship(args: {
  sourceId: string;
  sourceTitle: string;
  targetId: string;
  targetTitle: string;
  relationship: RelationshipType | string;
  reason?: string;
  confidence: number;
}) {
  const now = Date.now();
  const id = `${args.sourceId}__${args.relationship}__${args.targetId}`;

  db.prepare(`
    INSERT INTO knowledge_relationships (
      id, source_id, source_title, target_id, target_title,
      relationship, reason, confidence, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      source_title = excluded.source_title,
      target_title = excluded.target_title,
      relationship = excluded.relationship,
      reason = excluded.reason,
      confidence = excluded.confidence,
      updated_at = excluded.updated_at
  `).run(
    id,
    args.sourceId,
    args.sourceTitle,
    args.targetId,
    args.targetTitle,
    args.relationship,
    args.reason || null,
    args.confidence,
    now,
    now
  );
}

export async function inferRelationshipsForKnowledge(unit: AlaiKnowledgeUnit) {
  const related = unit.relatedConcepts.slice(0, 10);
  if (!related.length) return { created: 0 };

  const messages: AlaiMessage[] = [
    {
      role: 'system',
      content: `
Eres ALAI Knowledge Graph Builder.
Tu trabajo es clasificar relaciones entre conceptos.
Devuelve SOLO JSON válido.
No inventes relaciones si no estás seguro.
`,
    },
    {
      role: 'user',
      content: `
SOURCE CONCEPT:
${unit.title}

SOURCE SUMMARY:
${unit.summary}

RELATED CONCEPTS:
${related.join('\n')}

Clasifica cada relación usando solo estos tipos:
- related_to
- prerequisite_of
- depends_on
- specialization_of
- example_of
- application_of

Importante:
Si SOURCE debe aprenderse antes que TARGET, usa prerequisite_of.
Si SOURCE necesita entender TARGET primero, usa depends_on.
Si TARGET es una versión más específica de SOURCE, usa specialization_of.
Si TARGET es ejemplo de SOURCE, usa example_of.
Si TARGET es aplicación de SOURCE, usa application_of.
Si no estás seguro, usa related_to.

Devuelve JSON:
{
  "relationships": [
    {
      "targetTitle": "",
      "relationship": "",
      "reason": "",
      "confidence": 0
    }
  ]
}
`,
    },
  ];

  const result = await askTeachers({
    messages,
    temperature: 0.15,
    maxTokens: 1600,
  });

  const parsed = extractJson(result.text);
  const relationships = Array.isArray(parsed?.relationships) ? parsed.relationships : [];

  let created = 0;

  for (const rel of relationships) {
    const targetTitle = String(rel?.targetTitle || '').trim();
    if (!targetTitle) continue;

    saveRelationship({
      sourceId: unit.id,
      sourceTitle: unit.title,
      targetId: createId(targetTitle),
      targetTitle,
      relationship: String(rel.relationship || 'related_to'),
      reason: String(rel.reason || ''),
      confidence: Number(rel.confidence || 60),
    });

    created++;
  }

  return {
    created,
    provider: result.provider,
    model: result.model,
  };
}

export function getSmartRelationships(limit = 300) {
  return db.prepare(`
    SELECT *
    FROM knowledge_relationships
    ORDER BY confidence DESC, updated_at DESC
    LIMIT ?
  `).all(limit);
}

export function getPrerequisiteOrder(limit = 100) {
  return db.prepare(`
    SELECT *
    FROM knowledge_relationships
    WHERE relationship IN ('prerequisite_of','depends_on')
    ORDER BY confidence DESC, updated_at DESC
    LIMIT ?
  `).all(limit);
}
