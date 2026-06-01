import { searchWikipedia, type ResearchResult } from './wikipedia';

export async function researchTopic(topic: string): Promise<ResearchResult[]> {
  const wiki = await searchWikipedia(topic);
  return wiki.filter((r) => r.extract.length > 80);
}

export function formatResearchForPrompt(results: ResearchResult[]) {
  if (!results.length) return 'No external research found.';

  return results.map((r, i) => `
SOURCE ${i + 1}
Type: ${r.source}
Title: ${r.title}
URL: ${r.url}
Summary: ${r.extract}
`).join('\n---\n');
}
