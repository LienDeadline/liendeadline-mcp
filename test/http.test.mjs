import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { connect } from 'node:net';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const KEY = `ld_live_${'0'.repeat(32)}.${'A'.repeat(43)}`; // Synthetic only.
const MOCK = fileURLToPath(new URL('./mock-runtime.mjs', import.meta.url));
const source = file => fileURLToPath(new URL(`../src/${file}`, import.meta.url));
const PUBLIC_TOOLS = ['calculate_supplier_deadlines', 'get_state_lien_guide', 'list_state_lien_guides'];
const SUPPLIER_ARGS = {
  state: 'FL', first_delivery_date: '2026-08-03', last_delivery_date: '2026-09-10',
  project_type: 'commercial', hired_by: 'subcontractor', deliveries_complete: true,
  florida_final_payment_status: 'no', florida_termination_status: 'no',
};
const text = result => result.content.map(c => c.text ?? '').join('');

/**
 * Runs the actual hosted entry point with every upstream request mocked. Hosted runs carry a
 * customer key in their environment and a mock that rejects Authorization on every route, so
 * any upstream credential would surface as a failed tool call.
 */
async function withHostedServer(env, run) {
  const child = spawn(process.execPath, ['--experimental-transform-types', '--import', MOCK, source('http.ts')], {
    env: {
      PORT: '0', LIENDEADLINE_API_URL: 'https://secure-api-v1.liendeadline.com',
      LIENDEADLINE_API_KEY: KEY, MCP_TEST_FORBID_AUTHORIZATION: '1', ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', data => { stdout += data; });
  child.stderr.on('data', data => { stderr += data; });
  try {
    const port = await new Promise((resolve, reject) => {
      const onData = () => {
        const line = stdout.split('\n').find(l => l.includes('hosted server listening'));
        if (line) resolve(JSON.parse(line).port);
      };
      child.stdout.on('data', onData);
      child.once('exit', code => reject(new Error(`hosted server exited with ${code}: ${stderr}`)));
    });
    await run(new URL(`http://127.0.0.1:${port}/mcp`), () => stdout, () => stderr);
  } finally {
    child.kill('SIGTERM');
    if (child.exitCode === null) await once(child, 'exit');
    assert.equal(stdout.includes(KEY), false);
    assert.equal(stderr.includes(KEY), false);
  }
}

async function withClient(url, run) {
  const client = new Client({ name: 'hosted-contract-test', version: '0.0.0' });
  await client.connect(new StreamableHTTPClientTransport(url));
  try {
    await run(client);
  } finally {
    await client.close();
  }
}

const MCP_HEADERS = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
const initialize = id => JSON.stringify({
  jsonrpc: '2.0', id, method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'raw-http-test', version: '0.0.0' } },
});
const post = (url, body, headers = {}) => fetch(url, { method: 'POST', headers: { ...MCP_HEADERS, ...headers }, body });

test('hosted initialize and tools/list over HTTP return exactly the three public tools', async () => {
  await withHostedServer({}, async url => {
    await withClient(url, async client => {
      assert.equal(client.getServerVersion().name, 'liendeadline');
      const { tools } = await client.listTools();
      assert.deepEqual(tools.map(t => t.name), PUBLIC_TOOLS);
      for (const tool of tools) {
        assert.ok(tool.title, `${tool.name} has a title`);
        // Directory reviewers read the title from the annotations, so it must repeat the tool title.
        assert.deepEqual(tool.annotations, { title: tool.title, readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true });
      }
      assert.doesNotMatch(client.getInstructions(), /calculate_lien_deadline|list_supported_states|LIENDEADLINE_API_KEY/);
      // Customer tools are not registered at all, so they cannot be called either.
      for (const name of ['calculate_lien_deadline', 'list_supported_states']) {
        const result = await client.callTool({ name, arguments: { state: 'TX', invoice_date: '2026-07-01' } });
        assert.equal(result.isError, true);
        assert.match(text(result), new RegExp(`Tool ${name} not found`));
      }
    });
  });
});

test('enabled analytics preserves stateless HTTP tools when the collector is unavailable', async () => {
  await withHostedServer({
    POSTHOG_ENABLED: 'true', POSTHOG_PROJECT_TOKEN: `phc_${'A'.repeat(24)}`,
    POSTHOG_HOST: 'https://us.i.posthog.com', POSTHOG_ENVIRONMENT: 'test',
  }, async (url, logs, errors) => {
    await withClient(url, async client => {
      const { tools } = await client.listTools();
      assert.deepEqual(tools.map(tool => tool.name), PUBLIC_TOOLS);
      for (const tool of tools) {
        for (const field of ['context', 'llm_model', 'conversation_id']) {
          assert.equal(Object.hasOwn(tool.inputSchema.properties ?? {}, field), false);
        }
      }
      const result = await client.callTool({ name: 'get_state_lien_guide', arguments: { state: 'TX' } });
      assert.notEqual(result.isError, true, text(result));
      assert.equal(result.content.length, 1);
      assert.equal(JSON.parse(text(result)).state_code, 'TX');
      const response = await post(url, initialize(1));
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('Mcp-Session-Id'), null);
      assert.doesNotMatch(logs() + errors(), /phc_A+|\$mcp_parameters|\$mcp_response/);
    });
  });
});

