import type { RandomSource } from '../../src/shared/domain/random.js';

/** Deterministic randomness: returns queued values in order, then the fallback. */
export class SequenceRandomSource implements RandomSource {
  private readonly values: number[];

  constructor(
    values: readonly number[] = [],
    private readonly fallback = 0.5,
  ) {
    this.values = [...values];
  }

  queue(...values: number[]): void {
    this.values.push(...values);
  }

  next(): number {
    return this.values.shift() ?? this.fallback;
  }
}
