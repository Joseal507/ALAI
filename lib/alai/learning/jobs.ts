import type { AlaiLearningJob, AlaiKnowledgeUnit } from '../types';
import { cleanSources, cleanStringArray, qualityPenalty } from '../knowledge/quality';
import { getNextLearningJob } from './queue';

const fallbackTopics = [
  'artificial intelligence fundamentals',
  'machine learning basics',
  'large language models',
  'prompt engineering',
  'TypeScript',
  'Next.js',
  'mathematics fundamentals',
  'logic and reasoning',
  'biology fundamentals',
  'physics fundamentals',
];

export function createLearningJob(topic?: string): AlaiLearningJob {
  const queued = topic ? null : getNextLearningJob();

  if (queued) return queued;

  return {
    id: `job_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    topic: topic || fallbackTopics[Math.floor(Math.random() * fallbackTopics.length)],
    priority: 50,
    status: 'pending',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

export function createKnowledgeId(title: string) {
  return title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
}


function cleanText(value: any): string {
  if (value == null) return '';

  if (typeof value === 'string') return value.trim();

  if (Array.isArray(value)) {
    return value
      .map((item) => cleanText(item))
      .filter(Boolean)
      .join('\n');
  }

  if (typeof value === 'object') {
    return Object.entries(value)
      .map(([key, val]) => {
        const cleaned = cleanText(val);
        return cleaned ? `${key}: ${cleaned}` : '';
      })
      .filter(Boolean)
      .join('\n');
  }

  return String(value).trim();
}

function cleanMixedArray(value: any): string[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => cleanText(item))
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => item !== '[object Object]');
}

export function normalizeKnowledgeUnit(raw: any, topic: string): AlaiKnowledgeUnit {
  const now = Date.now();
  const penalty = qualityPenalty(raw);
  const baseConfidence = Number(raw?.confidence || 70);
  const confidence = Math.max(60, Math.min(100, Math.round(baseConfidence - penalty)));

  return {
    id: createKnowledgeId(raw?.title || topic),
    title: cleanText(raw?.title || topic),
    summary: cleanText(raw?.summary),
    explanation: cleanText(raw?.explanation),
    examples: cleanMixedArray(raw?.examples),
    commonMistakes: cleanMixedArray(raw?.commonMistakes),
    relatedConcepts: cleanMixedArray(raw?.relatedConcepts),
    sources: cleanSources(raw?.sources?.length ? raw.sources : ['teacher_network']),
    confidence,
    createdAt: now,
    updatedAt: now,
  };
}
