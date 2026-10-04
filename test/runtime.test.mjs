import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
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
const SUPPLIER_ARGS = {
  state: 'FL', first_delivery_date: '2026-08-03', last_delivery_date: '2026-09-10',
  project_type: 'commercial', hired_by: 'subcontractor', deliveries_complete: true,
  florida_final_payment_status: 'no', florida_termination_status: 'no',
};

test('actual stdio tools use customer key only for protected HTTP calls', async () => {
  await withClient({ LIENDEADLINE_API_KEY: KEY }, async client => {
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map(t => t.name), [
      'calculate_supplier_deadlines', 'calculate_lien_deadline', 'list_supported_states',
      'get_state_lien_guide', 'list_state_lien_guides',
    ]);
    assert.match(client.getInstructions(), /calculate_lien_deadline and list_supported_states are customer API tools that need LIENDEADLINE_API_KEY/);
    for (const tool of tools) {
      assert.equal(tool.annotations?.readOnlyHint, true);
      assert.equal(tool.annotations?.destructiveHint, false);
      assert.equal(tool.annotations?.title, tool.title);
      // Directory policy: a description says what its tool does, with no instructions about model
      // behavior or other tools. Cross-tool guidance belongs in the server instructions.
      for (const other of tools) {
        if (other.name !== tool.name) assert.equal(tool.description.includes(other.name), false, `${tool.name} mentions ${other.name}`);
      }
      assert.doesNotMatch(tool.description, /\b(?:Use it|Call|Ask|never|Do not)\b/, tool.name);
    }
    assert.match(client.getInstructions(), /use get_state_lien_guide to explain the rules behind a date/);
    const supplierSchema = tools.find(tool => tool.name === 'calculate_supplier_deadlines').inputSchema.properties;
    assert.ok(supplierSchema.florida_final_payment_status);
    assert.ok(supplierSchema.florida_termination_status);
    assert.ok(supplierSchema.kansas_extension_status);
    assert.equal(Object.hasOwn(supplierSchema, 'special_events_reviewed'), false);
    // Directory manifests declare the tool list statically; keep them identical to the server.
    for (const manifest of ['manifest.json', 'well-known/mcp.json']) {
      const declared = JSON.parse(readFileSync(new URL(`../${manifest}`, import.meta.url), 'utf8')).tools.map(t => t.name);
      assert.deepEqual([...declared].sort(), tools.map(t => t.name).sort(), manifest);
    }
    for (const [name, args] of [
      ['calculate_supplier_deadlines', SUPPLIER_ARGS],
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

test('public supplier tool works without a key and returns the verified echo', async () => {
  await withClient({ LIENDEADLINE_API_KEY: '' }, async client => {
    const result = await client.callTool({ name: 'calculate_supplier_deadlines', arguments: SUPPLIER_ARGS });
    assert.notEqual(result.isError, true);
    const body = JSON.parse(text(result));
    assert.equal(body.contract_version, 'supplier-events-v2');
    assert.deepEqual(body.inputs, { contract_version: 'supplier-events-v2', ...SUPPLIER_ARGS });
    assert.equal(body.preliminary_notice.status, 'calculated');
    assert.equal(body.lien_filing.status, 'calculated');
  });
});

test('actual stdio supplier tool keeps unknown events under review without a key', async () => {
  await withClient({ LIENDEADLINE_API_KEY: '' }, async client => {
    const { florida_final_payment_status, florida_termination_status, ...facts } = SUPPLIER_ARGS;
    const result = await client.callTool({ name: 'calculate_supplier_deadlines', arguments: facts });
    assert.notEqual(result.isError, true);
    const body = JSON.parse(text(result));
    assert.equal(body.status, 'review_required');
    assert.equal(body.preliminary_notice.deadline, null);
    assert.equal(body.lien_filing.deadline, null);
    assert.deepEqual(body.inputs, { contract_version: 'supplier-events-v2', ...facts });
  });
});

test('supplier tool returns an actionable MCP error for contradictory facts', async () => {
  await withClient({ LIENDEADLINE_API_KEY: '' }, async client => {
    const { last_delivery_date, ...rest } = SUPPLIER_ARGS;
    const result = await client.callTool({ name: 'calculate_supplier_deadlines', arguments: rest });
    assert.equal(result.isError, true);
    assert.match(text(result), /last_delivery_date is required when deliveries_complete is true/);
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

test('live smoke without a key runs public tools only and never forwards a key', () => {
  const result = spawnSync(process.execPath, ['--experimental-transform-types', '--import', fileURLToPath(new URL('./mock-smoke.mjs', import.meta.url)), fileURLToPath(new URL('../src/smoke.ts', import.meta.url))], {
    env: { LIENDEADLINE_API_URL: 'https://secure-api-v1.liendeadline.com', LIENDEADLINE_RUN_LIVE_SMOKE: '1' },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /calculate_supplier_deadlines FL/);
  assert.match(result.stdout, /customer tools skipped/);
  assert.doesNotMatch(result.stdout, /calculate_lien_deadline TX/);
  assert.match(result.stdout, /OK/);
});
