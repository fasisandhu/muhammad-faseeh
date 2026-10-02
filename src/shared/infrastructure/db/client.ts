import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import type { Database } from './context.js';

export interface DatabaseHandle {
  db: Database;
  pool: pg.Pool;
  ping(): Promise<void>;
  close(): Promise<void>;
}

/**
 * `onError` receives errors from idle pooled clients (e.g. Postgres restart). A listener is always attached,
 * because an unhandled pool 'error' event would otherwise crash the process.
 */
export function createDatabase(
  url: string,
  poolMax: number,
  onError?: (error: Error) => void,
): DatabaseHandle {
  const pool = new pg.Pool({
    connectionString: url,
    max: poolMax,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 5_000,
    idle_in_transaction_session_timeout: 10_000,
    application_name: 'ggi-api',
  });
  pool.on('error', (error) => {
    onError?.(error);
  });
  const db = drizzle({ client: pool });
  return {
    db,
    pool,
    ping: async () => {
      await pool.query('SELECT 1');
    },
    close: () => pool.end(),
  };
}
