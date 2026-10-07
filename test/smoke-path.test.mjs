import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

test('smoke resolves its child entry point in a checkout with URL-encoded characters', () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const checkout = mkdtempSync(join(root, '.smoke path # café-'));
  try {
    mkdirSync(join(checkout, 'src'));
    mkdirSync(join(checkout, 'test'));
    cpSync(join(root, 'src/smoke.ts'), join(checkout, 'src/smoke.ts'));
    cpSync(join(root, 'test/mock-smoke.mjs'), join(checkout, 'test/mock-smoke.mjs'));
    const result = spawnSync(process.execPath, [
      '--experimental-transform-types', '--import', pathToFileURL(join(checkout, 'test/mock-smoke.mjs')).href,
      join(checkout, 'src/smoke.ts'),
    ], {
      env: { LIENDEADLINE_RUN_LIVE_SMOKE: '1' },
      encoding: 'utf8',
      timeout: 10_000,
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /OK/);
  } finally {
    rmSync(checkout, { recursive: true, force: true });
  }
});
