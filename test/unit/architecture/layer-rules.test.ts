import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ESLint } from 'eslint';

const root = path.resolve(import.meta.dirname, '../../..');
const fixture = path.join(root, 'src/modules/__layer_fixture__');
const other = path.join(root, 'src/modules/__other_fixture__');
const rootFixture = path.join(root, 'src/__layer_fixture_main__.ts');

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
    write(path.join(fixture, 'layer.module.ts'), 'export const layerModule = 3;\n');
    write(rootFixture, 'export const main = 4;\n');
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
      path.join(fixture, 'domain/uses-other-index.ts'),
      "import { secret } from '../../__other_fixture__/index.js';\n\nexport const value = secret;\n",
    );
    write(
      path.join(fixture, 'domain/uses-module-file.ts'),
      "import { layerModule } from '../layer.module.js';\n\nexport const value = layerModule;\n",
    );
    write(
      path.join(fixture, 'domain/uses-composition-root.ts'),
      "import { main } from '../../../__layer_fixture_main__.js';\n\nexport const value = main;\n",
    );
    write(
      path.join(fixture, 'application/uses-other-public-api.ts'),
      "import { secret } from '../../__other_fixture__/index.js';\n\nexport const value = secret;\n",
    );
    write(
      path.join(fixture, 'application/uses-module-file.ts'),
      "import { layerModule } from '../layer.module.js';\n\nexport const value = layerModule;\n",
    );
    const eslint = new ESLint({ cwd: root });
    results = await eslint.lintFiles([
      path.join(fixture, 'domain/*.ts'),
      path.join(fixture, 'application/*.ts'),
    ]);
  }, 120_000);

  afterAll(() => {
    rmSync(fixture, { recursive: true, force: true });
    rmSync(other, { recursive: true, force: true });
    rmSync(rootFixture, { force: true });
  });

  /** Throws when the file was never linted, so a `not.toContain` assertion cannot pass vacuously. */
  const rulesFor = (file: string): (string | null)[] => {
    const suffix = path.sep + file.split('/').join(path.sep);
    const result = results.find((r) => r.filePath.endsWith(suffix));
    if (!result) throw new Error(`No lint result for ${file}`);
    return result.messages.map((m) => m.ruleId);
  };

  it('rejects framework imports in the domain layer', () => {
    expect(rulesFor('domain/uses-framework.ts')).toContain('no-restricted-imports');
  });

  it('rejects domain → repository imports', () => {
    expect(rulesFor('domain/uses-repository.ts')).toContain('import-x/no-restricted-paths');
  });

  it("rejects imports of another module's internals", () => {
    expect(rulesFor('domain/uses-other-internals.ts')).toContain('import-x/no-restricted-paths');
  });

  it("rejects domain → another module's index.ts", () => {
    expect(rulesFor('domain/uses-other-index.ts')).toContain('import-x/no-restricted-paths');
  });

  it('rejects domain → its own module composition file (*.module.ts)', () => {
    expect(rulesFor('domain/uses-module-file.ts')).toContain('import-x/no-restricted-paths');
  });

  it('rejects domain → a top-level src composition root', () => {
    expect(rulesFor('domain/uses-composition-root.ts')).toContain('import-x/no-restricted-paths');
  });

  it("allows application → another module's public index.ts", () => {
    expect(rulesFor('application/uses-other-public-api.ts')).not.toContain('import-x/no-restricted-paths');
  });

  it('rejects application → its own module composition file (*.module.ts)', () => {
    expect(rulesFor('application/uses-module-file.ts')).toContain('import-x/no-restricted-paths');
  });
});
