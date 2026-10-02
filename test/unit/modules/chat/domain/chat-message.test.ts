import { describe, expect, it } from 'vitest';
import { InvalidStateError } from '../../../../../src/shared/domain/errors.js';
import { ChatMessage } from '../../../../../src/modules/chat/domain/entities/chat-message.js';
import { Question } from '../../../../../src/modules/chat/domain/value-objects/question.js';
import { freeCharge } from '../../../../../src/modules/chat/domain/value-objects/quota-charge.js';
import { TokenUsage } from '../../../../../src/modules/chat/domain/value-objects/token-usage.js';
import { UsagePeriod } from '../../../../../src/modules/chat/domain/value-objects/usage-period.js';

const reserve = () =>
  ChatMessage.reserve({
    id: 'm-1',
    userId: 'u-1',
    question: Question.create('What is DPoP?'),
    charge: freeCharge(UsagePeriod.parse('2026-10')),
    requestId: 'req-12345678',
    createdAt: new Date('2026-10-15T12:00:00.000Z'),
  });

describe('ChatMessage', () => {
  it('starts as a pending reservation', () => {
    const message = reserve();
    expect(message.status).toBe('PENDING');
    expect(message.answer).toBeNull();
  });

  it('exposes its reservation details through getters', () => {
    const message = reserve();
    expect(message).toMatchObject({
      id: 'm-1',
      userId: 'u-1',
      requestId: 'req-12345678',
      model: null,
      tokenUsage: null,
      failureCode: null,
      completedAt: null,
      latencyMs: null,
      createdAt: new Date('2026-10-15T12:00:00.000Z'),
    });
    expect(message.question.value).toBe('What is DPoP?');
    expect(message.charge.period.value).toBe('2026-10');
  });

  it('completes with answer, model, token usage and latency', () => {
    const message = reserve();
    message.complete({
      answer: 'Proof of possession.',
      model: 'gpt-4o-mini',
      tokenUsage: TokenUsage.of(10, 5),
      completedAt: new Date('2026-10-15T12:00:00.750Z'),
    });
    expect(message.status).toBe('COMPLETED');
    expect(message.tokenUsage?.totalTokens).toBe(15);
    expect(message.latencyMs).toBe(750);
  });

  it('fails with a code and cannot change afterwards', () => {
    const message = reserve();
    message.fail('LLM_TIMEOUT', new Date('2026-10-15T12:00:08.000Z'));
    expect(message.status).toBe('FAILED');
    expect(message.failureCode).toBe('LLM_TIMEOUT');
    expect(() => {
      message.complete({
        answer: 'late',
        model: 'm',
        tokenUsage: TokenUsage.of(1, 1),
        completedAt: new Date(),
      });
    }).toThrow(InvalidStateError);
    expect(() => {
      message.fail('AGAIN', new Date());
    }).toThrow(InvalidStateError);
  });

  it('handles clock skew with negative latency', () => {
    const message = reserve();
    message.complete({
      answer: 'answer',
      model: 'model',
      tokenUsage: TokenUsage.of(1, 1),
      completedAt: new Date('2026-10-15T11:59:59.000Z'), // before createdAt
    });
    expect(message.latencyMs).toBe(0); // Math.max(0, negative) = 0
  });

  it('handles rehydration of completed message', () => {
    const message = ChatMessage.rehydrate({
      id: 'm-2',
      userId: 'u-2',
      question: Question.create('test'),
      status: 'COMPLETED',
      charge: freeCharge(UsagePeriod.parse('2026-10')),
      answer: 'complete',
      model: 'gpt-4',
      tokenUsage: TokenUsage.of(5, 10),
      failureCode: null,
      requestId: 'req-2',
      createdAt: new Date('2026-10-15T12:00:00.000Z'),
      completedAt: new Date('2026-10-15T12:00:01.000Z'),
      latencyMs: 1000,
    });
    expect(message.status).toBe('COMPLETED');
    expect(message.answer).toBe('complete');
    expect(message.tokenUsage?.totalTokens).toBe(15);
  });
});
