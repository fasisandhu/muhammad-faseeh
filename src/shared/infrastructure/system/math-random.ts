import type { RandomSource } from '../../domain/random.js';

/** Non-cryptographic randomness for simulations (latency, payment outcomes). */
export class MathRandomSource implements RandomSource {
  next(): number {
    return Math.random();
  }
}
