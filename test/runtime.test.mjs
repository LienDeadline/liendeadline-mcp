import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const KEY = `ld_live_${'0'.repeat(32)}.${'A'.repeat(43)}`; // Synthetic only.
async function withClient(env, run) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['--experimental-transform-types', '--import', fileURLToPath(new URL('./mock-runtime.mjs', import.meta.url)), fileURLToPath(new URL('../src/index.ts', import.meta.url))],
    env: { LIENDEADLINE_API_URL: 'https://secure-api-v1.liendeadline.com', ...env },
    stderr: 'pipe',
  });
  let stderr = '';
  transport.stderr?.on('data', data => { stderr += data; });
  const client = new Client({ name: 'isolated-contract-test', version: '0.0.0' });
  try {
    await client.connect(transport);
    await run(client);
  } finally {
    await client.close();
    assert.equal(stderr.includes(KEY), false);
  }
}
const text = result => result.content.map(c => c.text ?? '').join('');

test('actual stdio tools use customer key only for protected HTTP calls', async () => {
  await withClient({ LIENDEADLINE_API_KEY: KEY }, async client => {
    const { tools } = await client.listTools();
    assert.equal(tools.length, 4);
    for (const [name, args] of [
      ['calculate_lien_deadline', { state: 'TX', invoice_date: '2026-07-01' }],
      ['list_supported_states', {}], ['get_state_lien_guide', { state: 'TX' }], ['list_state_lien_guides', {}],
    ]) {
      const result = await client.callTool({ name, arguments: args });
      assert.notEqual(result.isError, true);
      assert.equal(text(result).includes(KEY), false);
      assert.ok(JSON.parse(text(result)));
    }
  });
});

test('missing runtime key returns actionable MCP errors while guide tools work', async () => {
  await withClient({ LIENDEADLINE_API_KEY: '' }, async client => {
    for (const [name, args] of [['calculate_lien_deadline', { state: 'TX', invoice_date: '2026-07-01' }], ['list_supported_states', {}]]) {
      const result = await client.callTool({ name, arguments: args });
      assert.equal(result.isError, true);
      assert.match(text(result), /Set LIENDEADLINE_API_KEY/);
    }
    const guide = await client.callTool({ name: 'get_state_lien_guide', arguments: { state: 'TX' } });
    assert.notEqual(guide.isError, true);
  });
});

test('runtime denial is an MCP error without key-bearing upstream body or stderr', async () => {
  await withClient({ LIENDEADLINE_API_KEY: KEY, MCP_TEST_STATUS: '401' }, async client => {
    const result = await client.callTool({ name: 'list_supported_states', arguments: {} });
    assert.equal(result.isError, true);
    assert.match(text(result), /returned 401/);
    assert.equal(text(result).includes(KEY), false);
  });
});


test('live smoke refuses before launching a child without explicit acceptance opt-in', () => {
  const result = spawnSync(process.execPath, ['--experimental-transform-types', fileURLToPath(new URL('../src/smoke.ts', import.meta.url))], {
    env: { LIENDEADLINE_API_KEY: '', LIENDEADLINE_RUN_LIVE_SMOKE: '' }, encoding: 'utf8',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Live smoke requires explicit/);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr.includes(KEY), false);
});

for (const deny of [false, true]) {
  test(`actual smoke launcher forwards only required config and handles ${deny ? 'denial' : 'success'} safely`, () => {
    const result = spawnSync(process.execPath, ['--experimental-transform-types', '--import', fileURLToPath(new URL('./mock-smoke.mjs', import.meta.url)), fileURLToPath(new URL('../src/smoke.ts', import.meta.url))], {
      env: { LIENDEADLINE_API_KEY: KEY, LIENDEADLINE_API_URL: 'https://secure-api-v1.liendeadline.com', LIENDEADLINE_RUN_LIVE_SMOKE: '1', ...(deny ? {MCP_TEST_STATUS: '401'} : {}) },
      encoding: 'utf8',
    });
    assert.equal(result.status === 0, !deny);
    assert.equal(result.stdout.includes(KEY), false);
    assert.equal(result.stderr.includes(KEY), false);
    assert.match(deny ? result.stderr : result.stdout, deny ? /Live smoke tool failed/ : /OK/);
  });
}
