import natural from 'natural';

const tfidf = new natural.TfIdf();

function normalize(text: string) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildVectorDocument(data: {
  title: string;
  summary: string;
  explanation: string;
  relatedConcepts: string[];
}) {
  return normalize([
    data.title,
    data.summary,
    data.explanation,
    data.relatedConcepts.join(' ')
  ].join(' '));
}

export function scoreDocuments(
  query: string,
  docs: Array<{
    id: string;
    text: string;
  }>
) {
  const local = new natural.TfIdf();

  for (const doc of docs) {
    local.addDocument(doc.text);
  }

  const scores = [];

  for (let i = 0; i < docs.length; i++) {
    let score = 0;

    local.tfidfs(query, (index, measure) => {
      if (index === i) {
        score = measure;
      }
    });

    scores.push({
      id: docs[i].id,
      score,
    });
  }

  return scores.sort((a, b) => b.score - a.score);
}
