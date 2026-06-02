const BASE = process.env.ALAI_BASE_URL || 'http://localhost:6969';
const cycles = Number(process.env.ALAI_CYCLES || 10);

async function call(path, opts = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90000);

  try {
    const res = await fetch(`${BASE}${path}`, {
      ...opts,
      signal: controller.signal
    });
    const text = await res.text();
    try { return JSON.parse(text); } catch { return { raw: text.slice(0, 500) }; }
  } catch (err) {
    return { error: String(err?.message || err) };
  } finally {
    clearTimeout(timeout);
  }
}

for (let i = 1; i <= cycles; i++) {
  console.log(`\n🧠 ALAI required-topic cycle ${i}/${cycles}`);

  await call('/api/queue/repair', { method: 'POST' });
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

  await call('/api/knowledge/claims/rebuild', { method: 'POST' });
  await call('/api/entities/rebuild', { method: 'POST' });
  await call('/api/graph/rebuild', { method: 'POST' });
  await call('/api/learning/quality/rebuild', { method: 'POST' });
}
