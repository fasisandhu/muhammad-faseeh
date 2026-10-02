/** Runs work atomically. Nested calls join the outer transaction. */
export interface TransactionManager {
  run<T>(work: () => Promise<T>): Promise<T>;
}
