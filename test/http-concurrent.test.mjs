import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

const syntheticKey = (id, secret) => `ld_live_${id.repeat(32)}.${secret.repeat(43)}`;
const environmentKey = syntheticKey('0', 'A');
const callers = [
  { id: 'first', key: syntheticKey('1', 'B'), date: '2026-08-03' },
  { id: 'second', key: syntheticKey('2', 'C'), date: '2026-08-04' },
];
const argsFor = caller => ({
  state: 'FL', first_delivery_date: caller.date, last_delivery_date: '2026-09-10',
  project_type: 'commercial', hired_by: 'subcontractor', deliveries_complete: true,
  florida_final_payment_status: 'no', florida_termination_status: 'no',
});

test('overlapping hosted callers keep separate keys and results when the second finishes first', async () => {
  const child = spawn(process.execPath, [
    '--experimental-transform-types', '--import',
    fileURLToPath(new URL('./mock-concurrent-http.mjs', import.meta.url)),
    fileURLToPath(new URL('../src/http.ts', import.meta.url)),
  ], {
    env: {
      PORT: '0', LIENDEADLINE_API_URL: 'https://secure-api-v1.liendeadline.com',
      LIENDEADLINE_API_KEY: environmentKey, MCP_TEST_FORBID_AUTHORIZATION: '1',
      MCP_TEST_CONCURRENT_CALLERS: JSON.stringify(callers),
    },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', data => { stdout += data; });
  child.stderr.on('data', data => { stderr += data; });
  const signal = AbortSignal.timeout(10_000);
  try {
    let port;
    while (!port) {
      await once(child.stdout, 'data', { signal });
      const line = stdout.split('\n').find(value => value.includes('hosted server listening'));
      if (line) port = JSON.parse(line).port;
    }
    const url = `http://127.0.0.1:${port}/mcp`;
    const call = async (name, args, key) => {
      const response = await fetch(url, {
        method: 'POST', signal,
        headers: {
          'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
          ...(key ? { Authorization: `Bearer ${key}` } : {}),
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
      });
      assert.equal(response.status, 200);
      return (await response.json()).result;
    };
    const start = async caller => {
      const arrival = once(child, 'message', { signal });
      const result = call('calculate_supplier_deadlines', argsFor(caller), caller.key);
      const observed = await Promise.race([
        arrival,
        result.then(() => { throw new Error('the tool finished before its upstream request was admitted'); }),
      ]);
      assert.deepEqual(observed, [{ upstream: caller.id }, undefined]);
      return { result };
    };
    const first = await start(callers[0]);
    let firstFinished = false;
    first.result.finally(() => { firstFinished = true; }).catch(() => {});
    const second = await start(callers[1]);
    child.send({ release: callers[1].id });
    const secondResult = await second.result;
    assert.notEqual(secondResult.isError, true);
    assert.deepEqual(JSON.parse(secondResult.content[0].text).inputs,
      { contract_version: 'supplier-events-v2', ...argsFor(callers[1]) });
    assert.equal(firstFinished, false, 'the first upstream request is still held');

    // Neither an anonymous request nor a public tool can inherit an in-flight key.
    const anonymous = await call('calculate_supplier_deadlines', argsFor(callers[0]));
    assert.equal(anonymous.isError, true);
    assert.match(anonymous.content[0].text, /Set LIENDEADLINE_API_KEY/);
    const guide = await call('get_state_lien_guide', { state: 'TX' }, callers[1].key);
    assert.notEqual(guide.isError, true);
    assert.equal(JSON.parse(guide.content[0].text).state_code, 'TX');
    assert.equal(firstFinished, false);

    child.send({ release: callers[0].id });
    const firstResult = await first.result;
    assert.notEqual(firstResult.isError, true);
    assert.deepEqual(JSON.parse(firstResult.content[0].text).inputs,
      { contract_version: 'supplier-events-v2', ...argsFor(callers[0]) });
    for (const key of [environmentKey, ...callers.map(caller => caller.key)]) {
      assert.equal(JSON.stringify([firstResult, secondResult, anonymous, guide]).includes(key), false);
    }
  } finally {
    child.kill('SIGTERM');
    if (child.exitCode === null) await once(child, 'exit');
    for (const key of [environmentKey, ...callers.map(caller => caller.key)]) {
      assert.equal((stdout + stderr).includes(key), false);
    }
  }
});
