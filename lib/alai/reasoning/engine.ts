import { db } from '../storage/db';

function norm(value: string) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function idPart(value: string) {
  return norm(value)
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
}

function insertInference(args: {
  claimA: any;
  claimB: any;
  subject: string;
  inference: string;
  confidence: number;
}) {
  const id = `inf_${idPart(args.claimA.id)}_${idPart(args.claimB.id)}`;

  db.prepare(`
    INSERT OR IGNORE INTO knowledge_inferences (
      id, claim_a, claim_b, subject, inference, confidence,
      created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    args.claimA.id,
    args.claimB.id,
    args.subject,
    args.inference,
    args.confidence,
    Date.now(),
    Date.now()
  );
}

export function buildInferences(limit = 500) {
  const claims = db.prepare(`
    SELECT *
    FROM knowledge_claims
    ORDER BY confidence DESC, updated_at DESC
    LIMIT ?
  `).all(limit) as any[];

  let created = 0;

  for (const a of claims) {
    for (const b of claims) {
      if (a.id === b.id) continue;

      const aObject = norm(a.object);
      const bSubject = norm(b.subject);

      if (!aObject || !bSubject) continue;

      const connects =
        aObject === bSubject ||
        aObject.includes(bSubject) ||
        bSubject.includes(aObject);

      if (!connects) continue;

      const inference = `${a.subject} may be connected to ${b.object} because ${a.subject} ${a.predicate} ${a.object}, and ${b.subject} ${b.predicate} ${b.object}.`;

      insertInference({
        claimA: a,
        claimB: b,
        subject: a.subject,
        inference,
        confidence: Math.min(95, Math.round((Number(a.confidence || 60) + Number(b.confidence || 60)) / 2)),
      });

      created++;
    }
  }

  const total = db.prepare(`SELECT COUNT(*) AS count FROM knowledge_inferences`).get() as any;

  return {
    created,
    totalInferences: total?.count || 0,
  };
}

export function listInferences(limit = 50) {
  return db.prepare(`
    SELECT *
    FROM knowledge_inferences
    ORDER BY confidence DESC, updated_at DESC
    LIMIT ?
  `).all(limit);
}

export function countInferences() {
  const row = db.prepare(`SELECT COUNT(*) AS count FROM knowledge_inferences`).get() as any;
  return row?.count || 0;
}
