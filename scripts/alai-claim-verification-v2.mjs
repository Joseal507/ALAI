import Database from 'better-sqlite3';

const db = new Database('data/alai.db');
const now = Date.now();

function safe(s = '') {
  return String(s)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 180);
}

const activeStage = db.prepare(
  "SELECT active_stage FROM education_control WHERE id='main'"
).get()?.active_stage || 'UNIVERSIDAD';

db.exec(`
CREATE TABLE IF NOT EXISTS claim_verification_scores (
  id TEXT PRIMARY KEY,
  topic TEXT NOT NULL,
  total_claims INTEGER NOT NULL,
  supported_claims INTEGER NOT NULL,
  needs_review_claims INTEGER NOT NULL,
  supported_ratio REAL NOT NULL,
  needs_review_ratio REAL NOT NULL,
  evidence_bonus INTEGER NOT NULL,
  penalty INTEGER NOT NULL,
  action TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
`);

const rows = db.prepare(`
SELECT
  kc.title AS topic,
  COUNT(*) AS total_claims,
  SUM(CASE WHEN cv.verdict='supported' THEN 1 ELSE 0 END) AS supported_claims,
  SUM(CASE WHEN cv.verdict='needs_review' THEN 1 ELSE 0 END) AS needs_review_claims
FROM knowledge_claims kc
LEFT JOIN claim_verifications cv ON cv.claim_id=kc.id
GROUP BY kc.title
`).all();

let scored = 0;
let upgraded = 0;
let penalized = 0;
let reinforced = 0;
let missions = 0;

for (const r of rows) {
  const total = Number(r.total_claims || 0);
  const supported = Number(r.supported_claims || 0);
  const needs = Number(r.needs_review_claims || 0);

  if (!total) continue;

  const supportedRatio = supported / total;
  const needsRatio = needs / total;

  let bonus = 0;
  let penalty = 0;
  let action = 'hold';

  if (supportedRatio >= 0.9 && total >= 3) {
    bonus = 8;
    action = 'upgrade_confidence';
  } else if (supportedRatio >= 0.75 && total >= 3) {
    bonus = 4;
    action = 'small_upgrade';
  }

  if (needsRatio >= 0.2 && needs >= 2) {
    penalty = 8;
    action = 'reinforce_and_research';
  } else if (needsRatio > 0) {
    penalty = 3;
    if (action === 'hold') action = 'review';
  }

  db.prepare(`
    INSERT OR REPLACE INTO claim_verification_scores
    (id, topic, total_claims, supported_claims, needs_review_claims, supported_ratio, needs_review_ratio, evidence_bonus, penalty, action, reason, created_at, updated_at)
    VALUES
    (@id, @topic, @total, @supported, @needs, @supported_ratio, @needs_ratio, @bonus, @penalty, @action, @reason, @now, @now)
  `).run({
    id: `cvs_${safe(r.topic)}`,
    topic: r.topic,
    total,
    supported,
    needs,
    supported_ratio: Number(supportedRatio.toFixed(4)),
    needs_ratio: Number(needsRatio.toFixed(4)),
    bonus,
    penalty,
    action,
    reason: `supported=${supported}/${total}; needs_review=${needs}/${total}`,
    now
  });

  scored++;

  const net = bonus - penalty;

  if (net !== 0) {
    const ku = db.prepare(`
      SELECT id, confidence
      FROM knowledge_units
      WHERE lower(title)=lower(?)
      ORDER BY updated_at DESC
      LIMIT 1
    `).get(r.topic);

    if (ku) {
      const next = Math.max(40, Math.min(98, Number(ku.confidence || 0) + net));

      db.prepare(`
        UPDATE knowledge_units
        SET confidence=?,
            updated_at=?
        WHERE id=?
      `).run(next, now, ku.id);

      if (net > 0) upgraded++;
      else penalized++;
    }
  }

  if (action === 'reinforce_and_research') {
    db.prepare(`
      INSERT OR IGNORE INTO reinforcement_queue
      (id, topic, reason, priority, status, created_at, updated_at, stage)
      VALUES
      (@id, @topic, @reason, 960000, 'pending', @now, @now, @stage)
    `).run({
      id: `rq_claim_${safe(r.topic)}`,
      topic: `ALAI_REINFORCE_TOPIC | stage=${activeStage} | target=${r.topic} | task=Fix claims marked needs_review using stronger sources and clearer atomic claims.`,
      reason: `claim_verification_v2: ${needs}/${total} claims need review`,
      stage: activeStage,
      now
    });

    db.prepare(`
      INSERT OR IGNORE INTO research_missions
      (id, topic, reason, priority, status, created_at, updated_at)
      VALUES
      (@id, @topic, @reason, 960000, 'pending', @now, @now)
    `).run({
      id: `mission_claim_${safe(r.topic)}`,
      topic: r.topic,
      reason: `CLAIM_VERIFICATION_GAP | needs_review=${needs}/${total} | goal=Find stronger sources and resolve uncertain claims.`,
      now
    });

    reinforced++;
    missions++;
  }
}

console.log(JSON.stringify({
  active_stage: activeStage,
  topics_scored: scored,
  knowledge_upgraded: upgraded,
  knowledge_penalized: penalized,
  reinforcement_created_attempted: reinforced,
  missions_created_attempted: missions,
  score_summary: db.prepare(`
    SELECT action, COUNT(*) total
    FROM claim_verification_scores
    GROUP BY action
    ORDER BY total DESC
  `).all(),
  weakest_claim_topics: db.prepare(`
    SELECT topic, total_claims, supported_claims, needs_review_claims, ROUND(needs_review_ratio,2) needs_ratio, action
    FROM claim_verification_scores
    ORDER BY needs_review_ratio DESC, needs_review_claims DESC
    LIMIT 20
  `).all()
}, null, 2));

db.close();
