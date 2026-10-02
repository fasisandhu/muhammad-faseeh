import { encode } from 'gpt-tokenizer';
import type { Clock } from '../../../shared/domain/clock.js';
import type { IdGenerator } from '../../../shared/domain/ids.js';
import type { RandomSource } from '../../../shared/domain/random.js';
import { sleep } from '../../../shared/infrastructure/system/sleep.js';
import type { LlmClient, LlmCompletion, LlmMessage } from '../domain/ports/llm-client.js';
import { TokenUsage } from '../domain/value-objects/token-usage.js';

/** The subset of OpenAI's Chat Completions response this adapter produces. */
export interface OpenAiChatCompletion {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: { index: number; message: { role: 'assistant'; content: string }; finish_reason: 'stop' }[];
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

export class MockUpstreamError extends Error {
  override readonly name = 'MockUpstreamError';
}

export interface MockOpenAiOptions {
  model: string;
  minLatencyMs: number;
  maxLatencyMs: number;
  failureRate: number;
  random: RandomSource;
  ids: IdGenerator;
  clock: Clock;
}

/** Anti-corruption layer: the OpenAI wire shape never leaves this file. */
export function toLlmCompletion(raw: OpenAiChatCompletion): LlmCompletion {
  const choice = raw.choices[0];
  if (!choice) throw new MockUpstreamError('completion has no choices');
  return {
    id: raw.id,
    model: raw.model,
    content: choice.message.content,
    finishReason: choice.finish_reason,
    usage: TokenUsage.of(raw.usage.prompt_tokens, raw.usage.completion_tokens),
  };
}

function answerFor(question: string, model: string): string {
  const excerpt = question.length > 160 ? `${question.slice(0, 157)}...` : question;
  return (
    `(Mocked ${model} response.) You asked: "${excerpt}". In production this request would go to the OpenAI ` +
    'Chat Completions API; here the answer is generated locally so quota, billing and security behaviour can be ' +
    'exercised without network calls or cost.'
  );
}

/**
 * Simulates OpenAI: random latency (abortable), optional failure injection, real token counts (o200k_base,
 * plus the chat-format overhead of ~4 tokens per message and 3 for the reply priming).
 */
export class MockOpenAiClient implements LlmClient {
  constructor(private readonly options: MockOpenAiOptions) {}

  async complete(request: { messages: readonly LlmMessage[]; signal: AbortSignal }): Promise<LlmCompletion> {
    const { minLatencyMs, maxLatencyMs, random, failureRate } = this.options;
    const latency =
      maxLatencyMs > minLatencyMs
        ? minLatencyMs + Math.floor(random.next() * (maxLatencyMs - minLatencyMs + 1))
        : minLatencyMs;
    await sleep(latency, request.signal);
    if (failureRate > 0 && random.next() < failureRate)
      throw new MockUpstreamError('mocked upstream error (HTTP 503)');
    return toLlmCompletion(this.respond(request.messages));
  }

  respond(messages: readonly LlmMessage[]): OpenAiChatCompletion {
    const question = messages.findLast((message) => message.role === 'user')?.content ?? '';
    const content = answerFor(question, this.options.model);
    const promptTokens =
      messages.reduce((total, message) => total + encode(message.content).length + 4, 0) + 3;
    const completionTokens = encode(content).length;
    return {
      id: `chatcmpl-${this.options.ids.next()}`,
      object: 'chat.completion',
      created: Math.floor(this.options.clock.now().getTime() / 1000),
      model: this.options.model,
      choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: promptTokens + completionTokens,
      },
    };
  }
}
