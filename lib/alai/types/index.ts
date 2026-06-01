export type AlaiRole = 'system' | 'user' | 'assistant';

export type AlaiMessage = {
  role: AlaiRole;
  content: string;
};

export type AlaiProvider =
  | 'groq'
  | 'gemini'
  | 'cerebras'
  | 'sambanova'
  | 'hf'
  | 'mistral'
  | 'openrouter'
  | 'cloudflare';

export type AlaiChatInput = {
  message: string;
  history?: AlaiMessage[];
  userId?: string;
};

export type AlaiChatResult = {
  answer: string;
  provider: string;
  model: string;
  confidence: number;
  usedMemory?: {
    title: string;
    score: number;
  }[];

  learningTriggered?: boolean;
};

export type AlaiKnowledgeUnit = {
  id: string;
  title: string;
  summary: string;
  explanation: string;
  examples: string[];
  commonMistakes: string[];
  relatedConcepts: string[];
  sources: string[];
  confidence: number;
  createdAt: number;
  updatedAt: number;
};

export type AlaiLearningJobStatus = 'pending' | 'running' | 'completed' | 'failed';

export type AlaiLearningJob = {
  id: string;
  topic: string;
  priority: number;
  status: AlaiLearningJobStatus;
  createdAt: number;
  updatedAt: number;
};
