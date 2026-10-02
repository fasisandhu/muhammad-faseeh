import { DomainError, NotFoundError } from '../../../shared/domain/errors.js';

export class SubscriptionNotFoundError extends NotFoundError {
  constructor(id: string) {
    super('Subscription', id);
  }
}

export class SubscriptionNotActiveError extends DomainError<{ subscriptionId: string; action: string }> {
  constructor(subscriptionId: string, action: string) {
    super('SUBSCRIPTION_NOT_ACTIVE', `Cannot ${action} an inactive subscription.`, {
      subscriptionId,
      action,
    });
  }
}

export class PaymentFailedError extends DomainError<{ subscriptionId: string; reason: string }> {
  constructor(subscriptionId: string, reason: string) {
    super('PAYMENT_FAILED', 'The payment was declined, so the subscription is inactive.', {
      subscriptionId,
      reason,
    });
  }
}
