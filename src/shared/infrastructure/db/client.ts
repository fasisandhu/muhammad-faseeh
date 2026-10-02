import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import type { Database } from './context.js';

export interface DatabaseHandle {
  db: Database;
  pool: pg.Pool;
  ping(): Promise<void>;
  close(): Promise<void>;
}

export function createDatabase(url: string, poolMax: number): DatabaseHandle {
  const pool = new pg.Pool({
    connectionString: url,
    max: poolMax,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 5_000,
    idle_in_transaction_session_timeout: 10_000,
    application_name: 'ggi-api',
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
