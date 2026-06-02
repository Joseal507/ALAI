import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const BASE = process.env.ALAI_BASE_URL || 'http://localhost:6969';
const cycles = Number(process.env.ALAI_CYCLES || 20);
const delayMs = Number(process.env.ALAI_DELAY_MS || 120000);

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function call(path, opts = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120000);

  try {
    const res = await fetch(`${BASE}${path}`, { ...opts, signal: controller.signal });
    const text = await res.text();
    try { return JSON.parse(text); } catch { return { raw: text.slice(0, 800) }; }
  } catch (err) {
    return { error: String(err?.message || err) };
  } finally {
    clearTimeout(timeout);
  }
}

for (let i = 1; i <= cycles; i++) {
  console.log(`\n🧠 ALAI required-topic cycle ${i}/${cycles}`);

  await call('/api/gaps/fill', { method: 'POST' });
  await call('/api/focus/apply', { method: 'POST' });

  const learn = await call('/api/learn', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}'
  });

  console.log(JSON.stringify({
    success: learn.success,
    status: learn.job?.status,
    topic: learn.job?.topic,
    confidence: learn.knowledge?.confidence,
    error: learn.error
  }, null, 2));

  if (String(learn.error || '').includes('429')) {
    console.log('⏳ Rate limit detectado. Esperando 5 minutos...');
    await sleep(300000);
  } else {
    await sleep(delayMs);
  }
}
