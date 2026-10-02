import { ValidationError } from '../../../../shared/domain/errors.js';

/** A UTC calendar month. Free quota is counted per period, so a new month starts from zero automatically. */
export class UsagePeriod {
  readonly value: string;

  private constructor(
    readonly year: number,
    readonly month: number,
  ) {
    this.value = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
  }

  static of(date: Date): UsagePeriod {
    return new UsagePeriod(date.getUTCFullYear(), date.getUTCMonth() + 1);
  }

  static parse(value: string): UsagePeriod {
    const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(value);
    if (!match) throw new ValidationError('period', 'expected YYYY-MM');
    return new UsagePeriod(Number(match[1]), Number(match[2]));
  }

  startsAt(): Date {
    return new Date(Date.UTC(this.year, this.month - 1, 1));
  }

  resetsAt(): Date {
    return new Date(Date.UTC(this.year, this.month, 1));
  }

  equals(other: UsagePeriod): boolean {
    return this.value === other.value;
  }
}
