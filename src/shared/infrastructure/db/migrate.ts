import path from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

/** Applies SQL migrations with the owner role. The API itself never runs DDL. */
export async function runMigrations(
  connectionString: string,
  migrationsFolder = path.resolve(process.cwd(), 'migrations'),
): Promise<void> {
  const pool = new pg.Pool({ connectionString, max: 1 });
  try {
    await migrate(drizzle({ client: pool }), { migrationsFolder });
  } finally {
    await pool.end();
  }
}
