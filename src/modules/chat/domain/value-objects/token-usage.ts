import { ValidationError } from '../../../../shared/domain/errors.js';

const isCount = (value: number): boolean => Number.isInteger(value) && value >= 0;

export class TokenUsage {
  private constructor(
    readonly promptTokens: number,
    readonly completionTokens: number,
  ) {}

  static of(promptTokens: number, completionTokens: number): TokenUsage {
    if (!isCount(promptTokens) || !isCount(completionTokens)) {
      throw new ValidationError('tokenUsage', 'token counts must be non-negative integers');
    }
    return new TokenUsage(promptTokens, completionTokens);
  }

  get totalTokens(): number {
    return this.promptTokens + this.completionTokens;
  }
}
