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
const { createHostedAnalytics } = await import('../src/analytics.ts');
const { isSupplierRequestV3 } = await import('../src/supplier-v3.ts');
const { contract_version: _contract, role: _role, ...args } = input;

async function withClient(analyticsEnabled, run, expectedToolCalls = 1) {
  const events = [];
  const analytics = analyticsEnabled ? createHostedAnalytics('test', {
    POSTHOG_ENABLED: 'true', POSTHOG_PROJECT_TOKEN: `phc_${'A'.repeat(24)}`,
    POSTHOG_HOST: 'https://us.i.posthog.com', POSTHOG_ENVIRONMENT: 'test',
  }, () => ({ on() {}, capture(event) { events.push(event); }, async shutdown() {} })) : undefined;
  const server = buildServer({ includeCustomerTools: false, customerApiKey: `ld_live_${'0'.repeat(32)}.${'A'.repeat(43)}` });
  analytics?.instrument(server);
  const client = new Client({ name: 'supplier-v3-argument-boundary-test', version: '0.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    await run(client);
    await new Promise(resolve => setImmediate(resolve));
    if (analyticsEnabled) {
      assert.ok(events.length > 0);
      const calls = events.filter(event => event.event === '$mcp_tool_call');
      assert.equal(calls.length, expectedToolCalls);
      assert.ok(calls.every(event => event.properties.$mcp_tool_name === 'calculate_supplier_deadlines_v3'));
    }
    assert.doesNotMatch(JSON.stringify(events), /private-value-sentinel|private-context-sentinel/);
  } finally { await client.close(); await server.close(); await analytics?.shutdown(); }
}

for (const analyticsEnabled of [false, true]) {
  const mode = analyticsEnabled ? 'with hosted analytics' : 'without analytics';
  const context = analyticsEnabled ? { context: 'private-context-sentinel' } : {};

  for (const [field, value] of [['invoice_date', '2026-06-01'], ['recurring_notices_facts', { kind: 'nh_written_account', accounts: [] }], ['unexpected_fact', 'private-value-sentinel']]) {
    test(`v3 MCP rejects unsupported ${field} before requesting a calculation ${mode}`, async t => {
      assert.equal(isSupplierRequestV3({ ...input, [field]: value }), false);
      const fetch = t.mock.method(globalThis, 'fetch', async () => Response.json(response));
      await withClient(analyticsEnabled, async client => {
        const result = await client.callTool({ name: 'calculate_supplier_deadlines_v3', arguments: { ...args, ...context, [field]: value } });
        assert.equal(fetch.mock.callCount(), 0);
        assert.equal(result.isError, true);
        assert.match(result.content[0].text, new RegExp(field));
        assert.doesNotMatch(result.content[0].text, /private-value-sentinel/);
      });
    });
  }

  test(`v3 discovery schema rejects undeclared top-level arguments ${mode}`, async () => {
    await withClient(analyticsEnabled, async client => {
      const { tools } = await client.listTools();
      const tool = tools.find(tool => tool.name === 'calculate_supplier_deadlines_v3');
      assert.equal(tool.inputSchema.additionalProperties, false);
      assert.deepEqual(Object.keys(tool.inputSchema.properties).filter(key => key !== 'context').sort(), [
        'events', 'hired_by', 'project_type', 'questions_identity', 'recurring_notice_facts', 'rules_source', 'state',
      ]);
      assert.equal(tool.inputSchema.properties.context?.type, analyticsEnabled ? 'string' : undefined);
    }, 0);
  });

  test(`v3 MCP preserves valid arguments and returned facts ${mode}`, async t => {
    const fetch = t.mock.method(globalThis, 'fetch', async (_url, init) => {
      assert.deepEqual(JSON.parse(init.body), input);
      return Response.json(response);
    });
    await withClient(analyticsEnabled, async client => {
      const result = await client.callTool({ name: 'calculate_supplier_deadlines_v3', arguments: { ...args, ...context } });
      assert.notEqual(result.isError, true);
      assert.deepEqual(JSON.parse(result.content[0].text), response);
      assert.equal(fetch.mock.callCount(), 1);
    });
  });
}