test('hosted public tools are defined exactly as the stdio server defines them', async () => {
  const stdio = new Client({ name: 'stdio-contract-test', version: '0.0.0' });
  await stdio.connect(new StdioClientTransport({
    command: process.execPath,
    args: ['--experimental-transform-types', '--import', MOCK, source('index.ts')],
    env: { LIENDEADLINE_API_URL: 'https://secure-api-v1.liendeadline.com' },
  }));
  let stdioTools;
  try {
    stdioTools = (await stdio.listTools()).tools;
  } finally {
    await stdio.close();
  }
  await withHostedServer({}, async url => {
    await withClient(url, async client => {
      const { tools } = await client.listTools();
      assert.deepEqual(tools, stdioTools.filter(t => PUBLIC_TOOLS.includes(t.name)));
    });
  });
});

test('hosted supplier call returns the verified supplier-events-v2 echo', async () => {
  await withHostedServer({}, async url => {
    await withClient(url, async client => {
      const result = await client.callTool({ name: 'calculate_supplier_deadlines', arguments: SUPPLIER_ARGS });
      assert.notEqual(result.isError, true, text(result));
      const body = JSON.parse(text(result));
      assert.equal(body.contract_version, 'supplier-events-v2');
      assert.deepEqual(body.inputs, { contract_version: 'supplier-events-v2', ...SUPPLIER_ARGS });
      assert.equal(body.status, 'calculated');
      assert.equal(body.preliminary_notice.deadline, '2026-09-17');
      assert.equal(body.lien_filing.deadline, '2026-12-09');

      const { florida_final_payment_status, florida_termination_status, ...unanswered } = SUPPLIER_ARGS;
      const review = JSON.parse(text(await client.callTool({ name: 'calculate_supplier_deadlines', arguments: unanswered })));
      assert.equal(review.status, 'review_required');
      assert.equal(review.preliminary_notice.deadline, null);
      assert.equal(review.lien_filing.deadline, null);

      const invalid = await client.callTool({ name: 'calculate_supplier_deadlines', arguments: { ...SUPPLIER_ARGS, last_delivery_date: undefined } });
      assert.equal(invalid.isError, true);
      assert.match(text(invalid), /last_delivery_date is required when deliveries_complete is true/);
    });
  });
});

