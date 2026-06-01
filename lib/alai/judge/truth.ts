import { askTeachers, type TeacherResult } from '../teachers/studyai';
import type { AlaiMessage } from '../types';

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

export async function verifyKnowledgeDraft(args: {
  topic: string;
  researchContext: string;
  draft: any;
  teacherResults: TeacherResult[];
}) {
  const messages: AlaiMessage[] = [
    {
      role: 'system',
      content: `
Eres ALAI Truth Verifier.
Tu trabajo es detectar si una unidad de conocimiento es confiable.
Compara el draft con la investigación externa y con respuestas de teachers.
Devuelve SOLO JSON válido.
No seas complaciente.
Si hay poca evidencia, baja confidence.
`,
    },
    {
      role: 'user',
      content: `
TOPIC:
${args.topic}

EXTERNAL RESEARCH:
${args.researchContext}

KNOWLEDGE DRAFT:
${JSON.stringify(args.draft, null, 2)}

TEACHER RESULTS:
${JSON.stringify(args.teacherResults.map(t => ({
  provider: t.provider,
  model: t.model,
  text: t.text.slice(0, 2500)
})), null, 2)}

Devuelve JSON:
{
  "approved": true,
  "confidence": 0,
  "issues": [],
  "fixes": [],
  "reason": ""
}

Reglas:
- confidence 90-100: fuerte evidencia y coherencia.
- confidence 70-89: útil pero no perfecto.
- confidence 50-69: débil, incompleto o con dudas.
- approved debe ser false si hay contradicciones fuertes o basura.
`,
    },
  ];

  const result = await askTeachers({
    messages,
    temperature: 0.1,
    maxTokens: 1200,
  });

  const parsed = extractJson(result.text);

  return {
    approved: Boolean(parsed?.approved ?? true),
    confidence: Number(parsed?.confidence ?? args.draft?.confidence ?? 60),
    issues: Array.isArray(parsed?.issues) ? parsed.issues.map(String) : [],
    fixes: Array.isArray(parsed?.fixes) ? parsed.fixes.map(String) : [],
    reason: String(parsed?.reason || ''),
    provider: result.provider,
    model: result.model,
  };
}
