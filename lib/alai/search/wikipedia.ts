export type ResearchResult = {
  source: 'wikipedia';
  title: string;
  url: string;
  snippet: string;
  extract: string;
};

function cleanTopic(topic: string) {
  return topic.trim().replace(/\s+/g, ' ');
}

export async function searchWikipedia(topic: string): Promise<ResearchResult[]> {
  const q = cleanTopic(topic);
  if (!q) return [];

  try {
    const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&format=json&origin=*`;

    const searchRes = await fetch(searchUrl, { cache: 'no-store' });
    if (!searchRes.ok) return [];

    const searchData = await searchRes.json();
    const hits = Array.isArray(searchData?.query?.search)
      ? searchData.query.search.slice(0, 3)
      : [];

    const results: ResearchResult[] = [];

    for (const hit of hits) {
      const title = String(hit.title || '');
      if (!title) continue;

      const summaryUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
      const summaryRes = await fetch(summaryUrl, { cache: 'no-store' });
      if (!summaryRes.ok) continue;

      const summary = await summaryRes.json();

      results.push({
        source: 'wikipedia',
        title,
        url: String(summary?.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${encodeURIComponent(title)}`),
        snippet: String(hit.snippet || '').replace(/<[^>]+>/g, ''),
        extract: String(summary?.extract || ''),
      });
    }

    return results;
  } catch {
    return [];
  }
}