test('hosted mode never sends Authorization upstream, even with a customer key in its environment', async () => {
  await withHostedServer({}, async (url, logs) => {
    await withClient(url, async client => {
      for (const [name, args] of [
        ['calculate_supplier_deadlines', SUPPLIER_ARGS], ['get_state_lien_guide', { state: 'TX' }], ['list_state_lien_guides', {}],
      ]) {
        // The mock fails any upstream request that carries Authorization, which would make this an error.
        const result = await client.callTool({ name, arguments: args });
        assert.notEqual(result.isError, true, `${name}: ${text(result)}`);
        assert.equal(text(result).includes(KEY), false);
      }
    });
    assert.match(logs(), /LIENDEADLINE_API_KEY is ignored/);
  });
});

test('the Authorization guard used by the hosted tests does detect a forwarded key', async () => {
  const client = new Client({ name: 'guard-control-test', version: '0.0.0' });
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: ['--experimental-transform-types', '--import', MOCK, source('index.ts')],
    env: { LIENDEADLINE_API_URL: 'https://secure-api-v1.liendeadline.com', LIENDEADLINE_API_KEY: KEY, MCP_TEST_FORBID_AUTHORIZATION: '1' },
  }));
  try {
    const result = await client.callTool({ name: 'list_supported_states', arguments: {} });
    assert.equal(result.isError, true);
    assert.match(text(result), /Could not reach the LienDeadline API/);
  } finally {
    await client.close();
  }
});

test('oversized request bodies are rejected with 413 before reaching MCP', async () => {
  await withHostedServer({}, async url => {
    const padded = size => JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: { _meta: { pad: 'x'.repeat(size) } } });

    const declared = await post(url, padded(70 * 1024));
    assert.equal(declared.status, 413);
    assert.match((await declared.json()).error.message, /must not exceed 65536 bytes/);

    // Without Content-Length the limit applies while streaming.
    const chunks = [padded(40 * 1024), padded(40 * 1024)].map(s => new TextEncoder().encode(s));
    const stream = new ReadableStream({ pull(controller) { const next = chunks.shift(); next ? controller.enqueue(next) : controller.close(); } });
    const chunked = await fetch(url, { method: 'POST', headers: MCP_HEADERS, body: stream, duplex: 'half' });
    assert.equal(chunked.status, 413);
    await chunked.body?.cancel();

    // A body under the limit still reaches the MCP server.
    const ok = await post(url, initialize(1).replace('"capabilities":{}', `"capabilities":{},"_pad":"${'x'.repeat(60 * 1024)}"`));
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).result.serverInfo.name, 'liendeadline');

    const malformed = await post(url, '{"jsonrpc":');
    assert.equal(malformed.status, 400);
    assert.equal((await malformed.json()).error.code, -32700);
  });
});

