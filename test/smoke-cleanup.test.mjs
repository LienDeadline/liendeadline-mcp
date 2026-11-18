import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

function runSmoke(env = {}) {
  const result = spawnSync(process.execPath, [
    '--experimental-transform-types', '--import', fileURLToPath(new URL('./mock-smoke.mjs', import.meta.url)),
    fileURLToPath(new URL('../src/smoke.ts', import.meta.url)),
  ], {
    env: { LIENDEADLINE_RUN_LIVE_SMOKE: '1', MCP_TEST_SMOKE_CLOSE: 'ok', ...env },
    encoding: 'utf8', timeout: 10_000,
  });
  assert.equal(result.error, undefined);
  return result;
}

const failures = [
  ['connect', { MCP_TEST_SMOKE_FAILURE: 'connect' }, /Synthetic connection failure/],
  ['discovery', { MCP_TEST_SMOKE_FAILURE: 'list' }, /Synthetic discovery failure/],
  ['tool rejection', { MCP_TEST_SMOKE_FAILURE: 'call' }, /Synthetic tool failure/],
  ['tool error result', { MCP_TEST_STATUS: '503' }, /Live smoke tool failed/],
  ['invalid response JSON', { MCP_TEST_SMOKE_FAILURE: 'json' }, /SyntaxError/],
  ['hosted tool mismatch', { LIENDEADLINE_MCP_URL: 'https://smoke.invalid/mcp' }, /must serve exactly the five public tools/],
];

for (const [name, env, message] of failures) {
  test(`smoke closes the client after ${name} and retains the failure`, () => {
    const result = runSmoke(env);
    assert.notEqual(result.status, 0);
    assert.equal(result.stdout.split('SMOKE_CLIENT_CLOSED').length - 1, 1);
    assert.doesNotMatch(result.stdout, /\nOK/);
    assert.match(result.stderr, message);
  });
}

test('smoke preserves the original failure if closing also fails', () => {
  const result = runSmoke({ MCP_TEST_SMOKE_FAILURE: 'list', MCP_TEST_SMOKE_CLOSE: 'fail' });
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /SMOKE_CLIENT_CLOSED/);
  assert.match(result.stderr, /Error: Synthetic discovery failure/);
  assert.doesNotMatch(result.stderr, /Error: Synthetic close failure/);
});

test('smoke closes once on success before reporting OK', () => {
  const result = runSmoke();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.split('SMOKE_CLIENT_CLOSED').length - 1, 1);
  assert.match(result.stdout, /SMOKE_CLIENT_CLOSED\n\nOK/);
});

test('smoke does not report success when closing fails', () => {
  const result = runSmoke({ MCP_TEST_SMOKE_CLOSE: 'fail' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Error: Synthetic close failure/);
  assert.doesNotMatch(result.stdout, /\nOK/);
});
