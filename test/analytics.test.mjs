import assert from 'node:assert/strict';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import './mock-runtime.mjs';
import { createHostedAnalytics, privacyFilter } from '../src/analytics.ts';

const { buildServer } = await import('../src/server.ts');
const ENV = {
  POSTHOG_ENABLED: 'true', POSTHOG_PROJECT_TOKEN: `phc_${'A'.repeat(24)}`,
  POSTHOG_HOST: 'https://us.i.posthog.com', POSTHOG_ENVIRONMENT: 'test',
};

async function withServer(analytics, run) {
  const server = buildServer({ includeCustomerTools: false });
  analytics?.instrument(server);
  const client = new Client({ name: 'codex/private-customer@example.com', version: 'sensitive-version' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    return await run(client);
  } finally {
    await client.close();
    await server.close();
    await analytics?.shutdown();
  }
}

test('analytics requires explicit valid configuration and bounds its collector', async () => {
  let options;
  let clients = 0;
  const factory = (token, config) => {
    clients++;
    assert.equal(token, ENV.POSTHOG_PROJECT_TOKEN);
    options = config;
    return { on() {}, capture() {}, async shutdown(timeout) { assert.equal(timeout, 3000); throw new Error('Collector unavailable'); } };
  };
  for (const overrides of [
    { POSTHOG_ENABLED: undefined }, { POSTHOG_ENABLED: 'false' }, { POSTHOG_PROJECT_TOKEN: 'secret-invalid' },
    { POSTHOG_HOST: 'https://collector.example.com' }, { POSTHOG_ENVIRONMENT: '' },
  ]) assert.equal(createHostedAnalytics('0.4.2', { ...ENV, ...overrides }, factory), undefined);
  assert.equal(clients, 0);
  const analytics = createHostedAnalytics('0.4.2', ENV, factory);
  assert.equal(clients, 1);
  assert.equal(options.maxQueueSize, 1000);
  assert.equal(options.requestTimeout, 2000);
  assert.equal(options.fetchRetryCount, 0);
  assert.equal(options.disableGeoip, true);
  await analytics.shutdown();
});

test('privacy filter reconstructs native events without identity, project facts or error details', async () => {
  const filter = privacyFilter('test', '0.4.2');
  const raw = {
    event: '$mcp_tool_call', distinct_id: 'private-user', timestamp: new Date().toISOString(), type: 'capture',
    properties: {
      $mcp_tool_name: 'calculate_supplier_deadlines', $mcp_is_error: true, $mcp_duration_ms: 12,
      $mcp_client_name: 'claude-code/private@example.com', $mcp_client_version: 'private-version',
      $mcp_parameters: { invoice_date: '2030-01-15', api_key: 'private-token' },
      $mcp_response: 'private-project', $mcp_intent: 'private-goal', $mcp_error_message: 'private-error',
      $session_id: 'private-session', $groups: { account: 'private-account' }, $set: { email: 'private@example.com' },
      $ip: '203.0.113.10', request_headers: { Authorization: 'private-key' },
    },
  };
  const first = await filter(raw);
  const second = await filter(raw);
  assert.notEqual(first.distinct_id, raw.distinct_id);
  assert.notEqual(first.distinct_id, second.distinct_id);
  assert.equal(first.properties.$mcp_client_name, 'claude-code');
  assert.equal(first.properties.$mcp_is_error, true);
  assert.equal(first.properties.$mcp_duration_ms, 12);
  assert.equal(first.properties.$process_person_profile, false);
  assert.equal(first.properties.$geoip_disable, true);
  assert.doesNotMatch(JSON.stringify(first), /private|203\.0\.113|2030-01-15/);
  assert.equal(await filter({ ...raw, event: '$identify' }), null);
  assert.equal(await filter({ ...raw, event: '$exception' }), null);
  assert.equal(await filter({ ...raw, properties: { ...raw.properties, $mcp_tool_name: 'private-tool-name' } }), null);
});

test('native SDK preserves schemas and results and emits sanitized success/error events once', async () => {
  const originalTools = await withServer(undefined, async client => (await client.listTools()).tools);
  const events = [];
  const analytics = createHostedAnalytics('0.4.2', ENV, () => ({
    on() {}, capture(event) { events.push(event); }, async shutdown() {},
  }));
  await withServer(analytics, async client => {
    assert.deepEqual((await client.listTools()).tools, originalTools);
    const guide = await client.callTool({ name: 'get_state_lien_guide', arguments: { state: 'TX' } });
    assert.notEqual(guide.isError, true);
    assert.equal(guide.content.length, 1);
    assert.equal(JSON.parse(guide.content[0].text).state_code, 'TX');
    const review = await client.callTool({ name: 'calculate_supplier_deadlines', arguments: {
      state: 'FL', first_delivery_date: '2026-08-03', last_delivery_date: '2026-09-10',
      project_type: 'commercial', hired_by: 'subcontractor', deliveries_complete: true,
    } });
    assert.notEqual(review.isError, true);
    assert.equal(JSON.parse(review.content[0].text).status, 'review_required');
    const failure = await client.callTool({ name: 'calculate_supplier_deadlines', arguments: {
      state: 'FL', first_delivery_date: '2026-08-03',
      project_type: 'commercial', hired_by: 'subcontractor', deliveries_complete: true,
    } });
    assert.equal(failure.isError, true);
    await new Promise(resolve => setImmediate(resolve));
  });
  const calls = events.filter(event => event.event === '$mcp_tool_call');
  assert.equal(calls.length, 3);
  assert.deepEqual(calls.map(event => event.properties.$mcp_is_error), [false, false, true]);
  assert.ok(calls.every(event => Number.isFinite(event.properties.$mcp_duration_ms)));
  assert.equal(new Set(events.map(event => event.distinctId)).size, events.length);
  assert.doesNotMatch(JSON.stringify(events), /private|sensitive-version|2026-08-03|review_required|last_delivery_date|\$session_id|\$mcp_parameters|\$mcp_response/);
});
