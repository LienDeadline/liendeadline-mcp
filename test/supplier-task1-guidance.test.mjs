import assert from 'node:assert/strict';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import './mock-runtime.mjs';
const { buildServer } = await import('../src/server.ts');

test('MCP discovery guidance requires the conditional RI mailing confirmation', async () => {
  const server = buildServer({ includeCustomerTools: false });
  const client = new Client({ name: 'offline-task1-guidance', version: '0.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport); await client.connect(clientTransport);
  try {
    const { tools } = await client.listTools();
    const tool = tools.find(item => item.name === 'calculate_supplier_deadlines_v3');
    for (const guidance of [client.getInstructions(), tool.description]) {
      assert.match(guidance, /ri_mailed_within_200_days/);
      assert.match(guidance, /200 days of first delivery/);
      assert.match(guidance, /No, Unknown or omitted/);
      assert.match(guidance, /recording alone/);
    }
  } finally { await client.close(); await server.close(); }
});
