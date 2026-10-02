import type { Clock } from '../../domain/clock.js';

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}
