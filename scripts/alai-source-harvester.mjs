import Database from 'better-sqlite3';

const db = new Database('data/alai.db');
const now = Date.now();

db.exec(`
CREATE TABLE IF NOT EXISTS knowledge_sources (
  id TEXT PRIMARY KEY,
  topic TEXT NOT NULL,
  normalized_topic TEXT NOT NULL,
  source_type TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  snippet TEXT NOT NULL DEFAULT '',
  score INTEGER NOT NULL DEFAULT 50,
  status TEXT NOT NULL DEFAULT 'ready',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
`);

function slug(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 100);
}

function cleanTopic(raw) {
  let s = String(raw || '').trim();
  const target = s.match(/target=([^|]+)/i)?.[1];
  if (target) s = target.trim();
  s = s.replace(/^concepto:\s*/i, '');
  s = s.replace(/^concept:\s*/i, '');
  s = s.replace(/^nombre:\s*/i, '');
  s = s.split(/\s+(description|descripcion|relacion|relation|path|mastery_required|task):/i)[0].trim();
  return s.replace(/\s+/g, ' ').slice(0, 160);
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'ALAI-Core/0.1 educational knowledge harvester'
    }
  });

  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

async function harvestWikipedia(topic) {
  const q = encodeURIComponent(topic);
  const search = await fetchJson(`https://en.wikipedia.org/w/rest.php/v1/search/page?q=${q}&limit=3`);
  const pages = search.pages || [];

  return pages.map(p => ({
    source_type: 'wikipedia',
    title: p.title || topic,
    url: `https://en.wikipedia.org/wiki/${encodeURIComponent(String(p.key || p.title).replaceAll(' ', '_'))}`,
    snippet: p.excerpt ? String(p.excerpt).replace(/<[^>]+>/g, '') : '',
    score: 80
  }));
}


async function harvestOpenStax(topic) {
  return [{
    source_type: 'openstax',
    title: `${topic} - OpenStax Reference`,
    url: `https://openstax.org/search?query=${encodeURIComponent(topic)}`,
    snippet: `OpenStax educational resource candidate for ${topic}`,
    score: 96
  }];
}

async function harvestMIT(topic) {
  return [{
    source_type: 'mit_ocw',
    title: `${topic} - MIT OpenCourseWare`,
    url: `https://ocw.mit.edu/search/?q=${encodeURIComponent(topic)}`,
    snippet: `MIT OpenCourseWare candidate for ${topic}`,
    score: 95
  }];
}


async function harvestOpenLibrary(topic) {
  const q = encodeURIComponent(topic);
  const data = await fetchJson(`https://openlibrary.org/search.json?q=${q}&limit=3`);
  const docs = data.docs || [];

  return docs.map(d => ({
    source_type: 'open_library',
    title: d.title || topic,
    url: d.key ? `https://openlibrary.org${d.key}` : 'https://openlibrary.org',
    snippet: [
      d.author_name?.slice(0, 3).join(', '),
      d.first_publish_year ? `First published ${d.first_publish_year}` : '',
      d.subject?.slice(0, 5).join(', ')
    ].filter(Boolean).join(' | '),
    score: 65
  }));
}

const active = db.prepare("SELECT active_stage FROM education_control WHERE id='main'").get()?.active_stage || 'MEDIA';

const jobs = db.prepare(`
SELECT topic
FROM learning_jobs
WHERE status='pending'
ORDER BY priority DESC, created_at ASC
LIMIT 20
`).all();

const qualityWeak = db.prepare(`
SELECT topic
FROM knowledge_quality
WHERE needs_reinforcement=1
ORDER BY quality_score ASC
LIMIT 10
`).all();

const topics = [...jobs, ...qualityWeak]
  .map(r => cleanTopic(r.topic))
  .filter(Boolean);

const uniqueTopics = [...new Set(topics)].slice(0, 20);

const insert = db.prepare(`
INSERT OR IGNORE INTO knowledge_sources
(id, topic, normalized_topic, source_type, title, url, snippet, score, status, created_at, updated_at)
VALUES
(@id, @topic, @normalized_topic, @source_type, @title, @url, @snippet, @score, 'ready', @now, @now)
`);

let saved = 0;
let failed = 0;

for (const topic of uniqueTopics) {
  console.log(`🔎 Harvesting sources for: ${topic}`);

  const allSources = [];

  try {
    allSources.push(...await harvestWikipedia(topic));
  } catch (err) {
    failed++;
    console.log(`  wikipedia failed: ${String(err.message || err)}`);
  }

  try {
    allSources.push(...await harvestOpenLibrary(topic));
  } catch (err) {
    failed++;
    console.log(`  openlibrary failed: ${String(err.message || err)}`);
  }


  try {
    allSources.push(...await harvestOpenStax(topic));
  } catch (err) {
    failed++;
    console.log(`  openstax failed: ${String(err.message || err)}`);
  }

  try {
    allSources.push(...await harvestMIT(topic));
  } catch (err) {
    failed++;
    console.log(`  mit failed: ${String(err.message || err)}`);
  }

  for (const src of allSources) {
    insert.run({
      id: `src_${slug(topic)}_${slug(src.source_type)}_${slug(src.title)}`,
      topic,
      normalized_topic: slug(topic),
      source_type: src.source_type,
      title: src.title,
      url: src.url,
      snippet: src.snippet || '',
      score: src.score,
      now
    });
    saved++;
  }
}

const summary = {
  active_stage: active,
  topics_checked: uniqueTopics.length,
  sources_saved_attempted: saved,
  source_rows_total: db.prepare("SELECT COUNT(*) total FROM knowledge_sources").get().total,
  failures: failed
};

console.log(JSON.stringify(summary, null, 2));

db.close();
