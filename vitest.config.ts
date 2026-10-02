import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/unit/**/*.test.ts'],
    environment: 'node',
    testTimeout: 15_000,
    coverage: {
      provider: 'v8',
      include: ['src/modules/*/domain/**/*.ts', 'src/shared/domain/**/*.ts'],
      // Type-only files (interfaces/type aliases, no runtime code) report 0 % under v8, so they are excluded explicitly.
      exclude: [
        '**/*.d.ts',
        'src/modules/*/domain/ports/**',
        'src/modules/identity/domain/ports.ts',
        'src/modules/identity/domain/verified-token.ts',
        'src/modules/subscriptions/domain/value-objects/payment-kind.ts',
        'src/modules/subscriptions/domain/value-objects/plan.ts',
        'src/shared/domain/auth-context.ts',
        'src/shared/domain/clock.ts',
        'src/shared/domain/ids.ts',
        'src/shared/domain/pagination.ts',
        'src/shared/domain/random.ts',
      ],
      reporter: ['text', 'html', 'lcov'],
      thresholds: { lines: 90, functions: 90, statements: 90, branches: 85 },
    },
  },
});
