import { runMigrations } from './shared/infrastructure/db/migrate.js';

const url = process.env.DATABASE_MIGRATION_URL;
if (!url) {
  process.stderr.write('DATABASE_MIGRATION_URL is required\n');
  process.exit(1);
}
await runMigrations(url);
process.stdout.write('Migrations applied\n');
