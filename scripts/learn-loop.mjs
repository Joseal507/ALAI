process.on('SIGTERM', () => {
  console.log('Job cancelled, exiting learn-loop...');
  process.exit(0);
});
const BASE_URL = process.env.ALAI_BASE_URL || 'http://localhost:6969';
const DELAY_MS = Number(process.env.ALAI_LEARN_DELAY_MS || 30000);
const ERROR_DELAY_MS = Number(process.env.ALAI_ERROR_DELAY_MS || 20000);
const FILL_GAPS_EVERY = Number(process.env.ALAI_FILL_GAPS_EVERY || 3);

let cycle = 0;
let learned = 0;
let errors = 0;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runLocalScript(command) {
  const { execSync } = await import('node:child_process');
  try {
    const out = execSync(command, { stdio: 'pipe', encoding: 'utf8' });
    return out.trim();
  } catch (err) {
    return String(err?.stdout || err?.message || err);
  }
}

async function jsonFetch(path, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  const text = await res.text();
  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }

  if (!res.ok) {
    throw new Error(data?.error || `HTTP ${res.status} on ${path}`);
  }

  return data;
}

async function healthCheck() {
  try {
    const data = await jsonFetch('/api/health');
    return Boolean(data?.ok);
  } catch {
    return false;
  }
}

async function getQueueStats() {
  return jsonFetch('/api/queue/stats');
}

async function repairQueue() {
  return jsonFetch('/api/queue/repair', { method: 'POST' });
}

async function fillGaps() {
  return jsonFetch('/api/gaps/fill', { method: 'POST' });
}

async function rebuildCurriculum() {
  return jsonFetch('/api/curriculum/rebuild', { method: 'POST' });
}

async function rebuildKnowledgeClaims() {
  return jsonFetch('/api/knowledge/claims/rebuild', { method: 'POST' });
}

async function detectKnowledgeConflicts() {
  return jsonFetch('/api/knowledge/conflicts/detect', { method: 'POST' });
}

async function verifyClaims() {
  return jsonFetch('/api/claims/verify', {
    method: 'POST',
    body: JSON.stringify({ count: 2 }),
  });
}

async function resolveEntities() {
  return jsonFetch('/api/knowledge/entities/resolve', { method: 'POST' });
}

async function buildInferences() {
  return jsonFetch('/api/reasoning/infer', { method: 'POST' });
}

async function rebuildEntities() {
  return jsonFetch('/api/entities/rebuild', { method: 'POST' });
}

async function rebuildLearningQuality() {
  return jsonFetch('/api/learning/quality/rebuild', { method: 'POST' });
}

async function reinforceWeakKnowledge() {
  return jsonFetch('/api/learning/reinforce', { method: 'POST' });
}

async function applyFocus() {
  return jsonFetch('/api/focus/apply', { method: 'POST' });
}

async function buildPrerequisiteJobs() {
  return jsonFetch('/api/curriculum/prereq-jobs', { method: 'POST' });
}

async function planResearchMissions() {
  return jsonFetch('/api/missions/plan', { method: 'POST' });
}

