import { ALAI_SYSTEM_PROMPT } from '../prompts/system';
import { askTeachers } from '../teachers/studyai';
import { formatRagContext } from '../rag/search';
import { hybridSearch } from '../rag/hybrid';
import { semanticSearch } from '../memory/semantic';
import { createResearchMission } from '../agents/research-planner';
import { extractLearningTopic } from '../agents/topic-extractor';
import type { AlaiChatInput, AlaiChatResult, AlaiMessage } from '../types';

function formatSemanticContext(results: ReturnType<typeof semanticSearch>) {
  if (!results.length) return 'No semantic memory found.';

  return results.map((r, i) => `
SEMANTIC MEMORY ${i + 1}
Title: ${r.title}
Score: ${r.score}
Content: ${r.content.slice(0, 1800)}
`).join('\n---\n');
}

export async function runAlaiChat(input: AlaiChatInput): Promise<AlaiChatResult> {
  const message = input.message.trim();

  if (!message) {
    throw new Error('Empty message');
  }

  const history = Array.isArray(input.history) ? input.history.slice(-12) : [];

  const semanticResults = semanticSearch(message, 6);
  const ragResults = hybridSearch(message, 5);

  const hasStrongMemory =
    semanticResults.length > 0 &&
    Number(semanticResults[0]?.score || 0) >= 8;

  let learningTriggered = false;

  if (!hasStrongMemory) {
    const topic = extractLearningTopic(message);

    createResearchMission(
      topic,
      'Created from chat because ALAI did not find strong enough memory.',
      999
    );

    learningTriggered = true;
  }

  const semanticContext = formatSemanticContext(semanticResults);
  const ragContext = formatRagContext(ragResults);

  const messages: AlaiMessage[] = [
    {
      role: 'system',
      content: `${ALAI_SYSTEM_PROMPT}

Tienes memoria cognitiva propia.
Primero usa Semantic Memory.
Luego usa Hybrid RAG.
Después usa Teacher Network para completar, explicar y organizar.

Reglas:
- No inventes fuentes.
- Si ALAI tiene conocimiento relevante, úsalo primero.
- Si falta información, dilo claramente.
- Si la memoria no es suficiente, responde con lo que sabes y explica que ALAI creó una misión para aprender mejor ese tema.
- No digas que tienes memoria personal. Tu memoria es conocimiento aprendido.
`,
    },
    ...history,
    {
      role: 'user',
      content: `
USER QUESTION:
${message}

SEMANTIC MEMORY CONTEXT:
${semanticContext}

HYBRID RAG CONTEXT:
${ragContext}

Responde claro, útil y honesto.
`,
    },
  ];

  const result = await askTeachers({
    messages,
    temperature: semanticResults.length || ragResults.length ? 0.32 : 0.55,
    maxTokens: 2600,
  });

  return {
    answer: result.text.trim(),
    provider: result.provider,
    model: result.model,
    confidence: hasStrongMemory ? 0.93 : ragResults.length ? 0.84 : 0.68,
    usedMemory: semanticResults
      .filter((m) => m.score >= 8)
      .slice(0, 5)
      .map((m) => ({
        title: m.title,
        score: m.score,
      })),
    learningTriggered,
  };
}
