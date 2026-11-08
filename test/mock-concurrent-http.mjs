import assert from 'node:assert/strict';
import { supplierEcho } from './mock-runtime.mjs';

// All upstream traffic stays mocked. IPC makes request overlap deterministic,
// rather than relying on sleeps or on the scheduler starting requests together.
const fallbackFetch = globalThis.fetch;
const callers = JSON.parse(process.env.MCP_TEST_CONCURRENT_CALLERS);
const pending = new Map();

process.on('message', message => {
  const release = pending.get(message?.release);
  if (release) {
    pending.delete(message.release);
    release();
  }
});

globalThis.fetch = async (url, init) => {
  if (new URL(url).pathname !== '/api/v1/supplier-deadlines') {
    return fallbackFetch(url, init);
  }
  const inputs = JSON.parse(init.body);
  const caller = callers.find(candidate => candidate.date === inputs.first_delivery_date);
  assert.ok(caller, 'the request belongs to a configured synthetic caller');
  assert.equal(init.redirect, 'error');
  assert.equal(init.method, 'POST');
  // Boolean assertion keeps synthetic key values out of assertion messages.
  assert.ok(new Headers(init.headers).get('Authorization') === `Bearer ${caller.key}`,
    'the upstream key matches this request, not a concurrent caller or server environment');
  assert.ok(!pending.has(caller.id), 'one upstream request per caller');
  await new Promise(resolve => {
    pending.set(caller.id, resolve);
    process.send({ upstream: caller.id });
  });
  return Response.json(supplierEcho(inputs));
};
