import { describe, expect, it } from 'vitest';
import { TokenUsage } from '../../../../../src/modules/chat/domain/value-objects/token-usage.js';

describe('TokenUsage', () => {
  it('derives the total', () => {
    const usage = TokenUsage.of(12, 30);
    expect(usage.totalTokens).toBe(42);
  });

  it('rejects negative or fractional counts', () => {
    expect(() => TokenUsage.of(-1, 1)).toThrow();
    expect(() => TokenUsage.of(1.5, 1)).toThrow();
  });
});
