import { AsyncLocalStorage } from 'node:async_hooks';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { TransactionManager } from '../../application/transaction.js';

export type Database = NodePgDatabase;
export type DbTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];
export type DbExecutor = Database | DbTransaction;

/**
 * Ambient transactions: run() opens a transaction and stores it in AsyncLocalStorage, so every repository
 * call inside the callback (in any module) uses the same connection. Nested run() calls join it.
 */
export class DbContext implements TransactionManager {
  private readonly storage = new AsyncLocalStorage<DbTransaction>();

  constructor(readonly db: Database) {}

  executor(): DbExecutor {
    return this.storage.getStore() ?? this.db;
  }

  isInTransaction(): boolean {
    return this.storage.getStore() !== undefined;
  }

  run<T>(work: () => Promise<T>): Promise<T> {
    if (this.storage.getStore()) return work();
    return this.db.transaction((tx) => this.storage.run(tx, work));
  }
}
