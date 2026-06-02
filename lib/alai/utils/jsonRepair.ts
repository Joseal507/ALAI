export function extractJsonObject(input: string): string | null {
  if (!input) return null;

  let s = String(input).trim();

  s = s
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim();

  const first = s.indexOf('{');
  const last = s.lastIndexOf('}');

  if (first === -1 || last === -1 || last <= first) return null;

  return s.slice(first, last + 1);
}

export function safeJsonParse<T = any>(input: string): T | null {
  const raw = extractJsonObject(input);
  if (!raw) return null;

  try {
    return JSON.parse(raw) as T;
  } catch {}

  try {
    const repaired = raw
      .replace(/,\s*}/g, '}')
      .replace(/,\s*]/g, ']')
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'");

    return JSON.parse(repaired) as T;
  } catch {
    return null;
  }
}

export function buildFallbackKnowledge(topic: string, stage = 'UNKNOWN') {
  const clean = topic
    .replace(/^ALAI_LEARN_TOPIC\s*\|/i, '')
    .replace(/^ALAI_CURRICULUM_EXPAND\s*\|/i, '')
    .trim();

  const targetMatch = clean.match(/target=([^|]+)/i);
  const pathMatch = clean.match(/path=([^|]+)/i);

  const title = (targetMatch?.[1] || pathMatch?.[1] || clean || topic)
    .trim()
    .slice(0, 180);

  return {
    title,
    summary: `Tema educativo sobre ${title}.`,
    explanation: `Este conocimiento cubre los conceptos esenciales de ${title}, incluyendo definición, uso académico, ejemplos básicos, errores comunes y relaciones con temas previos del currículo.`,
    examples: [
      `Ejemplo básico relacionado con ${title}.`,
      `Aplicación escolar de ${title}.`,
      `Caso práctico para verificar comprensión de ${title}.`
    ],
    commonMistakes: [
      `Confundir la definición de ${title} con conceptos parecidos.`,
      `Aplicar ${title} sin revisar prerequisitos.`,
      `Memorizar sin comprender el razonamiento.`
    ],
    relatedConcepts: [],
    sources: ['fallback_teacher_repair'],
    confidence: 60,
    stage
  };
}
