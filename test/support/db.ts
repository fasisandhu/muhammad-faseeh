import pg from 'pg';

export const APP_ROLE = 'ggi_app';
export const APP_ROLE_PASSWORD = 'app-test-password';

export function appUrlFrom(ownerUrl: string): string {
  const url = new URL(ownerUrl);
  url.username = APP_ROLE;
  url.password = APP_ROLE_PASSWORD;
  return url.toString();
}

async function withClient<T>(url: string, work: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

/** Mirrors docker/postgres/init-app-role.sh for the Testcontainers database. Run before migrations. */
export async function provisionAppRole(ownerUrl: string): Promise<void> {
  const owner = new URL(ownerUrl).username;
  const database = new URL(ownerUrl).pathname.slice(1);
  await withClient(ownerUrl, async (client) => {
    await client.query(`CREATE ROLE ${APP_ROLE} LOGIN PASSWORD '${APP_ROLE_PASSWORD}'`);
    await client.query(`GRANT CONNECT ON DATABASE ${database} TO ${APP_ROLE}`);
    await client.query(`GRANT USAGE ON SCHEMA public TO ${APP_ROLE}`);
    await client.query(
      `ALTER DEFAULT PRIVILEGES FOR ROLE ${owner} IN SCHEMA public GRANT SELECT, INSERT, UPDATE ON TABLES TO ${APP_ROLE}`,
    );
    await client.query(
      `ALTER DEFAULT PRIVILEGES FOR ROLE ${owner} IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ${APP_ROLE}`,
    );
  });
}

/** Empties every application table (owner connection; the app role cannot TRUNCATE). */
export async function truncateAll(ownerUrl: string): Promise<void> {
  await withClient(ownerUrl, async (client) => {
    const { rows } = await client.query<{ tablename: string }>(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public'",
    );
    if (rows.length === 0) return;
    const tables = rows.map((row) => `"${row.tablename}"`).join(', ');
    await client.query(`TRUNCATE TABLE ${tables} RESTART IDENTITY CASCADE`);
  });
}
