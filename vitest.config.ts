import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/unit/**/*.test.ts'],
    environment: 'node',
    testTimeout: 15_000,
    coverage: {
      provider: 'v8',
      include: ['src/modules/*/domain/**/*.ts', 'src/shared/domain/**/*.ts'],
      exclude: ['**/ports/**', '**/*.d.ts'],
      reporter: ['text', 'html', 'lcov'],
      thresholds: { lines: 90, functions: 90, statements: 90, branches: 85 },
    },
  },
});
