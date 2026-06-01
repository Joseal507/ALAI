import { NextResponse } from 'next/server';
import { db } from '@/lib/alai/storage/db';

export const runtime = 'nodejs';

function norm(value: string) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\be\.g\.\b/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\b(algorithm|algorithms)\b/g, 'algorithm')
    .replace(/\b(network|networks)\b/g, 'network')
    .replace(/\b(function|functions)\b/g, 'function')
    .replace(/\b(model|models)\b/g, 'model')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(value: string) {
  return norm(value)
    .split(' ')
    .filter((t) => t.length > 2);
}

function jaccard(a: string[], b: string[]) {
  const A = new Set(a);
  const B = new Set(b);

  const inter = [...A].filter((x) => B.has(x)).length;
  const union = new Set([...A, ...B]).size || 1;

  return inter / union;
}

function titleScore(a: string, b: string) {
  const na = norm(a);
  const nb = norm(b);

  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.85;

  return jaccard(tokens(a), tokens(b));
}

export async function GET() {
  const rows = db.prepare(`
    SELECT id, knowledge_id, canonical_title, fingerprint, confidence
    FROM canonical_knowledge
    ORDER BY updated_at DESC
  `).all() as any[];

  const candidates: any[] = [];

  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const score = Math.max(
        titleScore(rows[i].canonical_title, rows[j].canonical_title),
        jaccard(tokens(rows[i].fingerprint), tokens(rows[j].fingerprint))
      );

      if (score >= 0.72) {
        candidates.push({
          a: rows[i].canonical_title,
          b: rows[j].canonical_title,
          score: Math.round(score * 100) / 100,
          confidenceA: rows[i].confidence,
          confidenceB: rows[j].confidence,
        });
      }
    }
  }

  candidates.sort((a, b) => b.score - a.score);

  return NextResponse.json({
    success: true,
    count: candidates.length,
    candidates: candidates.slice(0, 100),
  });
}
