import type { MonthlyUsage } from '../entities/monthly-usage.js';
import type { UsagePeriod } from '../value-objects/usage-period.js';

export interface UsageRepository {
  /** Creates the row if missing, then locks it (`SELECT … FOR UPDATE`) for the current transaction. */
  lockForUpdate(userId: string, period: UsagePeriod): Promise<MonthlyUsage>;
  find(userId: string, period: UsagePeriod): Promise<MonthlyUsage | null>;
  save(usage: MonthlyUsage): Promise<void>;
}
