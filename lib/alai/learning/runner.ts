import { buildSourceContext } from '../sources/sourceContext';
import { safeJsonParse, buildFallbackKnowledge } from '../utils/jsonRepair';
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
import { db } from '../storage/db';



function normalizeRelatedConcept(raw: string) {
  let x = String(raw || '').trim();

  const target = x.match(/target=([^|]+)/i)?.[1];
  if (target) x = target.trim();

  x = x.replace(/^concepto:\s*/i, '');
  x = x.replace(/^concept:\s*/i, '');
  x = x.replace(/^nombre:\s*/i, '');

  x = x.split(/\s+(description|descripcion|relation|relacion|path|mastery_required|task):/i)[0].trim();
  x = x.split(/\s+\|\s+/)[0].trim();

  return x.replace(/\s+/g, ' ').slice(0, 160);
}

function parseInternalLearningTopic(topic: string) {
  const stage = topic.match(/stage=([^|]+)/)?.[1]?.trim() || 'POST_DOCTORADO';
  const path = topic.match(/path=([^|]+)/)?.[1]?.trim() || '';
  const target = topic.match(/target=([^|]+)/)?.[1]?.trim() || topic;
  const mastery = Number(topic.match(/mastery_required=(\d+)/)?.[1] || 90);

  const isInternal =
    topic.includes('ALAI_EXPAND_NODE') ||
    topic.includes('ALAI_CURRICULUM_EXPAND') ||
    topic.includes('ALAI_LEARN_TOPIC');

  return {
    isInternal,
    stage,
    path,
    target,
    mastery,
    title: isInternal ? target : topic,
    context: isInternal ? `stage=${stage}\npath=${path}\ntarget=${target}\nmastery_required=${mastery}` : ''
  };
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

export async function runLearningCycle(topic?: string) {
  const job = createLearningJob(topic);

  const rawLearningTopic = job.topic
    .replace(/^Reinforce:\s*/i, '')
    .replace(/^Verify claim:\s*/i, '')
    .replace(/^Verify conflict:\s*/i, '')
    .trim();

  const meta = parseInternalLearningTopic(rawLearningTopic);
  const cleanLearningTopic = meta.title;

  job.status = 'running';
  job.updatedAt = Date.now();
  markLearningJobStatus(job.id, 'running');
  saveLearningEvent({
    eventType: 'started',
    topic: cleanLearningTopic,
    message: 'Learning job started',
  });

  const sourcePack = buildSourceContext(cleanLearningTopic);
  const research = await researchTopic(cleanLearningTopic);
  const researchContext = [
    'REAL SOURCES CONTEXT:',
    sourcePack.context,
    '',
    'WEB RESEARCH CONTEXT:',
    formatResearchForPrompt(research)
  ].join('\n');

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

METADATA EDUCATIVA:
${meta.context || 'general'}

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
  let parsed = safeJsonParse(primary.text) || extractJson(primary.text);

  if (!parsed) {
    parsed = buildFallbackKnowledge(cleanLearningTopic, primary.text);

    saveLearningEvent({
      eventType: 'json_repaired',
      topic: cleanLearningTopic,
      message: 'Teacher returned invalid JSON; fallback knowledge created',
      confidence: 60,
    });
  }

  const verification = await verifyKnowledgeDraft({
    topic: cleanLearningTopic,
    researchContext,
    draft: parsed,
    teacherResults,
  });

  if (!verification.approved && !meta.isInternal) {
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

  if (!verification.approved && meta.isInternal) {
    verification.confidence = Math.max(60, Number(verification.confidence || 60));
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

  db.prepare(
    'CREATE TABLE IF NOT EXISTS mastery_progress (' +
    'id TEXT PRIMARY KEY, ' +
    'stage TEXT NOT NULL, ' +
    'path TEXT NOT NULL, ' +
    'topic TEXT NOT NULL, ' +
    'completed INTEGER NOT NULL DEFAULT 0, ' +
    'confidence INTEGER NOT NULL DEFAULT 0, ' +
    'verified INTEGER NOT NULL DEFAULT 0, ' +
    'updated_at INTEGER NOT NULL)'
  ).run();

  db.prepare(
    'INSERT INTO mastery_progress ' +
    '(id, stage, path, topic, completed, confidence, verified, updated_at) ' +
    'VALUES (@id, @stage, @path, @topic, 1, @confidence, @verified, @updatedAt) ' +
    'ON CONFLICT(id) DO UPDATE SET ' +
    'completed = 1, ' +
    'confidence = excluded.confidence, ' +
    'verified = excluded.verified, ' +
    'updated_at = excluded.updated_at'
  ).run({
    id: knowledge.id,
    stage: meta.stage || 'POST_DOCTORADO',
    path: meta.path || cleanLearningTopic,
    topic: cleanLearningTopic,
    confidence: knowledge.confidence,
    verified: knowledge.confidence >= 85 ? 1 : 0,
    updatedAt: Date.now(),
  });

  await inferRelationshipsForKnowledge(knowledge);

  for (const relatedRaw of knowledge.relatedConcepts.slice(0, 6)) {
    const related = normalizeRelatedConcept(relatedRaw);
    if (!related) continue;
    enqueueLearningJob(
      `ALAI_LEARN_TOPIC | stage=${meta.stage || (job as any).stage || 'POST_DOCTORADO'} | target=${related} | task=Learn this discovered child topic completely.`,
      Math.max(10, Math.min(50000, job.priority - 5))
    );
  }

  if (
    rawLearningTopic.includes('ALAI_EXPAND_NODE') ||
    rawLearningTopic.includes('ALAI_CURRICULUM_EXPAND') ||
    rawLearningTopic.includes('ALAI_LEARN_TOPIC')
  ) {
    for (const relatedRaw of knowledge.relatedConcepts.slice(0, 12)) {
      const related = normalizeRelatedConcept(relatedRaw);
      if (!related) continue;
      enqueueLearningJob(
        `ALAI_LEARN_TOPIC | stage=${meta.stage || (job as any).stage || 'POST_DOCTORADO'} | parent=${cleanLearningTopic.slice(0, 180)} | target=${related} | mastery_required=90 | task=Learn this discovered child topic completely.`,
        Math.max(20, Math.min(50000, job.priority - 1))
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
