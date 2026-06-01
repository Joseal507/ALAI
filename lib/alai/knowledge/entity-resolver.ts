import { db } from '../storage/db';

function norm(value: string) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function titleCase(value: string) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map((w) => {
      const low = w.toLowerCase();
      if (['ai', 'ml', 'nlp', 'cnn', 'cnns', 'rnn', 'rnns', 'llm', 'llms'].includes(low)) {
        return low.toUpperCase();
      }
      if (['of', 'the', 'in', 'on', 'for', 'with', 'and', 'de', 'la', 'el', 'las', 'los'].includes(low)) {
        return low;
      }
      return low.charAt(0).toUpperCase() + low.slice(1);
    })
    .join(' ');
}

function inferEntityType(claim: any) {
  const text = norm(`${claim.title} ${claim.subject} ${claim.predicate} ${claim.object}`);

  const checks: Array<[string, string[]]> = [
    ['ai', [
      'machine learning', 'deep learning', 'neural network', 'transformer', 'attention',
      'token', 'embedding', 'backpropagation', 'gradient', 'model', 'classification',
      'convolutional', 'recurrent', 'feedforward', 'activation', 'loss function'
    ]],
    ['mathematics', [
      'derivative', 'differentiation', 'calculus', 'metric space', 'cauchy',
      'hilbert', 'function', 'relation', 'mapping', 'sequence', 'limit',
      'theorem', 'equation', 'gradient', 'chain rule'
    ]],
    ['finance', [
      'financial contract', 'underlying asset', 'buyer', 'seller', 'market',
      'economics', 'opportunity cost', 'competition', 'price'
    ]],
    ['biology', [
      'biology', 'neuron', 'synapse', 'nervous system', 'cell', 'energy',
      'genetics', 'biological', 'brain'
    ]],
    ['physics', [
      'physics', 'quantum', 'particle', 'wave', 'energy', 'hilbert space',
      'superposition', 'entanglement'
    ]],
    ['psychology', [
      'psychology', 'cognitive', 'behavior', 'learning science', 'memory'
    ]],
    ['history', [
      'history', 'historical', 'evidence', 'civilization'
    ]],
    ['economics', [
      'economics', 'market', 'production', 'consumption', 'scarcity',
      'opportunity cost', 'competition'
    ]],
  ];

  let best = 'general';
  let bestScore = 0;

  for (const [type, words] of checks) {
    const score = words.reduce((sum, word) => sum + (text.includes(word) ? 1 : 0), 0);
    if (score > bestScore) {
      best = type;
      bestScore = score;
    }
  }

  if (text.includes('derivative') && text.includes('contract')) return 'finance';
  if (text.includes('derivative') && (text.includes('calculus') || text.includes('rate of change') || text.includes('function'))) {
    return 'mathematics';
  }

  return best;
}

function canonicalSubject(subject: string, entityType: string) {
  const cleanSubject = titleCase(subject.replace(/\s*\([^)]*\)/g, ''));

  const special: Record<string, Record<string, string>> = {
    Derivative: {
      mathematics: 'Derivative (Calculus)',
      finance: 'Derivative (Finance)',
    },
    Transformer: {
      ai: 'Transformer (Machine Learning)',
      physics: 'Transformer (Electrical/Physics)',
    },
    Attention: {
      ai: 'Attention (Machine Learning)',
      psychology: 'Attention (Psychology)',
    },
  };

  const map = special[cleanSubject];
  if (map?.[entityType]) return map[entityType];

  if (entityType === 'general') return cleanSubject;

  return `${cleanSubject} (${titleCase(entityType)})`;
}

export function resolveClaimEntities() {
  const rows = db.prepare(`
    SELECT *
    FROM knowledge_claims
    ORDER BY updated_at DESC
  `).all() as any[];

  let updated = 0;

  for (const row of rows) {
    const entityType = inferEntityType(row);
    const canonical = canonicalSubject(row.subject, entityType);

    db.prepare(`
      UPDATE knowledge_claims
      SET entity_type = ?, canonical_subject = ?, updated_at = ?
      WHERE id = ?
    `).run(entityType, canonical, Date.now(), row.id);

    updated++;
  }

  return {
    updated,
  };
}

export function entityStats() {
  return db.prepare(`
    SELECT entity_type, COUNT(*) AS count
    FROM knowledge_claims
    GROUP BY entity_type
    ORDER BY count DESC
  `).all();
}
