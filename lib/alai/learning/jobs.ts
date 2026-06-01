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

export function normalizeKnowledgeUnit(raw: any, topic: string): AlaiKnowledgeUnit {
  const now = Date.now();
  const penalty = qualityPenalty(raw);
  const baseConfidence = Number(raw?.confidence || 70);
  const confidence = Math.max(60, Math.min(100, Math.round(baseConfidence - penalty)));

  return {
    id: createKnowledgeId(raw?.title || topic),
    title: String(raw?.title || topic).trim(),
    summary: String(raw?.summary || '').trim(),
    explanation: String(raw?.explanation || '').trim(),
    examples: cleanStringArray(raw?.examples),
    commonMistakes: cleanStringArray(raw?.commonMistakes),
    relatedConcepts: cleanStringArray(raw?.relatedConcepts),
    sources: cleanSources(raw?.sources?.length ? raw.sources : ['teacher_network']),
    confidence,
    createdAt: now,
    updatedAt: now,
  };
}
