import { encode } from 'gpt-tokenizer';
import { describe, expect, it } from 'vitest';
import {
  MockOpenAiClient,
  MockUpstreamError,
} from '../../../../src/modules/chat/infrastructure/mock-openai-client.js';
import { FakeClock } from '../../../support/fake-clock.js';
import { SequenceRandomSource } from '../../../support/sequence-random.js';

const make = (overrides: Partial<ConstructorParameters<typeof MockOpenAiClient>[0]> = {}) =>
  new MockOpenAiClient({
    model: 'gpt-4o-mini',
    minLatencyMs: 0,
    maxLatencyMs: 0,
    failureRate: 0,
    random: new SequenceRandomSource(),
    ids: { next: () => 'abc123' },
    clock: new FakeClock(),
    ...overrides,
  });

const messages = [
  { role: 'system' as const, content: 'Be concise.' },
  { role: 'user' as const, content: 'What is retrieval-augmented generation?' },
];

describe('MockOpenAiClient', () => {
  it('answers in the OpenAI chat.completion shape, mapped to the domain type', async () => {
    const client = make();
    const raw = client.respond(messages);
    expect(raw).toMatchObject({ id: 'chatcmpl-abc123', object: 'chat.completion', model: 'gpt-4o-mini' });
    expect(raw.choices[0]?.finish_reason).toBe('stop');
    const completion = await client.complete({ messages, signal: new AbortController().signal });
    expect(completion.content).toContain('What is retrieval-augmented generation?');
    expect(completion.usage.completionTokens).toBe(encode(completion.content).length);
    expect(completion.usage.promptTokens).toBeGreaterThan(encode(messages[1]!.content).length);
    expect(completion.usage.totalTokens).toBe(
      completion.usage.promptTokens + completion.usage.completionTokens,
    );
  });

  it('can be aborted while "waiting for OpenAI"', async () => {
    const client = make({ minLatencyMs: 5_000, maxLatencyMs: 5_000 });
    const controller = new AbortController();
    const pending = client.complete({ messages, signal: controller.signal });
    controller.abort(new Error('deadline'));
    await expect(pending).rejects.toThrow();
  });

  it('injects upstream failures at the configured rate', async () => {
    const client = make({ failureRate: 1 });
    await expect(client.complete({ messages, signal: new AbortController().signal })).rejects.toBeInstanceOf(
      MockUpstreamError,
    );
  });
});
