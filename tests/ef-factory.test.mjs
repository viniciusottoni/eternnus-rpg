import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const sourceRoot = resolve(import.meta.dirname, '../apps/Eternnus.Web');

async function sourceFiles(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && !['bin', 'obj'].includes(entry.name)) {
      result.push(...await sourceFiles(join(directory, entry.name)));
    } else if (entry.isFile() && entry.name.endsWith('.cs')) {
      result.push(join(directory, entry.name));
    }
  }
  return result;
}

test('EF tooling has exactly one design-time factory for GameDb', async () => {
  const factories = [];
  for (const file of await sourceFiles(sourceRoot)) {
    const code = await readFile(file, 'utf8');
    if (/IDesignTimeDbContextFactory\s*<\s*GameDb\s*>/.test(code))
      factories.push({ file, code });
  }

  assert.equal(
    factories.length,
    1,
    'Duplicate GameDb design-time factories break dotnet ef migrations bundle.'
  );
  assert.ok(factories[0].file.endsWith('GameDbFactory.cs'));
  assert.match(factories[0].code, /ConnectionStrings__Eternnus/);
  assert.match(factories[0].code, /EF Core production migrations require/);
});
