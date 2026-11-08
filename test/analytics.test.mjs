import assert from 'node:assert/strict';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import './mock-runtime.mjs';
import { createHostedAnalytics, privacyFilter } from '../src/analytics.ts';

process.env.LIENDEADLINE_API_KEY = 'ld_live_' + '0'.repeat(32) + '.' + 'A'.repeat(43);
const { buildServer } = await import('../src/server.ts');
const ENV = {
  POSTHOG_ENABLED: 'true', POSTHOG_PROJECT_TOKEN: `phc_${'A'.repeat(24)}`,
  POSTHOG_HOST: 'https://us.i.posthog.com', POSTHOG_ENVIRONMENT: 'test',
};

async function withServer(analytics, run, options = {}) {
  const server = buildServer({ includeCustomerTools: false, customerApiKey: 'ld_live_' + '0'.repeat(32) + '.' + 'A'.repeat(43), ...options });
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

test('error categories are fixed labels, never arbitrary SDK names or message text', async () => {
  const filter = privacyFilter('test', '0.5.8');
  const classify = async (errorType, message, isError = true) => (await filter({
    event: '$mcp_tool_call', distinct_id: 'private-user', type: 'capture',
    properties: {
      $mcp_tool_name: 'get_state_lien_guide', $mcp_is_error: isError,
      $mcp_error_type: errorType, $mcp_error_message: message,
      $mcp_error_status: 'private-status', $mcp_response: 'private-response',
    },
  })).properties;
  for (const category of ['validation', 'tool', 'handler', 'timeout', 'cancelled', 'unknown',
    'internal', 'api_4xx', 'api_5xx', 'permission', 'rate_limited', 'missing_context']) {
    assert.equal((await classify(category, 'private-error')).$mcp_error_type, category);
  }
  for (const [message, expected] of [
    ['Set LIENDEADLINE_API_KEY to a dedicated customer key. private-key', 'permission'],
    ['LIENDEADLINE_API_KEY must be a dedicated customer key. private-key', 'permission'],
    ['MCP error -32602: Input validation error: private-input', 'validation'],
    ['Invalid supplier request: private-input.', 'validation'],
    ['Invalid supplier scope: private-input.', 'validation'],
    ['Invalid supplier-events-v3 request: private-input.', 'validation'],
    ['Invalid invoice request: private-input.', 'validation'],
    ['LienDeadline API returned 401. private-body', 'permission'],
    ['LienDeadline API returned 403. private-body', 'permission'],
    ['LienDeadline API returned 404. private-body', 'api_4xx'],
    ['LienDeadline API returned 422. private-body', 'api_4xx'],
    ['LienDeadline API returned 429. private-body', 'rate_limited'],
    ['LienDeadline API returned 503. private-body', 'api_5xx'],
    ['private-error', 'unknown'],
    [undefined, 'unknown'],
    [{ private: 'error' }, 'unknown'],
    ['prefix LienDeadline API returned 503. private-body', 'unknown'],
    ['LienDeadline API returned 5030. private-body', 'unknown'],
  ]) {
    const properties = await classify('Error', message);
    assert.equal(properties.$mcp_error_type, expected, String(message));
    assert.doesNotMatch(JSON.stringify(properties), /private|\$mcp_error_message|\$mcp_error_status|\$mcp_response/);
  }
  assert.equal((await classify('private-error-name', 'private-error')).$mcp_error_type, 'unknown');
  assert.equal(Object.hasOwn(await classify('permission', 'private-error', false), '$mcp_error_type'), false);
});

test('native SDK keeps missing-key and input failures distinguishable without changing results', async () => {
  const events = [];
  const analytics = createHostedAnalytics('0.5.8', ENV, () => ({
    on() {}, capture(event) { events.push(event); }, async shutdown() {},
  }));
  await withServer(analytics, async client => {
    const missingKey = await client.callTool({ name: 'get_supplier_questions', arguments: {
      state: 'FL', project_type: 'commercial', hired_by: 'contractor',
    } });
    assert.equal(missingKey.isError, true);
    assert.match(missingKey.content[0].text, /^Set LIENDEADLINE_API_KEY/);
    const invalidState = await client.callTool({ name: 'get_state_lien_guide', arguments: { state: 'private-state' } });
    assert.equal(invalidState.isError, true);
    const invalidFacts = await client.callTool({ name: 'calculate_supplier_deadlines', arguments: {
      state: 'FL', first_delivery_date: '2026-08-03', project_type: 'commercial',
      hired_by: 'subcontractor', deliveries_complete: true,
    } });
    assert.equal(invalidFacts.isError, true);
    assert.match(invalidFacts.content[0].text, /^Invalid supplier request:/);
    await new Promise(resolve => setImmediate(resolve));
  }, { customerApiKey: undefined });
  const calls = events.filter(event => event.event === '$mcp_tool_call');
  assert.deepEqual(calls.map(event => event.properties.$mcp_error_type), ['permission', 'validation', 'validation']);
  assert.ok(calls.every(event => event.properties.$mcp_is_error === true));
  assert.doesNotMatch(JSON.stringify(events), /private|LIENDEADLINE_API_KEY|2026-08-03|\$mcp_error_message|\$mcp_parameters|\$mcp_response/);
});

test('native SDK preserves safe upstream failure categories, not response details', async t => {
  let status = 401;
  t.mock.method(globalThis, 'fetch', async () => new Response('private-upstream-body', { status }));
  const events = [];
  const analytics = createHostedAnalytics('0.5.8', ENV, () => ({
    on() {}, capture(event) { events.push(event); }, async shutdown() {},
  }));
  await withServer(analytics, async client => {
    for (status of [401, 403, 404, 422, 429, 503]) {
      const failure = await client.callTool({ name: 'get_state_lien_guide', arguments: { state: 'TX' } });
      assert.equal(failure.isError, true);
      assert.match(failure.content[0].text, new RegExp(`^LienDeadline API returned ${status}\\.`));
    }
    await new Promise(resolve => setImmediate(resolve));
  });
  const calls = events.filter(event => event.event === '$mcp_tool_call');
  assert.deepEqual(calls.map(event => event.properties.$mcp_error_type),
    ['permission', 'permission', 'api_4xx', 'api_4xx', 'rate_limited', 'api_5xx']);
  assert.doesNotMatch(JSON.stringify(events), /private|\$mcp_error_message|\$mcp_response|\$mcp_error_status/);
});

test('native SDK captures safe intent and preserves tool results and error reporting', async () => {
  const originalTools = await withServer(undefined, async client => (await client.listTools()).tools);
  const events = [];
  const analytics = createHostedAnalytics('0.4.2', ENV, () => ({
    on() {}, capture(event) { events.push(event); }, async shutdown() {},
  }));
  await withServer(analytics, async client => {
    const { tools } = await client.listTools();
    for (const original of originalTools) {
      const advertised = tools.find(tool => tool.name === original.name);
      const { context, ...properties } = advertised.inputSchema.properties;
      assert.equal(context?.type, 'string');
      assert.deepEqual(properties, original.inputSchema.properties);
    }
    for (const context of [undefined, '', '   ', 'Determine supplier notice and lien deadlines', 'private-project 2030-01-15']) {
      const guide = await client.callTool({ name: 'get_state_lien_guide', arguments: { state: 'TX', context } });
      assert.notEqual(guide.isError, true);
      assert.equal(guide.content.length, 1);
      assert.equal(JSON.parse(guide.content[0].text).state_code, 'TX');
    }
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
  assert.deepEqual(calls.map(event => [
    event.properties.$mcp_intent,
    event.properties.$mcp_intent_source,
    event.properties.$mcp_is_error,
  ]), [
    ["Read a state's lien guide", 'inferred', false],
    ["Read a state's lien guide", 'inferred', false],
    ["Read a state's lien guide", 'inferred', false],
    ['Determine supplier notice and lien deadlines', 'context_parameter', false],
    ["Read a state's lien guide", 'inferred', false],
    ['Determine supplier notice and lien deadlines', 'inferred', false],
    ['Determine supplier notice and lien deadlines', 'inferred', true],
  ]);
  assert.ok(calls.every(event => Number.isFinite(event.properties.$mcp_duration_ms)));
  assert.equal(new Set(events.map(event => event.distinctId)).size, events.length);
  assert.doesNotMatch(JSON.stringify(events), /private|sensitive-version|2026-08-03|2030-01-15|review_required|last_delivery_date|\$session_id|\$mcp_parameters|\$mcp_response/);
});
