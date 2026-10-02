import type { TokenUsage } from '../value-objects/token-usage.js';

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmCompletion {
  id: string;
  model: string;
  content: string;
  finishReason: string;
  usage: TokenUsage;
}

export interface LlmClient {
  complete(request: { messages: readonly LlmMessage[]; signal: AbortSignal }): Promise<LlmCompletion>;
}
