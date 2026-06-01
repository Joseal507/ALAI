import { NextResponse } from 'next/server';
import { db } from '@/lib/alai/storage/db';
import { getMissingGraphTargets } from '@/lib/alai/knowledge/graph';
import { latestLearningEvent, listLearningEvents } from '@/lib/alai/events/store';
import { listResearchMissions } from '@/lib/alai/agents/research-planner';
import { countPendingConflicts } from '@/lib/alai/knowledge/conflicts';
import { verificationStats } from '@/lib/alai/verifier/claims';
import { getHealthMetrics } from '@/lib/alai/metrics/health';

export const runtime = 'nodejs';

function one(sql: string) {
  return db.prepare(sql).get() as any;
}

function all(sql: string) {
  return db.prepare(sql).all() as any[];
}

export async function GET() {
  const knowledge = one(`SELECT COUNT(*) AS total FROM knowledge_units`);
  const edges = one(`SELECT COUNT(*) AS total FROM knowledge_edges`);
  const pending = one(`SELECT COUNT(*) AS total FROM learning_jobs WHERE status='pending'`);
  const running = one(`SELECT COUNT(*) AS total FROM learning_jobs WHERE status='running'`);
  const completed = one(`SELECT COUNT(*) AS total FROM learning_jobs WHERE status='completed'`);
  const failed = one(`SELECT COUNT(*) AS total FROM learning_jobs WHERE status='failed'`);

  const latestKnowledge = all(`
    SELECT id,title,summary,confidence,updated_at
    FROM knowledge_units
    ORDER BY updated_at DESC
    LIMIT 5
  `);

  const latestJobs = all(`
    SELECT id,topic,priority,status,updated_at
    FROM learning_jobs
    ORDER BY updated_at DESC
    LIMIT 8
  `);

  const gaps = getMissingGraphTargets(10);
  const latestEvent = latestLearningEvent();
  const recentEvents = listLearningEvents(12);
  const researchMissions = listResearchMissions(10);

  const claimsCount = (db.prepare(`
    SELECT COUNT(*) AS count
    FROM knowledge_claims
  `).get() as any)?.count || 0;

  const pendingConflicts = countPendingConflicts();
  const claimVerification = verificationStats();
  const health = getHealthMetrics();

  const learningQuality = (db.prepare(`
    SELECT AVG(score) AS averageScore, COUNT(*) AS total
    FROM learning_quality
  `).get() as any) || { averageScore: 0, total: 0 };

  const weakKnowledge = db.prepare(`
    SELECT title, score, claims, verified, inferences
    FROM learning_quality
    ORDER BY score ASC, updated_at DESC
    LIMIT 5
  `).all();

  const learningChain = all(`
    SELECT e.source_title, e.target_title, e.relationship, e.confidence, e.updated_at
    FROM knowledge_edges e
    ORDER BY e.updated_at DESC
    LIMIT 14
  `);

  return NextResponse.json({
    success: true,
    status: 'online',
    knowledge: Number(knowledge.total || 0),
    edges: Number(edges.total || 0),
    queue: {
      pending: Number(pending.total || 0),
      running: Number(running.total || 0),
      completed: Number(completed.total || 0),
      failed: Number(failed.total || 0),
    },
    gaps,
    latestKnowledge,
    latestJobs,
    latestEvent,
    recentEvents,
    learningChain,
    researchMissions,
    claimsCount,
    pendingConflicts,
    claimVerification,
    health,
    learningQuality: {
      averageScore: Math.round(Number(learningQuality.averageScore || 0)),
      total: Number(learningQuality.total || 0),
    },
    weakKnowledge,
    systemIntegrity: pendingConflicts > 0 ? 'Needs review' : 'Clean',
    updatedAt: new Date().toISOString(),
  });
}
