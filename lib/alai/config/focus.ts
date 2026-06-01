export const FOCUS_CONFIG = {
  primaryDomains: ['ai', 'machine learning', 'deep learning', 'mathematics', 'logic'],
  boostKeywords: [
    'machine learning',
    'deep learning',
    'neural',
    'transformer',
    'attention',
    'embedding',
    'token',
    'gradient',
    'loss',
    'activation',
    'backpropagation',
    'logic',
    'proof',
    'set theory',
    'model theory',
    'mathematics',
    'calculus',
    'optimization',
  ],
  downrankKeywords: [
    'finance',
    'financial',
    'contract for difference',
    'options contract',
    'forward contract',
    'spot price',
    'premium',
    'strike price',
    'expiration date',
    'biology',
    'biological',
    'synapse',
    'membrane potential',
    'ion channels',
    'electrochemical',
    'sodium-potassium',
    'psychology',
    'antecedent stimulus',
  ],
};

function hasKeyword(topic: string, keywords: string[]) {
  const text = topic.toLowerCase();
  return keywords.some((k) => text.includes(k));
}

export function focusPriority(topic: string, currentPriority: number) {
  if (topic.startsWith('Reinforce:')) {
    const clean = topic.replace(/^Reinforce:\s*/i, '');

    if (hasKeyword(clean, FOCUS_CONFIG.downrankKeywords)) return 15;
    if (hasKeyword(clean, FOCUS_CONFIG.boostKeywords)) return Math.max(currentPriority, 160);

    return Math.max(currentPriority, 120);
  }

  if (hasKeyword(topic, FOCUS_CONFIG.downrankKeywords)) {
    return Math.min(currentPriority, 25);
  }

  if (hasKeyword(topic, FOCUS_CONFIG.boostKeywords)) {
    return Math.max(currentPriority, 130);
  }

  return currentPriority;
}
