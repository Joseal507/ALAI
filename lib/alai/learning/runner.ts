import { askMultipleTeachers } from '../teachers/studyai';
import { createLearningJob, normalizeKnowledgeUnit } from './jobs';
import { ALAI_SYSTEM_PROMPT } from '../prompts/system';
import { saveKnowledge } from '../knowledge/store';
import { enqueueLearningJob, markLearningJobStatus } from './queue';
import { researchTopic, formatResearchForPrompt } from '../search/research';
import { verifyKnowledgeDraft } from '../judge/truth';
import { saveLearningEvent } from '../events/store';
import { inferRelationshipsForKnowledge } from '../knowledge/relationships';
import { completeMissionForTopic } from '../agents/research-planner';

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

export async function runLearningCycle(topic?: string) {
  const job = createLearningJob(topic);

  const cleanLearningTopic = job.topic
    .replace(/^Reinforce:\s*/i, '')
    .replace(/^Verify claim:\s*/i, '')
    .replace(/^Verify conflict:\s*/i, '')
    .trim();

  job.status = 'running';
  job.updatedAt = Date.now();
  markLearningJobStatus(job.id, 'running');
  saveLearningEvent({
    eventType: 'started',
    topic: cleanLearningTopic,
    message: 'Learning job started',
  });

  const research = await researchTopic(cleanLearningTopic);
  const researchContext = formatResearchForPrompt(research);

  const teacherResults = await askMultipleTeachers({
    temperature: 0.22,
    maxTokens: 3000,
    count: 2,
    messages: [
      {
        role: 'system',
        content: `${ALAI_SYSTEM_PROMPT}

Ahora estás en modo aprendizaje interno.
Tu trabajo NO es conversar con usuario.
Tu trabajo es construir una unidad de conocimiento limpia, confiable y útil.

Usa primero la investigación externa si existe.
Usa Teacher Network para explicar, organizar y completar.
No inventes fuentes.
Devuelve SOLO JSON válido.`,
      },
      {
        role: 'user',
        content: `
ALAI debe aprender este tema exacto:

${cleanLearningTopic}

No cambies el título del tema. El campo "title" del JSON debe ser exactamente:
${cleanLearningTopic}

INVESTIGACIÓN EXTERNA:
${researchContext}

Devuelve exactamente este JSON:
{
  "title": "",
  "summary": "",
  "explanation": "",
  "examples": [],
  "commonMistakes": [],
  "relatedConcepts": [],
  "sources": [],
  "confidence": 0
}

Reglas:
- Si usas Wikipedia, incluye URLs reales en "sources".
- Si solo viene de Teacher Network, usa "teacher_network".
- No guardes basura.
- No inventes fuentes específicas si no aparecen en investigación externa.
- Debe servir para que ALAI lo reutilice en el futuro.
`,
      },
    ],
  });

  const primary = teacherResults[0];
  const parsed = extractJson(primary.text);

  if (!parsed) {
    job.status = 'failed';
    job.updatedAt = Date.now();
    markLearningJobStatus(job.id, 'failed');
    saveLearningEvent({
      eventType: 'failed',
      topic: cleanLearningTopic,
      message: 'Teacher returned invalid JSON',
    });

    return {
      success: false,
      job,
      provider: primary.provider,
      model: primary.model,
      research,
      teacherResults,
      error: 'Teacher returned invalid JSON',
      raw: primary.text,
    };
  }

  const verification = await verifyKnowledgeDraft({
    topic: cleanLearningTopic,
    researchContext,
    draft: parsed,
    teacherResults,
  });

  if (!verification.approved) {
    job.status = 'failed';
    job.updatedAt = Date.now();
    markLearningJobStatus(job.id, 'failed');
    saveLearningEvent({
      eventType: 'rejected',
      topic: cleanLearningTopic,
      message: 'Truth verifier rejected knowledge draft',
      confidence: verification.confidence,
    });

    return {
      success: false,
      job,
      research,
      teacherResults,
      verification,
      error: 'Truth verifier rejected knowledge draft',
    };
  }

  parsed.confidence = verification.confidence;

  if (Array.isArray(parsed.sources)) {
    parsed.sources = parsed.sources.map((s: any) => {
      if (typeof s === 'string') return s;
      if (s?.url) return String(s.url);
      return JSON.stringify(s);
    });
  }

  const knowledge = normalizeKnowledgeUnit(parsed, cleanLearningTopic);
  saveKnowledge(knowledge);

  await inferRelationshipsForKnowledge(knowledge);

  for (const related of knowledge.relatedConcepts.slice(0, 6)) {
    enqueueLearningJob(related, Math.max(10, job.priority - 5));
  }

  if (
    cleanLearningTopic.includes('ALAI_EXPAND_NODE') ||
    cleanLearningTopic.includes('ALAI_CURRICULUM_EXPAND') ||
    cleanLearningTopic.includes('ALAI_LEARN_TOPIC')
  ) {
    for (const related of knowledge.relatedConcepts.slice(0, 12)) {
      enqueueLearningJob(
        `ALAI_LEARN_TOPIC | stage=${job.stage || 'POST_DOCTORADO'} | parent=${cleanLearningTopic.slice(0, 180)} | target=${related} | mastery_required=90 | task=Learn this discovered child topic completely.`,
        Math.max(20, job.priority - 1)
      );
    }
  }

  job.status = 'completed';
  markLearningJobStatus(job.id, 'completed');
  completeMissionForTopic(job.topic);
  job.updatedAt = Date.now();

  saveLearningEvent({
    eventType: 'completed',
    topic: cleanLearningTopic,
    title: knowledge.title,
    provider: primary.provider,
    confidence: knowledge.confidence,
    message: 'Knowledge unit saved',
  });


  const { fillKnowledgeGaps } = await import('./gap-filler');

  fillKnowledgeGaps(10);

  return {
    success: true,
    job,
    knowledge,
    research,
    verification,
    teacherResults: teacherResults.map(t => ({
      provider: t.provider,
      model: t.model,
    })),
    provider: primary.provider,
    model: primary.model,
  };
}
