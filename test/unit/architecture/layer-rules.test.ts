import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ESLint } from 'eslint';

const root = path.resolve(import.meta.dirname, '../../..');
const fixture = path.join(root, 'src/modules/__layer_fixture__');
const other = path.join(root, 'src/modules/__other_fixture__');

function write(file: string, content: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
}

describe('ESLint layer rules', () => {
  let results: ESLint.LintResult[] = [];

  beforeAll(async () => {
    write(path.join(fixture, 'repositories/thing.ts'), 'export const thing = 1;\n');
    write(path.join(other, 'domain/secret.ts'), 'export const secret = 2;\n');
    write(path.join(other, 'index.ts'), "export { secret } from './domain/secret.js';\n");
    write(
      path.join(fixture, 'domain/uses-framework.ts'),
      "import express from 'express';\n\nexport const app = express;\n",
    );
    write(
      path.join(fixture, 'domain/uses-repository.ts'),
      "import { thing } from '../repositories/thing.js';\n\nexport const value = thing;\n",
    );
    write(
      path.join(fixture, 'domain/uses-other-internals.ts'),
      "import { secret } from '../../__other_fixture__/domain/secret.js';\n\nexport const value = secret;\n",
    );
    write(
      path.join(fixture, 'domain/uses-other-public-api.ts'),
      "import { secret } from '../../__other_fixture__/index.js';\n\nexport const value = secret;\n",
    );
    const eslint = new ESLint({ cwd: root });
    results = await eslint.lintFiles([path.join(fixture, 'domain/*.ts')]);
  }, 120_000);

  afterAll(() => {
    rmSync(fixture, { recursive: true, force: true });
    rmSync(other, { recursive: true, force: true });
  });

  const rulesFor = (file: string): (string | null)[] =>
    results.find((r) => r.filePath.endsWith(file))?.messages.map((m) => m.ruleId) ?? [];

  it('rejects framework imports in the domain layer', () => {
    expect(rulesFor('uses-framework.ts')).toContain('no-restricted-imports');
  });

  it('rejects domain → repository imports', () => {
    expect(rulesFor('uses-repository.ts')).toContain('import-x/no-restricted-paths');
  });

  it("rejects imports of another module's internals", () => {
    expect(rulesFor('uses-other-internals.ts')).toContain('import-x/no-restricted-paths');
  });

  it("allows another module's public index.ts", () => {
    expect(rulesFor('uses-other-public-api.ts')).not.toContain('import-x/no-restricted-paths');
  });
});
