import Database from 'better-sqlite3';

function slug(s: string) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 100);
}

export function cleanLearningTarget(raw: string) {
  let s = String(raw || '').trim();

  const target = s.match(/target=([^|]+)/i)?.[1];
  if (target) s = target.trim();

  s = s.replace(/^concepto:\s*/i, '');
  s = s.replace(/^concept:\s*/i, '');
  s = s.replace(/^nombre:\s*/i, '');

  s = s.split(/\s+(description|descripcion|relacion|relation|path|mastery_required|task):/i)[0].trim();
  s = s.split(/\s+\|\s+/)[0].trim();

  return s.replace(/\s+/g, ' ').slice(0, 160);
}

export function buildSourceContext(topic: string, limit = 6) {
  const db = new Database('data/alai.db');
  const target = cleanLearningTarget(topic);
  const normalized = slug(target);

  const rows = db.prepare(`
    SELECT source_type, title, url, snippet, score
    FROM knowledge_sources
    WHERE normalized_topic=?
       OR topic=?
       OR topic LIKE ?
    ORDER BY score DESC, updated_at DESC
    LIMIT ?
  `).all(normalized, target, `%${target}%`, limit) as any[];

  db.close();

  if (!rows.length) {
    return {
      target,
      hasSources: false,
      context: 'NO_EXTERNAL_SOURCES_FOUND: Use teacher knowledge carefully and avoid unsupported claims.',
      sources: []
    };
  }

  const context = rows.map((r, i) => {
    return [
      `SOURCE ${i + 1}`,
      `type: ${r.source_type}`,
      `title: ${r.title}`,
      `score: ${r.score}`,
      `url: ${r.url}`,
      `snippet: ${r.snippet || ''}`
    ].join('\n');
  }).join('\n\n');

  return {
    target,
    hasSources: true,
    context,
    sources: rows.map(r => r.url)
  };
}
