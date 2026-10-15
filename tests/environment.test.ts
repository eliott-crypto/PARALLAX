import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadEnvironment } from '../server/environment';

test('an empty local environment template cannot mask a configured value', () => {
  const directory = mkdtempSync(join(tmpdir(), 'parallax-env-'));
  const original = process.env.PARALLAX_TEST_CONFIGURATION;
  try {
    delete process.env.PARALLAX_TEST_CONFIGURATION;
    writeFileSync(join(directory, '.env.local'), 'PARALLAX_TEST_CONFIGURATION=\n');
    writeFileSync(join(directory, '.env'), 'PARALLAX_TEST_CONFIGURATION=fixture-value\n');
    loadEnvironment(directory);
    assert.equal(process.env.PARALLAX_TEST_CONFIGURATION, 'fixture-value');
    process.env.PARALLAX_TEST_CONFIGURATION = 'deployment-value';
    loadEnvironment(directory);
    assert.equal(process.env.PARALLAX_TEST_CONFIGURATION, 'deployment-value');
  } finally {
    if (original === undefined) delete process.env.PARALLAX_TEST_CONFIGURATION;
    else process.env.PARALLAX_TEST_CONFIGURATION = original;
    rmSync(directory, { recursive: true, force: true });
  }
});
