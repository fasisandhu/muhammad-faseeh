import type { Logger } from '../../../shared/application/logger.js';
import type { TransactionManager } from '../../../shared/application/transaction.js';
import type { Clock } from '../../../shared/domain/clock.js';
import type { IdGenerator } from '../../../shared/domain/ids.js';
import type { BundleQuotaPort } from '../domain/ports/bundle-quota-port.js';
import type { ChatMessageRepository } from '../domain/ports/chat-message-repository.js';
import type { UsageRepository } from '../domain/ports/usage-repository.js';

/** Lock order everywhere: monthly_usage → subscriptions → chat_messages (spec §4.3). */
export interface ChatDeps {
  tx: TransactionManager;
  usage: UsageRepository;
  messages: ChatMessageRepository;
  bundles: BundleQuotaPort;
  clock: Clock;
  ids: IdGenerator;
  logger: Logger;
}
