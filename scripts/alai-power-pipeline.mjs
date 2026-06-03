import { spawnSync } from 'node:child_process';

const steps = [
  'scripts/alai-phase1-hygiene.mjs',
  'scripts/alai-source-harvester.mjs',
  'scripts/alai-source-ranking-engine.mjs',
  'scripts/alai-evidence-aggregation-engine.mjs',
  'scripts/alai-knowledge-merge-engine.mjs',
  'scripts/alai-claim-normalizer.mjs',
  'scripts/alai-structured-claim-extractor.mjs',
  'scripts/alai-claim-verification-v2.mjs',
  'scripts/alai-relationship-normalizer.mjs',
  'scripts/alai-semantic-inference-rebuild.mjs',
  'scripts/alai-hypothesis-generator.mjs',
  'scripts/alai-mastery-sync.mjs',
  'scripts/alai-learning-gain-engine.mjs',
  'scripts/alai-delta-tracker.mjs'
];

let ok = 0;
let failed = 0;

for (const step of steps) {
  console.log(`\n===== RUN ${step} =====`);
  const res = spawnSync('node', [step], { stdio: 'inherit' });

  if (res.status === 0) ok++;
  else {
    failed++;
    console.log(`FAILED: ${step}`);
  }
}

console.log(JSON.stringify({ ok, failed, total: steps.length }, null, 2));
process.exit(failed ? 1 : 0);
