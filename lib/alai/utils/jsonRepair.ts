export function safeJsonParse(text: string) {
  const raw = String(text || '').trim();

  const attempts = [
    raw,
    raw.replace(/^```json/i, '').replace(/^```/i, '').replace(/```$/i, '').trim(),
    raw.match(/\{[\s\S]*\}/)?.[0] || '',
  ].filter(Boolean);

  for (const attempt of attempts) {
    try {
      return JSON.parse(attempt);
    } catch {}
  }

  return null;
}

export function buildFallbackKnowledge(topic: string, raw: string) {
  const clean = String(raw || '')
    .replace(/```json|```/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  return {
    title: topic,
    summary: clean.slice(0, 500) || `Unidad de conocimiento sobre ${topic}.`,
    explanation: clean.slice(0, 2000) || `Explicación inicial sobre ${topic}.`,
    examples: [],
    commonMistakes: [],
    relatedConcepts: [],
    sources: ['teacher_network_fallback'],
    confidence: 60
  };
}
