import OpenAI from 'openai';
import type { AlaiMessage } from '../types';

function envKeys(prefix: string, max = 10) {
  const keys: string[] = [];

  const first = process.env[prefix];
  if (first) keys.push(first);

  for (let i = 2; i <= max; i++) {
    const value = process.env[`${prefix}_${i}`];
    if (value) keys.push(value);
  }

  return keys;
}

const PROVIDER_KEYS = {
  groq: envKeys('GROQ_API_KEY', 10),
  mistral: envKeys('MISTRAL_API_KEY', 10),
  cerebras: envKeys('CEREBRAS_API_KEY', 10),
  sambanova: envKeys('SAMBANOVA_API_KEY', 10),
};

const blocked = new Map<string, number>();

function isBlocked(key: string) {
  const until = blocked.get(key);
  if (!until) return false;
  if (Date.now() >= until) {
    blocked.delete(key);
    return false;
  }
  return true;
}

function pickKeys(keys: string[]) {
  return keys.filter((k) => !isBlocked(k));
}

export type TeacherResult = {
  text: string;
  provider: string;
  model: string;
};

type TeacherCandidate = {
  provider: string;
  model: string;
  apiKey: string;
  baseURL: string;
};

function getTeacherCandidates(): TeacherCandidate[] {
  const out: TeacherCandidate[] = [];

  for (const apiKey of pickKeys(PROVIDER_KEYS.groq)) {
    out.push({
      provider: 'groq',
      model: 'llama-3.3-70b-versatile',
      apiKey,
      baseURL: 'https://api.groq.com/openai/v1',
    });
  }

  for (const apiKey of pickKeys(PROVIDER_KEYS.mistral)) {
    out.push({
      provider: 'mistral',
      model: 'mistral-large-latest',
      apiKey,
      baseURL: 'https://api.mistral.ai/v1',
    });
  }

  for (const apiKey of pickKeys(PROVIDER_KEYS.cerebras)) {
    out.push({
      provider: 'cerebras',
      model: 'llama-3.3-70b',
      apiKey,
      baseURL: 'https://api.cerebras.ai/v1',
    });
  }

  for (const apiKey of pickKeys(PROVIDER_KEYS.sambanova)) {
    out.push({
      provider: 'sambanova',
      model: 'Meta-Llama-3.1-70B-Instruct',
      apiKey,
      baseURL: 'https://api.sambanova.ai/v1',
    });
  }

  return out;
}

async function callOpenAICompatible(args: {
  apiKey: string;
  baseURL: string;
  provider: string;
  model: string;
  messages: AlaiMessage[];
  temperature?: number;
  maxTokens?: number;
}): Promise<TeacherResult> {
  const client = new OpenAI({
    apiKey: args.apiKey,
    baseURL: args.baseURL,
  });

  const res = await client.chat.completions.create({
    model: args.model,
    messages: args.messages,
    temperature: args.temperature ?? 0.7,
    max_tokens: args.maxTokens ?? 2048,
  });

  const text = res.choices[0]?.message?.content || '';
  if (!text.trim()) throw new Error(`${args.provider} empty response`);

  return {
    text,
    provider: args.provider,
    model: args.model,
  };
}

function shouldBlock(err: any) {
  const msg = String(err?.message || '').toLowerCase();
  const status = err?.status || err?.statusCode;

  return (
    status === 401 ||
    status === 403 ||
    status === 404 ||
    status === 429 ||
    msg.includes('rate') ||
    msg.includes('quota') ||
    msg.includes('invalid api key') ||
    msg.includes('no endpoints found') ||
    msg.includes('model') ||
    msg.includes('unauthorized')
  );
}

export async function askTeachers(params: {
  messages: AlaiMessage[];
  temperature?: number;
  maxTokens?: number;
}): Promise<TeacherResult> {
  const candidates = getTeacherCandidates();

  if (!candidates.length) {
    throw new Error('No AI teachers configured');
  }

  let lastError: unknown;

  for (const c of candidates) {
    try {
      return await callOpenAICompatible({
        ...c,
        messages: params.messages,
        temperature: params.temperature,
        maxTokens: params.maxTokens,
      });
    } catch (err: any) {
      lastError = err;

      if (shouldBlock(err)) {
        blocked.set(c.apiKey, Date.now() + 10 * 60 * 1000);
      }

      continue;
    }
  }

  throw lastError || new Error('No available AI teachers');
}

export async function askMultipleTeachers(params: {
  messages: AlaiMessage[];
  temperature?: number;
  maxTokens?: number;
  count?: number;
}): Promise<TeacherResult[]> {
  const candidates = getTeacherCandidates();
  const results: TeacherResult[] = [];

  if (!candidates.length) {
    throw new Error('No AI teachers configured');
  }

  for (const c of candidates) {
    if (results.length >= (params.count || 2)) break;

    try {
      const result = await callOpenAICompatible({
        ...c,
        messages: params.messages,
        temperature: params.temperature,
        maxTokens: params.maxTokens,
      });

      results.push(result);
    } catch (err: any) {
      if (shouldBlock(err)) {
        blocked.set(c.apiKey, Date.now() + 10 * 60 * 1000);
      }

      continue;
    }
  }

  if (!results.length) {
    throw new Error('No available AI teachers');
  }

  return results;
}
