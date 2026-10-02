import type { Clock } from '../../src/shared/domain/clock.js';

export class FakeClock implements Clock {
  private current: Date;

  constructor(start: Date | string = '2026-10-15T12:00:00.000Z') {
    this.current = new Date(start);
  }

  now(): Date {
    return new Date(this.current);
  }

  set(at: Date | string): void {
    this.current = new Date(at);
  }

  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }

  advanceDays(days: number): void {
    this.advance(days * 86_400_000);
  }
}
