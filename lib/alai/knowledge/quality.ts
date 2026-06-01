function cleanText(value: any): string {
  if (value === null || value === undefined) return '';

  if (typeof value === 'string') {
    return value
      .replace(/\s+/g, ' ')
      .replace(/\[object Object\]/g, '')
      .trim();
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  if (Array.isArray(value)) {
    return value.map(cleanText).filter(Boolean).join('; ');
  }

  if (typeof value === 'object') {
    const preferred = [
      value.title,
      value.name,
      value.term,
      value.concept,
      value.example,
      value.mistake,
      value.description,
      value.explanation,
      value.summary,
      value.text,
    ].map(cleanText).filter(Boolean);

    if (preferred.length) return preferred.join(': ');

    return Object.entries(value)
      .map(([k, v]) => `${k}: ${cleanText(v)}`)
      .filter((x) => !x.endsWith(': '))
      .join('; ');
  }

  return String(value).trim();
}

export function cleanStringArray(value: any): string[] {
  const arr = Array.isArray(value) ? value : [value];

  return arr
    .map(cleanText)
    .map((x) => x.trim())
    .filter(Boolean)
    .filter((x) => x !== '[object Object]')
    .slice(0, 20);
}

export function cleanSources(value: any): string[] {
  const arr = Array.isArray(value) ? value : [value];

  return arr
    .map((item) => {
      if (typeof item === 'string') return item.trim();

      if (item && typeof item === 'object') {
        if (item.url) return String(item.url).trim();
        if (item.link) return String(item.link).trim();
        if (item.source) return String(item.source).trim();
        if (item.title) return String(item.title).trim();
      }

      return cleanText(item);
    })
    .filter(Boolean)
    .filter((x) => x !== '[object Object]')
    .slice(0, 20);
}

export function qualityPenalty(raw: any): number {
  const serialized = JSON.stringify(raw || {});
  let penalty = 0;

  if (serialized.includes('[object Object]')) penalty += 20;
  if (!raw?.summary) penalty += 8;
  if (!raw?.explanation) penalty += 8;
  if (!Array.isArray(raw?.relatedConcepts) || raw.relatedConcepts.length === 0) penalty += 5;
  if (!Array.isArray(raw?.sources) || raw.sources.length === 0) penalty += 5;

  return penalty;
}
