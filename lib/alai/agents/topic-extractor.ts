const prefixes = [
  'what is',
  'what are',
  'explain',
  'describe',
  'tell me about',
  'how does',
  'how do',
  'why does',
  'why do',
  'define',
  'learn',
];

const lowercaseWords = new Set([
  'in',
  'on',
  'of',
  'for',
  'from',
  'to',
  'with',
  'and',
  'or',
  'the',
  'a',
  'an',
]);

export function extractLearningTopic(text: string) {
  let topic = String(text || '').trim();
  const lower = topic.toLowerCase();

  for (const prefix of prefixes) {
    if (lower.startsWith(prefix)) {
      topic = topic.slice(prefix.length).trim();
      break;
    }
  }

  topic = topic
    .replace(/\?+$/g, '')
    .replace(/\.+$/g, '')
    .trim();

  if (!topic) return 'Unknown Topic';

  return topic
    .split(/\s+/)
    .map((word, index) => {
      const clean = word.toLowerCase();

      if (index !== 0 && lowercaseWords.has(clean)) return clean;
      if (word.length <= 2 && !lowercaseWords.has(clean)) return word.toUpperCase();

      return clean.charAt(0).toUpperCase() + clean.slice(1);
    })
    .join(' ');
}
