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
const key = `ld_live_${'0'.repeat(32)}.${'A'.repeat(43)}`;
const required = { state: 'TX', invoice_date: '2026-07-01' };

async function withClient(run) {
  const server = buildServer({ includeCustomerTools: true, customerApiKey: key });
  const client = new Client({ name: 'invoice-argument-boundary-test', version: '0.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try { await server.connect(serverTransport); await client.connect(clientTransport); await run(client); }
  finally { await client.close(); await server.close(); }
}

test('invoice MCP schema advertises its complete supported argument boundary', async () => {
  await withClient(async client => {
    const { tools } = await client.listTools();
    const { inputSchema } = tools.find(tool => tool.name === 'calculate_lien_deadline');
    assert.equal(inputSchema.additionalProperties, false);
    assert.deepEqual(Object.keys(inputSchema.properties).sort(), ['invoice_date', 'notice_date', 'project_type', 'role', 'state']);
    assert.deepEqual(inputSchema.required.sort(), ['invoice_date', 'state']);
  });
});

for (const [field, value] of [
  ['noticeDate', '2026-07-12'],
  ['projectType', 'residential'],
  ['first_delivery_date', 'private-unsupported-value'],
]) {
  test(`invoice MCP rejects unsupported ${field} before requesting a billable calculation`, async t => {
    const fetch = t.mock.method(globalThis, 'fetch', async () => Response.json({ data: required }));
    await withClient(async client => {
      const result = await client.callTool({ name: 'calculate_lien_deadline', arguments: { ...required, [field]: value } });
      assert.equal(fetch.mock.callCount(), 0);
      assert.equal(result.isError, true);
      assert.match(result.content[0].text, new RegExp(field));
      assert.equal(JSON.stringify(result).includes(value), false);
      assert.equal(JSON.stringify(result).includes(key), false);
    });
  });
}

for (const optional of [{}, { project_type: 'Residential', notice_date: '2026-07-12', role: 'contractor' }]) {
  test(`invoice MCP preserves ${Object.keys(optional).length ? 'all optional' : 'required-only'} inputs and result fields`, async t => {
    const args = { ...required, ...optional };
    const before = structuredClone(args);
    const body = { ...args, ...(optional.project_type ? { project_type: 'residential' } : {}) };
    const response = {
      ...required, project_type: optional.project_type ? 'residential' : 'commercial',
      preliminary_notice_deadline: '2026-07-20', lien_deadline: '2026-10-01', waiver_due_date: null,
      prelim_deadline_days: 19, lien_deadline_days: 92, warnings: ['Synthetic fixture'], notes: 'Not a legal calculation.',
    };
    const fetch = t.mock.method(globalThis, 'fetch', async (url, init) => {
      assert.equal(url, 'https://secure-api-v1.liendeadline.com/api/v1/calculate-deadline');
      assert.equal(init.headers.Authorization, `Bearer ${key}`);
      assert.deepEqual(JSON.parse(init.body), body);
      return Response.json({ data: response });
    });
    await withClient(async client => {
      const result = await client.callTool({ name: 'calculate_lien_deadline', arguments: args });
      assert.notEqual(result.isError, true);
      const { disclaimer, ...actual } = JSON.parse(result.content[0].text);
      assert.deepEqual(actual, response);
      assert.match(disclaimer, /Not legal advice/);
      assert.equal(fetch.mock.callCount(), 1);
      assert.equal(JSON.stringify(result).includes(key), false);
      assert.deepEqual(args, before);
    });
  });
}
