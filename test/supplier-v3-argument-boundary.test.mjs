import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { input, result as response } from './supplier-v3-fixture.mjs';

registerHooks({ resolve(specifier, context, nextResolve) {
  const fromSource = /\/src\/[\w-]+\.ts$/.test(context.parentURL ?? '');
  return nextResolve(fromSource && /^\.\/[\w-]+\.js$/.test(specifier) ? specifier.replace(/\.js$/, '.ts') : specifier, context);
} });
const { buildServer } = await import('../src/server.ts');
const { isSupplierRequestV3 } = await import('../src/supplier-v3.ts');
const { contract_version: _contract, role: _role, ...args } = input;

async function withClient(run) {
  const server = buildServer({ includeCustomerTools: false, customerApiKey: `ld_live_${'0'.repeat(32)}.${'A'.repeat(43)}` });
  const client = new Client({ name: 'supplier-v3-argument-boundary-test', version: '0.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try { await server.connect(serverTransport); await client.connect(clientTransport); await run(client); }
  finally { await client.close(); await server.close(); }
}

for (const [field, value] of [['invoice_date', '2026-06-01'], ['recurring_notices_facts', { kind: 'nh_written_account', accounts: [] }], ['unexpected_fact', 'private-value-sentinel']]) {
  test(`v3 MCP rejects unsupported ${field} before requesting a calculation`, async t => {
    assert.equal(isSupplierRequestV3({ ...input, [field]: value }), false);
    const fetch = t.mock.method(globalThis, 'fetch', async () => Response.json(response));
    await withClient(async client => {
      const result = await client.callTool({ name: 'calculate_supplier_deadlines_v3', arguments: { ...args, [field]: value } });
      assert.equal(fetch.mock.callCount(), 0);
      assert.equal(result.isError, true);
      assert.match(result.content[0].text, new RegExp(field));
      assert.doesNotMatch(result.content[0].text, /private-value-sentinel/);
    });
  });
}

test('v3 discovery schema rejects undeclared top-level arguments', async () => {
  await withClient(async client => {
    const { tools } = await client.listTools();
    const tool = tools.find(tool => tool.name === 'calculate_supplier_deadlines_v3');
    assert.equal(tool.inputSchema.additionalProperties, false);
    assert.deepEqual(Object.keys(tool.inputSchema.properties).sort(), [
      'events', 'hired_by', 'project_type', 'questions_identity', 'recurring_notice_facts', 'rules_source', 'state',
    ]);
  });
});

test('v3 MCP preserves valid arguments and returned facts', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async (_url, init) => {
    assert.deepEqual(JSON.parse(init.body), input);
    return Response.json(response);
  });
  await withClient(async client => {
    const result = await client.callTool({ name: 'calculate_supplier_deadlines_v3', arguments: args });
    assert.notEqual(result.isError, true);
    assert.deepEqual(JSON.parse(result.content[0].text), response);
    assert.equal(fetch.mock.callCount(), 1);
  });
});
