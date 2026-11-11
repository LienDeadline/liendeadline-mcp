import assert from 'node:assert/strict';
import test from 'node:test';
import { getSupplierQuestions } from '../src/api.ts';
import { applicableQuestions, isSupplierDiscovery } from '../src/supplier-v3.ts';
import { scope, discovery } from './supplier-v3-fixture.mjs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import './mock-runtime.mjs';
const { buildServer } = await import('../src/server.ts');

const KEY = 'ld_live_' + 'a'.repeat(32) + '.' + 'b'.repeat(43);
const BASE = 'https://secure-api-v1.liendeadline.com';
const fields = [
  ['scope status', value => value, 'scope_status'],
  ['schema version', value => value.rules_source, 'schema_version'],
  ['date policy', value => value.questions[0], 'date_policy'],
  ['predicate answer', value => value.questions[1].applies_when.all[0], 'answer'],
];

for (const [name, parent, key] of fields) {
  test(`discovery rejects non-string ${name} instead of coercing it`, async t => {
    let body;
    const fetch = t.mock.method(globalThis, 'fetch', async () => Response.json(body));
    for (const wrap of [value => [value], value => [[value]], () => null, () => {}, () => 1, () => true]) {
      body = structuredClone(discovery);
      parent(body)[key] = wrap(parent(body)[key]);
      assert.equal(isSupplierDiscovery(body, scope), false);
      await assert.rejects(() => getSupplierQuestions(BASE, scope, KEY), /discovery could not be verified/);
    }
    assert.equal(fetch.mock.callCount(), 6);
  });
}

test('canonical discovery preserves conditional question visibility and date policies', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json(discovery));
  const verified = await getSupplierQuestions(BASE, scope, KEY);
  assert.deepEqual(verified, discovery);
  assert.deepEqual(applicableQuestions(verified, { project_completed: { answer: 'yes' } }).map(q => q.id),
    ['project_completed', 'completion_notice_valid']);
});

test('discovery retains every supported scalar enum and both conditional answers', () => {
  for (const [parent, key, values] of [
    [value => value, 'scope_status', ['supported', 'no_lien_right', 'review_required']],
    [value => value.rules_source, 'schema_version', ['state-rules-v1', 'state-rules-v2']],
    [value => value.questions[0], 'date_policy', ['required_for_calculation_if_yes', 'optional_review_only', 'forbidden']],
  ]) {
    for (const value of values) {
      const body = structuredClone(discovery);
      parent(body)[key] = value;
      assert.equal(isSupplierDiscovery(body, scope), true);
    }
  }
  for (const answer of ['yes', 'no']) {
    const body = structuredClone(discovery);
    body.questions[1].applies_when.all[0].answer = answer;
    assert.equal(isSupplierDiscovery(body, scope), true);
    assert.deepEqual(applicableQuestions(body, { project_completed: { answer } }).map(q => q.id),
      ['project_completed', 'completion_notice_valid']);
  }
});

test('registered discovery tool fails closed on array-valued enums and preserves canonical output', async t => {
  let body = discovery;
  const fetch = t.mock.method(globalThis, 'fetch', async () => Response.json(body));
  const server = buildServer({ includeCustomerTools: false, customerApiKey: KEY });
  const client = new Client({ name: 'discovery-enum-test', version: '0.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const { contract_version, role, ...args } = scope;
  const call = () => client.callTool({ name: 'get_supplier_questions', arguments: args });
  try {
    const valid = await call();
    assert.notEqual(valid.isError, true);
    assert.deepEqual(JSON.parse(valid.content[0].text), discovery);
    for (const [name, parent, key] of fields) {
      body = structuredClone(discovery);
      parent(body)[key] = [parent(body)[key]];
      const response = await call();
      assert.equal(response.isError, true, `${name}: ${JSON.stringify(response)}`);
      assert.match(response.content[0].text, /discovery could not be verified/);
    }
    // A valid predicate still exposes the follow-up through the same registered tool.
    // An array-valued predicate above must fail before a consumer can silently hide it.
    for (const answer of ['yes', 'no']) {
      body = structuredClone(discovery);
      body.questions[1].applies_when.all[0].answer = answer;
      const response = await call();
      assert.notEqual(response.isError, true);
      const verified = JSON.parse(response.content[0].text);
      assert.deepEqual(applicableQuestions(verified, { project_completed: { answer } }).map(q => q.id),
        ['project_completed', 'completion_notice_valid']);
    }
    assert.equal(fetch.mock.callCount(), 7);
  } finally {
    await client.close();
    await server.close();
  }
});
