import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateSupplierDeadlinesV3, getSupplierQuestions } from '../src/api.ts';
import { scope, discovery, input, result } from './supplier-v3-fixture.mjs';

test('v3 API transport sends public scope/facts without credentials and exact identity binding', async t => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({url, options});
    assert.equal(new Headers(options.headers).has('Authorization'), false);
    assert.equal(options.redirect, 'error');
    return Response.json(options.body ? result : discovery);
  });
  assert.deepEqual(await getSupplierQuestions('https://example.org', scope), discovery);
  assert.deepEqual(Object.fromEntries(new URL(calls[0].url).searchParams), scope);
  assert.deepEqual(await calculateSupplierDeadlinesV3('https://example.org', input), result);
  assert.deepEqual(JSON.parse(calls[1].options.body), input);
});

test('v3 transport rejects stale/malformed results and reports 409/503 without response-body leakage or fallback', async t => {
  for (const status of [409, 503]) {
    const mock = t.mock.method(globalThis, 'fetch', async () => Response.json({detail: 'sensitive synthetic detail'}, {status}));
    await assert.rejects(() => calculateSupplierDeadlinesV3('https://example.org', input), e => e.status === status && !e.message.includes('sensitive synthetic detail'));
    assert.equal(mock.mock.callCount(), 1); mock.mock.restore();
  }
  t.mock.method(globalThis, 'fetch', async () => Response.json({...result, inputs: {...input, events: {}}}));
  await assert.rejects(() => calculateSupplierDeadlinesV3('https://example.org', input), /no dates/);
});