test('health checks, method handling, CORS and unknown paths', async () => {
  await withHostedServer({}, async url => {
    for (const path of ['/healthz', '/health']) {
      const health = await fetch(new URL(path, url));
      assert.equal(health.status, 200);
      assert.deepEqual(await health.json(), { status: 'ok' });
    }
    for (const method of ['GET', 'DELETE']) {
      const response = await fetch(url, { method, headers: { Accept: 'application/json, text/event-stream' } });
      assert.equal(response.status, 405);
      assert.equal(response.headers.get('allow'), 'POST, OPTIONS');
      assert.equal((await response.json()).error.message, 'Method not allowed.');
    }
    const preflight = await fetch(url, {
      method: 'OPTIONS',
      headers: { Origin: 'https://inspector.example', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type, mcp-protocol-version' },
    });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-origin'), '*');
    assert.match(preflight.headers.get('access-control-allow-methods'), /POST/);
    for (const header of ['Content-Type', 'Mcp-Protocol-Version', 'Mcp-Session-Id', 'Authorization']) {
      assert.match(preflight.headers.get('access-control-allow-headers'), new RegExp(header));
    }
    const initialized = await post(url, initialize(1), { Origin: 'https://inspector.example' });
    assert.equal(initialized.status, 200);
    assert.equal(initialized.headers.get('access-control-allow-origin'), '*');
    assert.match(initialized.headers.get('access-control-expose-headers'), /Mcp-Session-Id/);
    assert.equal(initialized.headers.get('mcp-session-id'), null, 'stateless mode issues no session');
    await initialized.body?.cancel();
    assert.equal((await fetch(new URL('/other', url))).status, 404);
  });
});

test('per-client rate limit counts the proxy-reported address and returns 429 with Retry-After', async () => {
  await withHostedServer({ MCP_RATE_LIMIT_MAX: '1', MCP_TRUST_PROXY_HOPS: '1' }, async url => {
    const status = async forwardedFor => {
      const response = await post(url, initialize(1), { 'X-Forwarded-For': forwardedFor });
      await response.body?.cancel();
      return response;
    };
    assert.equal((await status('203.0.113.9, 198.51.100.1')).status, 200);
    // Entries left of the trusted hop are client-supplied and cannot buy a fresh window.
    const limited = await status('192.0.2.77, 198.51.100.1');
    assert.equal(limited.status, 429);
    assert.ok(Number(limited.headers.get('retry-after')) >= 1);
    assert.equal((await status('198.51.100.2')).status, 200);
    // One IPv6 /64 shares a window.
    assert.equal((await status('2001:db8:1:2::1')).status, 200);
    assert.equal((await status('2001:db8:1:2:ffff::9')).status, 429);
    assert.equal((await status('2001:db8:1:3::1')).status, 200);
    // Health checks are never limited.
    assert.equal((await fetch(new URL('/healthz', url))).status, 200);
  });
});

test('a slow tool call times out with 504 and its late result is dropped', async () => {
  await withHostedServer({ MCP_REQUEST_TIMEOUT_MS: '300', MCP_TEST_DELAY_MS: '1000' }, async (url, logs, errors) => {
    const started = Date.now();
    const response = await post(url, JSON.stringify({
      jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'list_state_lien_guides', arguments: {} },
    }));
    assert.equal(response.status, 504);
    assert.equal((await response.json()).error.code, -32001);
    assert.ok(Date.now() - started < 1000, 'answered before the upstream call finished');
    // Once the upstream call completes, the dropped result must not break the server.
    await new Promise(resolve => setTimeout(resolve, 1000));
    assert.equal((await fetch(new URL('/healthz', url))).status, 200);
    assert.doesNotMatch(errors(), /Error/, 'no late write after the timeout reply');
    assert.ok(logs().includes('"status":504'));
  });
});

test('a client that disconnects mid-upload is logged as 499 and the server keeps serving', async () => {
  await withHostedServer({}, async (url, logs, errors) => {
    await new Promise(resolve => {
      const socket = connect(Number(url.port), url.hostname, () => {
        socket.write('POST /mcp HTTP/1.1\r\nHost: test\r\nContent-Type: application/json\r\nContent-Length: 1000\r\n\r\n{"jsonrpc"');
        setTimeout(() => { socket.destroy(); setTimeout(resolve, 200); }, 100);
      });
    });
    assert.equal((await fetch(new URL('/healthz', url))).status, 200);
    for (let i = 0; i < 100 && !logs().includes('"status":499'); i++) await new Promise(resolve => setTimeout(resolve, 20));
    assert.ok(logs().includes('"status":499'));
    assert.doesNotMatch(errors(), /Error/);
  });
});

test('request logs carry only severity, method, status and latency', async () => {
  await withHostedServer({}, async (url, logs) => {
    await withClient(url, async client => {
      await client.callTool({ name: 'calculate_supplier_deadlines', arguments: SUPPLIER_ARGS });
    });
    await (await post(url, '{"jsonrpc":')).body?.cancel();
    const requestLines = () => logs().split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(l => 'status' in l);
    for (let i = 0; i < 50 && requestLines().length < 5; i++) await new Promise(resolve => setTimeout(resolve, 20));
    const lines = requestLines();
    assert.ok(lines.length >= 5, `${lines.length} request log lines`);
    for (const line of lines) {
      assert.deepEqual(Object.keys(line).sort(), ['latencyMs', 'method', 'severity', 'status']);
    }
    assert.ok(lines.some(l => l.method === 'POST' && l.status === 200));
    assert.ok(lines.some(l => l.status === 400));
    for (const value of ['2026-08-03', 'subcontractor', 'tools/call', 'calculate_supplier_deadlines']) {
      assert.equal(logs().includes(value), false, `logs must not contain ${value}`);
    }
  });
});

