import { InvalidStateError, ValidationError } from '../../../../shared/domain/errors.js';
import type { QuotaCharge } from '../value-objects/quota-charge.js';
import type { UsagePeriod } from '../value-objects/usage-period.js';

export interface MonthlyUsageProps {
  userId: string;
  period: UsagePeriod;
  freeUsed: number;
  paidUsed: number;
  totalTokens: number;
}

/** Per-user, per-month usage. The repository row lock on this aggregate serialises quota decisions. */
export class MonthlyUsage {
  private constructor(private readonly props: MonthlyUsageProps) {}

  static start(userId: string, period: UsagePeriod): MonthlyUsage {
    return new MonthlyUsage({ userId, period, freeUsed: 0, paidUsed: 0, totalTokens: 0 });
  }

  static rehydrate(props: MonthlyUsageProps): MonthlyUsage {
    return new MonthlyUsage({ ...props });
  }

  get userId(): string {
    return this.props.userId;
  }
  get period(): UsagePeriod {
    return this.props.period;
  }
  get freeUsed(): number {
    return this.props.freeUsed;
  }
  get paidUsed(): number {
    return this.props.paidUsed;
  }
  get totalTokens(): number {
    return this.props.totalTokens;
  }

  freeRemaining(limit: number): number {
    return Math.max(0, limit - this.props.freeUsed);
  }

  hasFreeRemaining(limit: number): boolean {
    return this.freeRemaining(limit) > 0;
  }

  consumeFree(limit: number): void {
    if (!this.hasFreeRemaining(limit)) {
      throw new InvalidStateError('monthly usage', 'FREE_QUOTA_EXHAUSTED', 'consume a free message from');
    }
    this.props.freeUsed += 1;
  }

  recordPaid(): void {
    this.props.paidUsed += 1;
  }

  refund(charge: QuotaCharge): void {
    if (!charge.period.equals(this.props.period)) {
      throw new InvalidStateError(
        'monthly usage',
        this.props.period.value,
        `refund a ${charge.period.value} charge on`,
      );
    }
    if (charge.kind === 'FREE') {
      this.props.freeUsed = Math.max(0, this.props.freeUsed - 1);
    } else {
      this.props.paidUsed = Math.max(0, this.props.paidUsed - 1);
    }
  }

  addTokens(count: number): void {
    if (!Number.isInteger(count) || count < 0)
      throw new ValidationError('tokens', 'must be a non-negative integer');
    this.props.totalTokens += count;
  }
}
