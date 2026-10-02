import pg from 'pg';
import { inject } from 'vitest';

/** Direct SQL with the owner role, for assertions and fixtures only. */
export async function ownerQuery<T extends pg.QueryResultRow = Record<string, unknown>>(
  text: string,
  values: unknown[] = [],
): Promise<T[]> {
  const client = new pg.Client({ connectionString: inject('databaseOwnerUrl') });
  await client.connect();
  try {
    return (await client.query<T>(text, values)).rows;
  } finally {
    await client.end();
  }
}