test('live smoke can drive a hosted endpoint, expects only public tools and forwards no key', async () => {
  await withHostedServer({}, async url => {
    const child = spawn(process.execPath, ['--experimental-transform-types', source('smoke.ts')], {
      env: { LIENDEADLINE_RUN_LIVE_SMOKE: '1', LIENDEADLINE_MCP_URL: url.href, LIENDEADLINE_API_KEY: KEY },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', data => { stdout += data; });
    child.stderr.on('data', data => { stderr += data; });
    const [code] = await once(child, 'exit');
    assert.equal(code, 0, stderr);
    assert.match(stdout, /tools: 3/);
    assert.match(stdout, /status=calculated notice=2026-09-17 lien=2026-12-09/);
    assert.match(stdout, /customer tools skipped: the hosted endpoint serves only the public tools/);
    assert.equal(stdout.includes(KEY), false);
    assert.equal(stderr.includes(KEY), false);
  });
});

test('hosted server refuses invalid numeric configuration before listening', () => {
  const result = spawnSync(process.execPath, ['--experimental-transform-types', '--import', MOCK, source('http.ts')], {
    env: { PORT: '0', MCP_RATE_LIMIT_MAX: 'many' }, encoding: 'utf8',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /MCP_RATE_LIMIT_MAX must be an integer/);
  assert.doesNotMatch(result.stdout, /listening/);
});

test('serves the OpenAI domain-verification token only when one is configured', async () => {
  const path = '/.well-known/openai-apps-challenge';
  await withHostedServer({}, async url => {
    assert.equal((await fetch(new URL(path, url))).status, 404);
  });
  await withHostedServer({ OPENAI_APPS_CHALLENGE: 'synthetic-challenge-token' }, async url => {
    const get = await fetch(new URL(path, url));
    assert.equal(get.status, 200);
    assert.match(get.headers.get('content-type'), /^text\/plain/);
    assert.equal(get.headers.get('cache-control'), 'no-store');
    assert.equal(await get.text(), 'synthetic-challenge-token');
    const head = await fetch(new URL(path, url), { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), '');
    const post = await fetch(new URL(path, url), { method: 'POST' });
    assert.equal(post.status, 405);
    assert.equal(post.headers.get('allow'), 'GET, HEAD');
  });
});

test('refuses to start with a malformed OpenAI challenge token', () => {
  const result = spawnSync(process.execPath, ['--experimental-transform-types', '--import', MOCK, source('http.ts')], {
    env: { PORT: '0', OPENAI_APPS_CHALLENGE: 'has a space' }, encoding: 'utf8', timeout: 10_000,
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /OPENAI_APPS_CHALLENGE must be/);
});

test('serves the LienDeadline icon as the host favicon', async () => {
  const icon = readFileSync(new URL('../assets/icon.png', import.meta.url));
  await withHostedServer({}, async url => {
    for (const path of ['/favicon.ico', '/favicon.png']) {
      const get = await fetch(new URL(path, url));
      assert.equal(get.status, 200);
      assert.equal(get.headers.get('content-type'), 'image/png');
      assert.deepEqual(Buffer.from(await get.arrayBuffer()), icon);
    }
    const head = await fetch(new URL('/favicon.ico', url), { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), '');
    assert.equal((await fetch(new URL('/favicon.ico', url), { method: 'POST' })).status, 405);
  });
});
