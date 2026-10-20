import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { isSupplierDiscovery, isSupplierRequestV3, isSupplierResultV3, discoveredEvents } from '../src/supplier-v3.ts';
import { calculateSupplierDeadlinesV3, getSupplierQuestions } from '../src/api.ts';
const fixture = JSON.parse(readFileSync(new URL('./fixtures/supplier_task1_v1.json', import.meta.url)));
const ready = JSON.parse(readFileSync(new URL('./fixtures/supplier_task1_ready14_v1.json', import.meta.url)));
const key = 'ld_live_' + 'a'.repeat(32) + '.' + 'b'.repeat(43);
const base = 'https://secure-api-v1.liendeadline.com';
const riKey = 'ri_mailed_within_200_days';

// Actual full-evaluator outputs under isolated synthetic approval. The transport
// is mocked; these tests do not establish live API scope or legal approval.
test('Task 1 fixture covers the five required corrections', () => {
  assert.equal(fixture.synthetic_approval_only, true);
  for (const state of ['NH', 'PA', 'NV', 'WI', 'RI']) assert.ok(fixture.cases.some(item => item.request.state === state), state);
});
test('ready 14 states retain all six ordinary scope contracts', () => {
  assert.equal(ready.synthetic_approval_only, true);
  assert.equal(ready.cases.length, 84);
  assert.deepEqual([...new Set(ready.cases.map(item => item.request.state))].sort(), 'AR ID IL IN MA MD MI MS NE NJ OR TN VT WV'.split(' '));
});
for (const item of [...fixture.cases, ...ready.cases]) test(`Task 1 evaluator wire and API adapter: ${item.id}`, async t => {
  const { request, discovery, result } = item;
  const scope = Object.fromEntries(['contract_version', 'state', 'role', 'project_type', 'hired_by'].map(field => [field, request[field]]));
  assert.equal(isSupplierRequestV3(request), true);
  assert.equal(isSupplierDiscovery(discovery, scope), true);
  assert.equal(isSupplierResultV3(result, request), true);
  assert.deepEqual(discoveredEvents(discovery, request.events), request.events);
  if (request.state === 'NV' && request.hired_by !== 'owner' && request.events.nv_right_to_lien_notice_given?.answer !== 'yes') {
    assert.equal(Object.hasOwn(discoveredEvents(discovery, request.events), 'first_furnishing'), Object.hasOwn(request.events, 'first_furnishing'));
    assert.deepEqual(discoveredEvents(discovery, request.events).nv_right_to_lien_notice_given, request.events.nv_right_to_lien_notice_given);
  }
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(new Headers(options.headers).get('Authorization'), `Bearer ${key}`);
    assert.equal(options.redirect, 'error');
    if (new URL(url).pathname.endsWith('/questions')) return Response.json(discovery);
    assert.deepEqual(JSON.parse(options.body), request);
    return Response.json(result);
  });
  assert.deepEqual(await getSupplierQuestions(base, scope, key), discovery);
  assert.deepEqual(await calculateSupplierDeadlinesV3(base, request, key), result);
  if (request.state === 'RI' && request.events.ri_mailed?.answer === 'yes') {
    const question = discovery.questions.find(item => item.id === riKey);
    assert.ok(question);
    assert.deepEqual(question.applies_when, { all: [{ event: 'ri_mailed', answer: 'yes' }] });
    assert.deepEqual(discoveredEvents(discovery, request.events)[riKey], request.events[riKey]);
    for (const answer of ['no', 'unknown']) {
      assert.equal(Object.hasOwn(discoveredEvents(discovery, { ...request.events, ri_mailed: { answer } }), riKey), false);
    }
    if (request.events[riKey]?.answer !== 'yes') {
      assert.equal(result.lien_filing.deadline, null);
      assert.equal(result.lien_filing.status, 'review_required');
    }
  }
});
