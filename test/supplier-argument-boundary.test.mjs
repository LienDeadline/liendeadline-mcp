import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

registerHooks({ resolve(specifier, context, nextResolve) {
  const fromSource = /\/src\/[\w-]+\.ts$/.test(context.parentURL ?? '');
  return nextResolve(fromSource && /^\.\/[\w-]+\.js$/.test(specifier) ? specifier.replace(/\.js$/, '.ts') : specifier, context);
} });
const { buildServer } = await import('../src/server.ts');
const args = { state: 'FL', first_delivery_date: '2026-08-03', last_delivery_date: '2026-09-10',
  project_type: 'commercial', hired_by: 'subcontractor', deliveries_complete: true,
  florida_final_payment_status: 'no', florida_termination_status: 'no' };

async function withClient(run) {
  const server = buildServer({ includeCustomerTools: true, customerApiKey: `ld_live_${'0'.repeat(32)}.${'A'.repeat(43)}` });
  const client = new Client({ name: 'supplier-argument-boundary-test', version: '0.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try { await server.connect(serverTransport); await client.connect(clientTransport); await run(client); }
  finally { await client.close(); await server.close(); }
}

for (const [field, value] of [['special_events_reviewed', true], ['special_events_reviewed', false], ['invoice_date', '2026-08-03']]) {
  test(`supplier MCP rejects unsupported ${field}=${value} before requesting a calculation`, async t => {
    const fetch = t.mock.method(globalThis, 'fetch', async () => Response.json({}));
    await withClient(async client => {
      const result = await client.callTool({ name: 'calculate_supplier_deadlines', arguments: { ...args, [field]: value } });
      assert.equal(fetch.mock.callCount(), 0);
      assert.equal(result.isError, true);
      assert.match(result.content[0].text, new RegExp(field));
      if (field === 'special_events_reviewed') assert.match(result.content[0].text, /answer the Florida or Kansas event questions explicitly/);
    });
  });
}

test('supplier MCP keeps all valid arguments and result fields unchanged', async t => {
  const inputs = { contract_version: 'supplier-events-v2', ...args };
  const deadline = { name: 'Synthetic', deadline: '2026-10-01', days_from_now: 30, required: true,
    status: 'calculated', description: 'Synthetic, no legal calculation.' };
  const response = { contract_version: 'supplier-events-v2', status: 'calculated', state_code: 'FL', role: 'supplier',
    inputs, preliminary_notice: deadline, lien_filing: deadline, critical_warnings: [], statute_citations: [], disclaimer: 'Synthetic.' };
  const fetch = t.mock.method(globalThis, 'fetch', async (_url, init) => {
    assert.deepEqual(JSON.parse(init.body), inputs);
    return Response.json(response);
  });
  await withClient(async client => {
    const result = await client.callTool({ name: 'calculate_supplier_deadlines', arguments: args });
    assert.notEqual(result.isError, true);
    assert.deepEqual(JSON.parse(result.content[0].text), response);
    assert.equal(fetch.mock.callCount(), 1);
  });
});
