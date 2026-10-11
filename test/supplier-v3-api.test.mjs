import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateSupplierDeadlinesV3, getSupplierQuestions } from '../src/api.ts';
import { scope, discovery, input, result } from './supplier-v3-fixture.mjs';

const KEY = 'ld_live_' + 'a'.repeat(32) + '.' + 'b'.repeat(43);
const BASE = 'https://secure-api-v1.liendeadline.com';

test('v3 API transport sends authenticated scope/facts and exact identity binding', async t => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({url, options});
    assert.equal(new Headers(options.headers).get('Authorization'), `Bearer ${KEY}`);
    assert.equal(options.redirect, 'error');
    return Response.json(options.body ? result : discovery);
  });
  assert.deepEqual(await getSupplierQuestions(BASE, scope, KEY), discovery);
  assert.deepEqual(Object.fromEntries(new URL(calls[0].url).searchParams), scope);
  assert.deepEqual(await calculateSupplierDeadlinesV3(BASE, input, KEY), result);
  assert.deepEqual(JSON.parse(calls[1].options.body), input);
});

test('v3 transport rejects stale/malformed results and reports 409/503 without response-body leakage or fallback', async t => {
  for (const status of [409, 503]) {
    const mock = t.mock.method(globalThis, 'fetch', async () => Response.json({detail: 'sensitive synthetic detail'}, {status}));
    await assert.rejects(() => calculateSupplierDeadlinesV3(BASE, input, KEY), e => e.status === status && !e.message.includes('sensitive synthetic detail'));
    assert.equal(mock.mock.callCount(), 1); mock.mock.restore();
  }
  t.mock.method(globalThis, 'fetch', async () => Response.json({...result, inputs: {...input, events: {}}}));
  await assert.rejects(() => calculateSupplierDeadlinesV3(BASE, input, KEY), /no dates/);
});
