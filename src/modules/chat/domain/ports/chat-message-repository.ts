import type { Page, PageRequest } from '../../../../shared/domain/pagination.js';
import type { ChatMessage } from '../entities/chat-message.js';
import type { UsagePeriod } from '../value-objects/usage-period.js';

export interface UsageMetrics {
  period: string;
  messages: { total: number; free: number; paid: number; failed: number };
  tokens: { prompt: number; completion: number; total: number };
  activeUsers: number;
}

export interface ChatMessageRepository {
  insert(message: ChatMessage): Promise<void>;
  save(message: ChatMessage): Promise<void>;
  findById(id: string): Promise<ChatMessage | null>;
  /** `SELECT … FOR UPDATE SKIP LOCKED`; null when missing or locked by someone else. */
  lockById(id: string): Promise<ChatMessage | null>;
  listByUser(userId: string, page: PageRequest): Promise<Page<ChatMessage>>;
  listAll(filter: { userId?: string }, page: PageRequest): Promise<Page<ChatMessage>>;
  findStalePending(olderThan: Date, limit: number): Promise<ChatMessage[]>;
  usageMetrics(period: UsagePeriod): Promise<UsageMetrics>;
}
