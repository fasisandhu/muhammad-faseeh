// @ts-check
import { existsSync, readdirSync } from 'node:fs';
import { defineConfig } from 'eslint/config';
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import { importX } from 'eslint-plugin-import-x';
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript';
import prettierConfig from 'eslint-config-prettier/flat';
import globals from 'globals';

const MODULES_DIR = 'src/modules';

/** Module folders are discovered at load time so every module gets cross-module rules automatically. */
const moduleNames = existsSync(MODULES_DIR)
  ? readdirSync(MODULES_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  : [];

const crossModuleZones = moduleNames.flatMap((owner) =>
  moduleNames
    .filter((other) => other !== owner)
    .map((other) => ({
      target: `./${MODULES_DIR}/${owner}`,
      from: `./${MODULES_DIR}/${other}`,
      except: ['./index.ts'],
      message: `Module "${owner}" may use module "${other}" only through its public index.ts.`,
    })),
);

const layerZones = [
  {
    target: './src/modules/*/domain/**',
    from: [
      './src/modules/*/application/**',
      './src/modules/*/repositories/**',
      './src/modules/*/infrastructure/**',
      './src/modules/*/controllers/**',
      './src/shared/application/**',
      './src/shared/infrastructure/**',
      './src/shared/http/**',
      './src/modules/*/index.ts',
      './src/modules/*/*.module.ts',
      './src/*.ts',
    ],
    message:
      'Domain code must not depend on application, infrastructure or transport layers, other modules, or composition roots.',
  },
  {
    target: './src/shared/domain/**',
    from: [
      './src/modules/**',
      './src/shared/application/**',
      './src/shared/infrastructure/**',
      './src/shared/http/**',
    ],
    message: 'The shared kernel must not depend on outer layers.',
  },
  {
    target: './src/modules/*/application/**',
    from: [
      './src/modules/*/repositories/**',
      './src/modules/*/infrastructure/**',
      './src/modules/*/controllers/**',
      './src/shared/infrastructure/**',
      './src/shared/http/**',
      './src/modules/*/*.module.ts',
      './src/*.ts',
    ],
    message: 'Use cases depend on domain ports, never on adapters, transport or composition roots.',
  },
  {
    target: './src/shared/application/**',
    from: ['./src/modules/**', './src/shared/infrastructure/**', './src/shared/http/**'],
    message: 'Shared application ports must not depend on outer layers.',
  },
  {
    target: './src/modules/*/controllers/**',
    from: [
      './src/modules/*/repositories/**',
      './src/modules/*/infrastructure/**',
      './src/shared/infrastructure/**',
    ],
    message: 'Controllers call use cases; they never touch repositories or adapters.',
  },
  {
    target: './src/modules/*/repositories/**',
    from: ['./src/modules/*/application/**', './src/modules/*/controllers/**', './src/shared/http/**'],
    message: 'Repositories implement domain ports only.',
  },
  {
    target: './src/modules/*/infrastructure/**',
    from: ['./src/modules/*/controllers/**', './src/shared/http/**'],
    message: 'Adapters must not depend on the transport layer.',
  },
];

const FRAMEWORK_PACKAGES = [
  'express',
  'drizzle-orm',
  'pg',
  'ioredis',
  'rate-limiter-flexible',
  'jose',
  'zod',
  'pino',
  'pino-http',
  'helmet',
  'sanitize-html',
  'openid-client',
];
const frameworkMessage =
  'Framework and infrastructure packages are not allowed in domain or application code.';
const applicationRestrictions = {
  paths: FRAMEWORK_PACKAGES.map((name) => ({ name, message: frameworkMessage })),
  patterns: [
    { group: ['drizzle-orm/*', 'jose/*', 'zod/*', 'node:http', 'node:https'], message: frameworkMessage },
  ],
};
const domainRestrictions = {
  paths: [...FRAMEWORK_PACKAGES, 'lru-cache'].map((name) => ({ name, message: frameworkMessage })),
  patterns: [
    { group: ['drizzle-orm/*', 'jose/*', 'zod/*', 'node:*'], message: 'Domain code is pure TypeScript.' },
  ],
};

export default defineConfig(
  { ignores: ['dist/**', 'coverage/**', 'migrations/**', 'node_modules/**', '.ggi-cli/**'] },
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  importX.flatConfigs.recommended,
  importX.flatConfigs.typescript,
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    settings: {
      'import-x/resolver-next': [
        createTypeScriptImportResolver({ alwaysTryTypes: true, project: './tsconfig.json' }),
      ],
    },
    rules: {
      'no-console': 'error',
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[object.name='sql'][property.name='raw']",
          message: 'sql.raw bypasses parameterisation. Use the query builder or the sql`` template.',
        },
      ],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'import-x/no-cycle': ['error', { maxDepth: 10 }],
      'import-x/no-restricted-paths': ['error', { zones: [...layerZones, ...crossModuleZones] }],
      'import-x/no-named-as-default-member': 'off',
    },
  },
  {
    files: ['src/shared/domain/**/*.ts', 'src/modules/*/domain/**/*.ts'],
    rules: { 'no-restricted-imports': ['error', domainRestrictions] },
  },
  {
    files: ['src/shared/application/**/*.ts', 'src/modules/*/application/**/*.ts'],
    rules: { 'no-restricted-imports': ['error', applicationRestrictions] },
  },
  {
    files: ['cli/**/*.ts', 'scripts/**/*.ts'],
    rules: { 'no-console': 'off' },
  },
  {
    files: ['test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/unbound-method': 'off',
    },
  },
  {
    files: ['**/*.js', '**/*.mjs'],
    extends: [tseslint.configs.disableTypeChecked],
  },
  prettierConfig,
);