async function learnOnce() {
  return jsonFetch('/api/learn', {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

function logHeader() {
  console.log('\n🧠 ALAI Autonomous Learning Loop');
  console.log(`🌐 Base URL: ${BASE_URL}`);
  console.log(`⏱️ Delay: ${DELAY_MS}ms`);
  console.log(`🧩 Fill gaps every: ${FILL_GAPS_EVERY} cycles`);
  console.log('Press CTRL+C to stop.\n');
}

function logStats(stats) {
  console.log(
    `📊 Queue → pending:${stats.pending} running:${stats.running} completed:${stats.completed} failed:${stats.failed}`
  );
}

async function main() {
  logHeader();

  while (true) {
    cycle++;

    try {
      const alive = await healthCheck();

      if (!alive) {
        throw new Error(`ALAI server not reachable at ${BASE_URL}`);
      }

      const repair = await repairQueue();
      if (repair.repaired) {
        console.log(`🧯 Queue repair → repaired:${repair.repaired}`);
      }

      if (cycle === 1 || cycle % FILL_GAPS_EVERY === 0) {
        const gaps = await fillGaps();
        console.log(`🧩 Gap fill → created:${gaps.created || 0} skipped:${gaps.skipped || 0} queue:${gaps.queueSize ?? 'unknown'}`);

        const missions = await planResearchMissions();
        console.log(`🕵️ Research missions → created:${missions.created || 0} skipped:${missions.skipped || 0}`);

        const prereqs = await buildPrerequisiteJobs();
        console.log(`🧱 Prerequisite jobs → created:${prereqs.created || 0} boosted:${prereqs.boosted || 0} skipped:${prereqs.skipped || 0}`);

        const focus = await applyFocus();
        console.log(`🎯 Domain focus → changed:${focus.changed || 0}`);

        const expansion = await runLocalScript('npm run alai:expand');
        console.log(`🌱 Auto expansion → ${expansion.split('\n').slice(-1)[0] || 'done'}`);

        const gateRun = await runLocalScript('npm run alai:gate');
        console.log(`🚪 Education gate → ${gateRun.split('\n').find(l => l.includes('active_stage')) || 'done'}`);

        const curriculum = await rebuildCurriculum();
        console.log(`📚 Curriculum rebuild → updated:${curriculum.updated || 0}`);

        const claims = await rebuildKnowledgeClaims();
        console.log(`🧾 Claims rebuild → claims:${claims.totalClaims || 0}`);

        const entities = await resolveEntities();
        console.log(`🧠 Entity resolve → updated:${entities.updated || 0}`);

        const inferences = await buildInferences();
        console.log(`🔗 Inference build → total:${inferences.totalInferences || 0}`);

        const entityGraph = await rebuildEntities();
        console.log(`🧩 Entity graph → entities:${entityGraph.created || 0}`);

        const quality = await rebuildLearningQuality();
        console.log(`🏆 Quality rebuild → avg:${quality.averageScore || 0} total:${quality.total || 0}`);

        const reinforce = await reinforceWeakKnowledge();
        console.log(`🔁 Reinforcement → created:${reinforce.created || 0} weak:${reinforce.weakTopics || 0}`);

        const conflicts = await detectKnowledgeConflicts();
        console.log(`⚖️ Conflict scan → created:${conflicts.created || 0} pending:${conflicts.pending || 0}`);

        const verified = await verifyClaims();
        const verifiedCount = Array.isArray(verified.results)
          ? verified.results.filter((r) => r.verified).length
          : 0;
        console.log(`✅ Claim verification → verified:${verifiedCount} total:${verified.stats?.verifiedClaims || 0}/${verified.stats?.totalClaims || 0}`);
      }

      const before = await getQueueStats();
      logStats(before);

      if (before.pending <= 0) {
        console.log('⚠️ No pending jobs. Filling gaps and waiting...');
        await fillGaps();
        await sleep(DELAY_MS);
        continue;
      }

      const data = await learnOnce();

      if (!data?.success) {
        throw new Error(data?.error || 'Learning failed');
      }

      learned++;

      const topic = data?.job?.topic || data?.result?.job?.topic || 'unknown topic';
      const title = data?.knowledge?.title || data?.result?.knowledge?.title || 'unknown knowledge';
      const provider = data?.provider || data?.result?.provider || 'unknown provider';
      const confidence = data?.knowledge?.confidence || data?.result?.knowledge?.confidence || 'unknown';

      console.log(`✅ Cycle ${cycle} learned: ${topic}`);
      console.log(`   Saved: ${title}`);
      console.log(`   Provider: ${provider}`);
      console.log(`   Confidence: ${confidence}`);
      console.log(`   Total learned this run: ${learned}`);

      const after = await getQueueStats();
      logStats(after);

      await sleep(DELAY_MS);
    } catch (err) {
      errors++;
      const msg = String(err?.message || err);
      console.error(`❌ Cycle ${cycle} error: ${msg}`);
      console.error(`   Errors this run: ${errors}`);

      const isNetworkError =
        msg.includes('fetch failed') ||
        msg.includes('ECONNRESET') ||
        msg.includes('ETIMEDOUT') ||
        msg.includes('socket') ||
        msg.includes('network');

      await sleep(isNetworkError ? 10000 : ERROR_DELAY_MS);
    }
  }
}

main();
