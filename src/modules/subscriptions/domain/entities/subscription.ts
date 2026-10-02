import { InvalidStateError } from '../../../../shared/domain/errors.js';
import { SubscriptionNotActiveError } from '../errors.js';
import { BillingPeriodCalculator } from '../services/billing-period-calculator.js';
import type { Money } from '../value-objects/money.js';
import type { Plan } from '../value-objects/plan.js';
import type { BillingCycle, Tier } from '../value-objects/tier.js';

export type SubscriptionStatus = 'ACTIVE' | 'INACTIVE';
export type InactiveReason = 'PAYMENT_FAILED' | 'CANCELLED' | 'EXPIRED';

export interface SubscriptionProps {
  id: string;
  userId: string;
  tier: Tier;
  billingCycle: BillingCycle;
  maxMessages: number | null;
  usedMessages: number;
  price: Money;
  status: SubscriptionStatus;
  inactiveReason: InactiveReason | null;
  autoRenew: boolean;
  startDate: Date;
  currentPeriodStart: Date;
  endDate: Date;
  renewalDate: Date | null;
  renewalCount: number;
  cancelledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const ms = (date: Date): number => date.getTime();

export class Subscription {
  private constructor(private readonly props: SubscriptionProps) {}

  static purchase(input: {
    id: string;
    userId: string;
    plan: Plan;
    autoRenew: boolean;
    now: Date;
    paymentSucceeded: boolean;
  }): Subscription {
    const { plan, now } = input;
    const endDate = BillingPeriodCalculator.periodEnd(now, plan.billingCycle, 0);
    const active = input.paymentSucceeded;
    return new Subscription({
      id: input.id,
      userId: input.userId,
      tier: plan.tier,
      billingCycle: plan.billingCycle,
      maxMessages: plan.maxMessages,
      usedMessages: 0,
      price: plan.price,
      status: active ? 'ACTIVE' : 'INACTIVE',
      inactiveReason: active ? null : 'PAYMENT_FAILED',
      autoRenew: input.autoRenew,
      startDate: now,
      currentPeriodStart: now,
      endDate,
      renewalDate: active && input.autoRenew ? endDate : null,
      renewalCount: 0,
      cancelledAt: null,
      createdAt: now,
      updatedAt: now,
    });
  }

  static rehydrate(props: SubscriptionProps): Subscription {
    return new Subscription({ ...props });
  }

  get id(): string {
    return this.props.id;
  }
  get userId(): string {
    return this.props.userId;
  }
  get tier(): Tier {
    return this.props.tier;
  }
  get billingCycle(): BillingCycle {
    return this.props.billingCycle;
  }
  get maxMessages(): number | null {
    return this.props.maxMessages;
  }
  get usedMessages(): number {
    return this.props.usedMessages;
  }
  get price(): Money {
    return this.props.price;
  }
  get status(): SubscriptionStatus {
    return this.props.status;
  }
  get inactiveReason(): InactiveReason | null {
    return this.props.inactiveReason;
  }
  get autoRenew(): boolean {
    return this.props.autoRenew;
  }
  get startDate(): Date {
    return this.props.startDate;
  }
  get currentPeriodStart(): Date {
    return this.props.currentPeriodStart;
  }
  get endDate(): Date {
    return this.props.endDate;
  }
  get renewalDate(): Date | null {
    return this.props.renewalDate;
  }
  get renewalCount(): number {
    return this.props.renewalCount;
  }
  get cancelledAt(): Date | null {
    return this.props.cancelledAt;
  }
  get createdAt(): Date {
    return this.props.createdAt;
  }
  get updatedAt(): Date {
    return this.props.updatedAt;
  }

  isUsableAt(now: Date): boolean {
    return (
      this.props.status === 'ACTIVE' &&
      ms(this.props.currentPeriodStart) <= ms(now) &&
      ms(now) < ms(this.props.endDate)
    );
  }

  remainingMessages(): number | null {
    return this.props.maxMessages === null
      ? null
      : Math.max(0, this.props.maxMessages - this.props.usedMessages);
  }

  hasRemainingMessages(): boolean {
    const remaining = this.remainingMessages();
    return remaining === null || remaining > 0;
  }

  consumeMessage(now: Date): void {
    if (!this.isUsableAt(now)) throw new SubscriptionNotActiveError(this.props.id, 'consume a message from');
    if (!this.hasRemainingMessages())
      throw new InvalidStateError('subscription', 'EXHAUSTED', 'consume a message from');
    this.props.usedMessages += 1;
    this.props.updatedAt = now;
  }

  /** Reverses one charge, but only into the period it was taken from. Returns whether anything changed. */
  refundMessage(bundlePeriodStart: Date, now: Date): boolean {
    if (ms(bundlePeriodStart) !== ms(this.props.currentPeriodStart) || this.props.usedMessages === 0)
      return false;
    this.props.usedMessages -= 1;
    this.props.updatedAt = now;
    return true;
  }

  setAutoRenew(enabled: boolean, now: Date): void {
    this.assertActive('change auto-renew on');
    this.props.autoRenew = enabled;
    this.props.renewalDate = enabled ? this.props.endDate : null;
    this.props.updatedAt = now;
  }

  /** Spec §3.3: ends the current cycle now, prevents renewals, keeps history. */
  cancel(now: Date): void {
    this.assertActive('cancel');
    this.props.status = 'INACTIVE';
    this.props.inactiveReason = 'CANCELLED';
    this.props.cancelledAt = now;
    this.props.endDate = ms(now) < ms(this.props.currentPeriodStart) ? this.props.currentPeriodStart : now;
    this.props.autoRenew = false;
    this.props.renewalDate = null;
    this.props.updatedAt = now;
  }

  isDueForRenewal(now: Date): boolean {
    return (
      this.props.status === 'ACTIVE' &&
      this.props.autoRenew &&
      this.props.renewalDate !== null &&
      ms(this.props.renewalDate) <= ms(now)
    );
  }

  isDueForExpiry(now: Date): boolean {
    return this.props.status === 'ACTIVE' && !this.props.autoRenew && ms(this.props.endDate) <= ms(now);
  }

  applyRenewal(paymentSucceeded: boolean, now: Date): void {
    if (!this.isDueForRenewal(now)) throw new InvalidStateError('subscription', this.props.status, 'renew');
    if (paymentSucceeded) {
      const nextIndex = this.props.renewalCount + 1;
      this.props.currentPeriodStart = this.props.endDate;
      this.props.endDate = BillingPeriodCalculator.periodEnd(
        this.props.startDate,
        this.props.billingCycle,
        nextIndex,
      );
      this.props.renewalCount = nextIndex;
      this.props.usedMessages = 0;
      this.props.renewalDate = this.props.endDate;
    } else {
      this.props.status = 'INACTIVE';
      this.props.inactiveReason = 'PAYMENT_FAILED';
      this.props.renewalDate = null;
    }
    this.props.updatedAt = now;
  }

  expire(now: Date): void {
    if (!this.isDueForExpiry(now)) throw new InvalidStateError('subscription', this.props.status, 'expire');
    this.props.status = 'INACTIVE';
    this.props.inactiveReason = 'EXPIRED';
    this.props.updatedAt = now;
  }

  private assertActive(action: string): void {
    if (this.props.status !== 'ACTIVE') throw new SubscriptionNotActiveError(this.props.id, action);
  }
}
