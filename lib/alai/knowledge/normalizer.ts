const REPLACEMENTS: Array<[RegExp,string]> = [
  [/\s+/g, ' '],
  [/\(anns?\)/gi, ''],
  [/\(rnns?\)/gi, ''],
  [/\(cnns?\)/gi, ''],
  [/\(llms?\)/gi, ''],
  [/\(bptt\)/gi, ' Backpropagation Through Time'],
  [/\bin deep learning\b/gi, ''],
  [/\bin machine learning\b/gi, ''],
];

const CANONICAL: Array<[RegExp,string]> = [
  [/^convolutional neural networks?$/i, 'Convolutional Neural Networks'],
  [/^recurrent neural networks?$/i, 'Recurrent Neural Networks'],
  [/^artificial neural networks?$/i, 'Artificial Neural Networks'],
  [/^transformers?$/i, 'Transformers'],
];

export function normalizeTopic(topic: string) {
  let value = String(topic || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();

  for (const [pattern, replacement] of REPLACEMENTS) {
    value = value.replace(pattern, replacement);
  }

  value = value.replace(/\s+/g, ' ').trim();

  for (const [pattern, canonical] of CANONICAL) {
    if (pattern.test(value)) return canonical;
  }

  return value;
}

export function topicKey(topic: string) {
  return normalizeTopic(topic)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}
