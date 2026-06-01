import { db } from '../storage/db';
import { askTeachers } from '../teachers/studyai';


function safeJson(text: string) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;

  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

function getClaimToVerify() {
  return db.prepare(`
    SELECT c.*
    FROM knowledge_claims c
    LEFT JOIN claim_verifications v ON v.claim_id = c.id
    WHERE v.id IS NULL
    ORDER BY c.confidence ASC, c.updated_at DESC
    LIMIT 1
  `).get() as any;
}

export async function verifyOneClaim() {
  const claim = getClaimToVerify();

  if (!claim) {
    return {
      verified: false,
      reason: 'No unverified claims found',
    };
  }

  const result = await askTeachers({
    temperature: 0.15,
    maxTokens: 900,
    messages: [
      {
        role: 'system',
        content: `You are ALAI's claim verifier.

Return ONLY valid JSON.

Evaluate the claim as:
- supported: likely correct
- weak: partially true, vague, incomplete, or needs better evidence
- false: likely incorrect

JSON schema:
{
  "verdict": "supported" | "weak" | "false",
  "reason": "short reason",
  "confidenceDelta": number
}

Rules:
- confidenceDelta should be 5 for supported, -10 for weak, -25 for false.
- Do not over-penalize broad educational summaries.
- If the claim is too vague, use weak.`,
      },
      {
        role: 'user',
        content: `Verify this claim:

Subject: ${claim.subject}
Predicate: ${claim.predicate}
Object: ${claim.object}
Original topic: ${claim.title}`,
      },
    ],
  });

  const parsed = safeJson(result.text) || {
    verdict: 'weak',
    reason: 'Verifier response was not valid JSON.',
    confidenceDelta: -10,
  };

  const verdict = ['supported', 'weak', 'false'].includes(parsed.verdict)
    ? parsed.verdict
    : 'weak';

  const confidenceDelta =
    typeof parsed.confidenceDelta === 'number'
      ? Math.max(-30, Math.min(10, Math.round(parsed.confidenceDelta)))
      : verdict === 'supported'
        ? 5
        : verdict === 'false'
          ? -25
          : -10;

  const now = Date.now();
  const verificationId = `verify_${now}_${Math.random().toString(36).slice(2)}`;

  db.prepare(`
    INSERT INTO claim_verifications (
      id, claim_id, verdict, reason, confidence_delta,
      provider, model, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    verificationId,
    claim.id,
    verdict,
    String(parsed.reason || 'No reason provided.'),
    confidenceDelta,
    result.provider,
    result.model,
    now
  );

  const newConfidence = Math.max(1, Math.min(100, Number(claim.confidence || 60) + confidenceDelta));

  db.prepare(`
    UPDATE knowledge_claims
    SET confidence = ?, updated_at = ?
    WHERE id = ?
  `).run(newConfidence, now, claim.id);

  // Do not create learning jobs for weak/false claims here.
  // The verification record itself is enough for metrics.
  // Reinforcement missions are handled by /api/learning/reinforce.
  if (verdict !== 'supported') {
    db.prepare(`
      UPDATE knowledge_claims
      SET updated_at = ?
      WHERE id = ?
    `).run(now, claim.id);
  }

  return {
    verified: true,
    claim: {
      id: claim.id,
      subject: claim.subject,
      predicate: claim.predicate,
      object: claim.object,
      previousConfidence: claim.confidence,
      newConfidence,
    },
    verdict,
    reason: parsed.reason || 'No reason provided.',
    confidenceDelta,
    provider: result.provider,
    model: result.model,
  };
}

export function verificationStats() {
  const rows = db.prepare(`
    SELECT verdict, COUNT(*) AS count
    FROM claim_verifications
    GROUP BY verdict
  `).all() as any[];

  const total = db.prepare(`SELECT COUNT(*) AS count FROM claim_verifications`).get() as any;
  const claims = db.prepare(`SELECT COUNT(*) AS count FROM knowledge_claims`).get() as any;

  return {
    totalClaims: claims?.count || 0,
    verifiedClaims: total?.count || 0,
    byVerdict: rows,
  };
}
