import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: ['./src/shared/infrastructure/db/users-table.ts', './src/modules/*/repositories/schema.ts'],
  out: './migrations',
  strict: true,
  verbose: true,
});
