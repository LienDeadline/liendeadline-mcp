import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { isSupplierDiscovery, isSupplierRequestV3, isSupplierResultV3 } from '../src/supplier-v3.ts';
import { calculateSupplierDeadlinesV3 } from '../src/api.ts';
import { result, discovery } from './supplier-v3-fixture.mjs';
import './mock-runtime.mjs';
const { buildServer } = await import('../src/server.ts');
const KEY = 'ld_live_' + 'a'.repeat(32) + '.' + 'b'.repeat(43);
const BASE = 'https://secure-api-v1.liendeadline.com';
const clone = value => structuredClone(value);
const valid = value => isSupplierResultV3(value, value.inputs);
const scopeOf = request => Object.fromEntries(['contract_version', 'state', 'role', 'project_type', 'hired_by'].map(k => [k, request[k]]));

// Synthetic wire-only fixtures. Dates/statuses are supplied responses, not MCP
// statute calculations, API engine proof, legal approval or service evidence.
function syntheticCompleted() {
  const value = clone(result);
  value.preliminary_notice = clone(value.preliminary_notice);
  value.state_code = value.inputs.state = 'NH';
  value.as_of_date = '2026-10-13';
  value.inputs.events = { first_furnishing: { answer: 'yes', date: '2026-06-01' },
    final_furnishing: { answer: 'yes', date: '2026-08-14' }, nh_entire_contract_established: { answer: 'yes' } };
  value.preliminary_notice = { ...value.preliminary_notice, event_ids: ['first_furnishing'], deadline: '2026-11-01', days_from_now: 19,
    notice_duties: [{ id: 'synthetic_owner_notice', name: 'Synthetic owner notice', description: 'Independent synthetic notice.',
      status: 'calculated', required: true, deadline: '2026-11-01', days_from_now: 19,
      event_ids: ['first_furnishing'], source_ids: ['test'] }] };
  value.lien_filing = { ...value.lien_filing, event_ids: ['final_furnishing'], deadline: '2026-12-12', days_from_now: 60,
    reason_code: 'synthetic_entire_contract_completion', candidate_deadlines: [
      { id: 'contract_completion', date: '2026-12-12', source_ids: ['test'] }] };
  return value;
}
function syntheticReview(answer = 'unknown') {
  const value = syntheticCompleted();
  if (answer === 'omitted') delete value.inputs.events.nh_entire_contract_established;
  else value.inputs.events.nh_entire_contract_established.answer = answer;
  value.status = 'review_required';
  value.critical_warnings = ['Synthetic: grouping unresolved; first checkpoint passing does not establish expiry.'];
  value.lien_filing = { ...value.lien_filing, status: 'review_required', required: null, deadline: null, days_from_now: null,
    reason_code: 'conservative_action_date', description: 'Synthetic first conservative checkpoint and final informational candidate.',
    action_by: '2026-09-29', candidate_deadlines: [
      { id: 'first_furnishing', date: '2026-09-29', source_ids: ['test'] },
      { id: 'final_furnishing', date: '2026-12-12', source_ids: ['test'] }] };
  return value;
}

test('synthetic NH entire-contract fact uses existing events and discovered forbidden-date question', () => {
  const value = syntheticCompleted(), requestScope = scopeOf(value.inputs);
  const discovered = clone(discovery); discovered.scope = requestScope;
  discovered.questions = [{ id: 'nh_entire_contract_established', label: 'Synthetic identified entire contract?',
    help: 'Synthetic: explicit linkage, never inferred from a jobsite or account.', answers: ['yes', 'no', 'unknown'],
    date_policy: 'forbidden', applies_when: { all: [] }, affects: ['lien_filing'], source_ids: ['test'] }];
  assert.equal(isSupplierRequestV3(value.inputs), true);
  assert.equal(isSupplierDiscovery(discovered, requestScope), true);
  assert.deepEqual(value.inputs.events.nh_entire_contract_established, { answer: 'yes' });
});

test('synthetic settled response retains one completion candidate and an independent notice unchanged', () => {
  const value = syntheticCompleted(), before = clone(value.preliminary_notice);
  assert.equal(valid(value), true);
  assert.deepEqual(value.lien_filing.candidate_deadlines, [{ id: 'contract_completion', date: '2026-12-12', source_ids: ['test'] }]);
  assert.equal(Object.hasOwn(value.lien_filing, 'action_by'), false);
  assert.deepEqual(value.preliminary_notice, before);
});

test('synthetic unresolved grouping retains both past first checkpoint and final informational candidate', () => {
  for (const answer of ['no', 'unknown', 'omitted']) {
    const value = syntheticReview(answer);
    assert.equal(valid(value), true);
    assert.equal(value.lien_filing.status, 'review_required');
    assert.equal(value.lien_filing.deadline, null); assert.equal(value.lien_filing.days_from_now, null);
    assert.equal(value.lien_filing.action_by, '2026-09-29');
    assert.deepEqual(value.lien_filing.candidate_deadlines.map(c => [c.id, c.date, c.source_ids]), [
      ['first_furnishing', '2026-09-29', ['test']], ['final_furnishing', '2026-12-12', ['test']] ]);
  }
});

const malformed = {
  impossible_date: v => { v.lien_filing.candidate_deadlines[1].date = '2026-02-30'; },
  duplicate_candidate: v => { v.lien_filing.candidate_deadlines[1].id = 'first_furnishing'; },
  empty_sources: v => { v.lien_filing.candidate_deadlines[1].source_ids = []; },
  foreign_source: v => { v.lien_filing.candidate_deadlines[1].source_ids = ['foreign']; },
  null_candidates: v => { v.lien_filing.candidate_deadlines = null; },
  review_legal_date: v => { v.lien_filing.deadline = '2026-12-12'; },
  review_countdown: v => { v.lien_filing.days_from_now = 60; },
  stale_source: v => { v.rules_source.source_hash = 'f'.repeat(64); },
  stale_questions: v => { v.questions_identity.question_set_hash = 'f'.repeat(64); },
  mismatched_echo: v => { v.inputs.events.final_furnishing.date = '2026-08-15'; },
};
test('synthetic malformed candidates and identity reject the full response rather than a scalar fallback', async t => {
  let current;
  t.mock.method(globalThis, 'fetch', async () => Response.json(current));
  for (const [name, mutate] of Object.entries(malformed)) {
    current = syntheticReview(); const request = clone(current.inputs); mutate(current);
    assert.equal(isSupplierResultV3(current, request), false, name);
    await assert.rejects(() => calculateSupplierDeadlinesV3(BASE, request, KEY), /no dates/, name);
  }
  current = syntheticCompleted(); current.lien_filing.action_by = '2026-09-29';
  assert.equal(valid(current), false);
  await assert.rejects(() => calculateSupplierDeadlinesV3(BASE, current.inputs, KEY), /no dates/);
});

test('synthetic MCP protocol preserves qualified candidates, five tools and Series08 input/instructions', async t => {
  let current;
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    assert.deepEqual(JSON.parse(options.body), current.inputs);
    return Response.json(current);
  });
  const server = buildServer({ includeCustomerTools: false, customerApiKey: KEY });
  const client = new Client({ name: 'synthetic-nh-contract-wire', version: '0.0.0' });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st); await client.connect(ct);
  try {
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map(x => x.name), ['calculate_supplier_deadlines', 'get_supplier_questions',
      'calculate_supplier_deadlines_v3', 'get_state_lien_guide', 'list_state_lien_guides']);
    const tool = tools.find(x => x.name === 'calculate_supplier_deadlines_v3');
    assert.deepEqual(Object.keys(tool.inputSchema.properties).sort(),
      ['state', 'project_type', 'hired_by', 'rules_source', 'questions_identity', 'events', 'recurring_notice_facts'].sort());
    for (const text of [client.getInstructions(), tool.description]) {
      assert.match(text, /candidate_deadlines entry with its ID, date and sources/);
      assert.match(text, /first_furnishing as a conservative checkpoint|first_furnishing is a conservative checkpoint/);
      assert.match(text, /final_furnishing as informational|final_furnishing is informational/);
      assert.match(text, /[Pp]assing the first checkpoint does not itself establish expiry/);
      assert.match(text, /calculated contract_completion outcome uses only the (?:API-)?returned deadline/);
      assert.match(text, /review|Review/);
    }
    assert.match(client.getInstructions(), /label it Conservative action date/);
    assert.match(client.getInstructions(), /Do not infer intervening months/);
    assert.match(client.getInstructions(), /earlier gaps remain unresolved/);
    assert.match(client.getInstructions(), /do not establish calculated filing deadlines, notice completion or scheduled reminders/);
    for (current of [syntheticCompleted(), syntheticReview()]) {
      const { contract_version, role, ...args } = current.inputs;
      const response = await client.callTool({ name: tool.name, arguments: args });
      assert.notEqual(response.isError, true);
      assert.deepEqual(JSON.parse(response.content[0].text), current);
    }
    current = syntheticReview(); current.lien_filing.candidate_deadlines[1].source_ids = ['foreign'];
    const { contract_version, role, ...args } = current.inputs;
    const rejected = await client.callTool({ name: tool.name, arguments: args });
    assert.equal(rejected.isError, true); assert.match(rejected.content[0].text, /no dates/);
  } finally { await client.close(); await server.close(); }
});

test('synthetic actual-future completion422/stale409/source503 produce errors without dates or denial-body leakage', async t => {
  const value = syntheticCompleted(); value.inputs.events.final_furnishing.date = '2026-10-14';
  for (const status of [422, 409, 503]) {
    t.mock.method(globalThis, 'fetch', async () => Response.json({ detail: 'synthetic-sensitive-body', event: 'final_furnishing' }, { status }));
    await assert.rejects(() => calculateSupplierDeadlinesV3(BASE, value.inputs, KEY), error => {
      assert.equal(error.status, status); assert.match(error.message, new RegExp(String(status)));
      assert.doesNotMatch(error.message, /synthetic-sensitive-body/); return true;
    });
  }
});

// Actual final .9 evaluator/isolated-route export with synthetic offline approval.
// This is not hosted API output, owner legal approval or provider acceptance.
const freshBytes = readFileSync(new URL('./fixtures/supplier_nh_contract_targets_v1.json', import.meta.url));
const fresh = JSON.parse(freshBytes);
const row = id => { const value = fresh.cases.find(c => c.id === id); assert.ok(value, id); return value; };
test('final NH fixture is the exact96-case exported byte copy with distinct synthetic identity', () => {
  assert.equal(createHash('sha256').update(freshBytes).digest('hex'), '38d4a3337d4ff018d3e2782704026e9140ae1a2a26fead1d2e6c7ce6ce3fddf2');
  assert.equal(fresh.schema_version, 'supplier-nh-contract-targets-fixtures-v1');
  assert.equal(fresh.source_version, '2026-10-13.9'); assert.equal(fresh.synthetic_approval_only, true);
  assert.equal(fresh.canonical_yaml_sha256, '147c01754f6caec4488db6e76f5cefb5b75ce4358d561d4c7585781cc400ce18');
  assert.equal(fresh.implementation_manifest_hash, 'aba1be4e717fa1c01a1d61865fe0cf060da24ef49a9454cbae38bc905cf9a341');
  assert.notEqual(fresh.synthetic_rules_identity.source_hash, fresh.canonical_yaml_sha256);
  assert.notEqual(fresh.synthetic_rules_identity.source_hash, '848f213dba1d42da0c183cc88143b56b2f322eed6681dda84af3d191f1d1ba5f');
  assert.equal(fresh.cases.length, 96);
});
for (const item of fresh.cases) test(`actual bound NH/retained08 API result validates unchanged: ${item.id}`, () => {
  assert.equal(isSupplierRequestV3(item.request), true);
  assert.equal(isSupplierDiscovery(item.discovery, scopeOf(item.request)), true);
  assert.equal(isSupplierResultV3(item.result, item.request), true);
  assert.deepEqual(item.result.inputs, item.request);
});

test('actual six-scope settled completion and qualified fallback dates retain exact sources and raw endpoints', () => {
  for (const project of ['commercial', 'residential']) for (const hired of ['owner', 'contractor', 'subcontractor']) {
    const prefix = `nh_${project}_${hired}`;
    const actual = row(`${prefix}_actual_completed`), lien = actual.result.lien_filing;
    const question = actual.discovery.questions.find(q => q.id === 'nh_entire_contract_established');
    assert.equal(question.date_policy, 'forbidden'); assert.deepEqual(question.affects, ['lien_filing']);
    assert.deepEqual(question.answers, ['yes', 'no', 'unknown']);
    assert.match(question.help, /Confirm the contract governing the qualifying materials in this claim/);
    assert.match(question.help, /If grouping is unresolved, answer unknown/);
    assert.match(question.help, /jobsite|customer|account|invoices/i);
    assert.equal(lien.status, 'calculated'); assert.equal(lien.deadline, '2026-12-12');
    assert.equal(Object.hasOwn(lien, 'action_by'), false);
    assert.deepEqual(lien.candidate_deadlines, [{ id: 'contract_completion', date: '2026-12-12', source_ids: ['NH-1', 'NH-2', 'NH-3'] }]);
    for (const suffix of ['distinct_contracts', 'unknown_contract', 'omitted_contract']) {
      const held = row(`${prefix}_${suffix}`).result;
      assert.equal(held.lien_filing.status, 'review_required'); assert.equal(held.lien_filing.deadline, null);
      assert.equal(held.lien_filing.days_from_now, null); assert.equal(held.lien_filing.action_by, '2026-09-29');
      assert.deepEqual(held.lien_filing.candidate_deadlines, [
        { id: 'first_furnishing', date: '2026-09-29', source_ids: ['NH-1', 'NH-2', 'NH-3'] },
        { id: 'final_furnishing', date: '2026-12-12', source_ids: ['NH-1', 'NH-2', 'NH-3'] } ]);
      assert.match(held.lien_filing.description, /conservative planning checkpoint/i);
      assert.match(held.lien_filing.description, /informational/i);
      assert.match(held.lien_filing.description, /passing does not by itself/i);
      assert.deepEqual(held.preliminary_notice, actual.result.preliminary_notice);
    }
    for (const suffix of ['ongoing', 'unknown_completion', 'undated_completion', 'omitted_completion']) {
      const held = row(`${prefix}_${suffix}`).result;
      assert.equal(held.lien_filing.status, 'review_required'); assert.equal(held.lien_filing.deadline, null);
      assert.deepEqual(held.lien_filing.candidate_deadlines.map(c => c.id), ['first_furnishing']);
      assert.deepEqual(held.preliminary_notice, actual.result.preliminary_notice);
    }
    const disputed = row(`${prefix}_disputed_latest`).result.lien_filing;
    assert.equal(disputed.status, 'review_required'); assert.equal(disputed.deadline, null);
    assert.deepEqual(disputed.candidate_deadlines, []);
    const boundary = row(`${prefix}_calendar_2027`).result.lien_filing;
    assert.equal(boundary.status, 'calculated'); assert.equal(boundary.deadline, '2027-04-30');
    assert.deepEqual(boundary.candidate_deadlines.map(c => [c.id, c.date]), [['contract_completion', '2027-04-30']]);
  }
});

test('actual changed contract/completion retains independent notices and08 account/TN partial coverage', () => {
  for (const project of ['commercial', 'residential']) for (const hired of ['contractor', 'subcontractor']) {
    const prefix = `nh_${project}_${hired}`;
    const original = row(`${prefix}_account_unknown`).result;
    for (const suffix of ['account_unknown_entire', 'account_unknown_changed_completion', 'account_unknown_distinct']) {
      const changed = row(`${prefix}_${suffix}`).result;
      assert.deepEqual(changed.preliminary_notice, original.preliminary_notice);
      const checkpoint = changed.preliminary_notice.recurring_notice_checkpoints[0];
      assert.equal(checkpoint.status, 'advisory_checkpoint'); assert.equal(checkpoint.legal_status, 'review_required');
      assert.equal(checkpoint.target_date, '2026-07-20'); assert.equal(Object.hasOwn(checkpoint, 'deadline'), false);
      for (const notice of changed.preliminary_notice.notice_duties) {
        assert.equal(notice.event_ids.includes('nh_entire_contract_established'), false);
        assert.equal(notice.event_ids.includes('final_furnishing'), false);
      }
    }
    const notices = original.preliminary_notice.notice_duties;
    assert.deepEqual(notices.map(n => [n.id, n.deadline]), [
      ['nh_owner_notice', '2026-05-31'], ['nh_construction_lender_notice', '2026-09-23'] ]);
    const tn = row(`tn_${project}_${hired}_series08_continuity`).result.preliminary_notice;
    assert.equal(tn.recurring_coverage, 'entered_periods_only');
    assert.deepEqual(tn.recurring_notice_periods.map(p => p.month), ['2026-06', '2026-07']);
    assert.deepEqual(tn.notice_duties.map(n => [n.id, n.deadline]), [
      ['tn_nonpayment_2026_06', '2026-09-28'], ['tn_nonpayment_2026_07', '2026-10-29'] ]);
  }
});

test('actual all96 API adapter results preserve full objects and malformed candidates invalidate full responses', async t => {
  let current, calls = 0;
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    calls++; assert.deepEqual(JSON.parse(options.body), current.request);
    assert.equal(new Headers(options.headers).get('Authorization'), `Bearer ${KEY}`);
    assert.equal(options.redirect, 'error'); return Response.json(current.result);
  });
  for (const item of fresh.cases) { current = item;
    assert.deepEqual(await calculateSupplierDeadlinesV3(BASE, item.request, KEY), item.result); }
  assert.equal(calls, 96);
  current = clone(row('nh_commercial_contractor_unknown_contract'));
  current.result.lien_filing.candidate_deadlines[1].source_ids = ['foreign'];
  await assert.rejects(() => calculateSupplierDeadlinesV3(BASE, current.request, KEY), /no dates/);
  current = clone(row('nh_commercial_contractor_unknown_contract'));
  current.result.lien_filing.deadline = '2026-12-12'; current.result.lien_filing.days_from_now = 60;
  await assert.rejects(() => calculateSupplierDeadlinesV3(BASE, current.request, KEY), /no dates/);
  current = clone(row('nh_commercial_contractor_actual_completed'));
  current.result.lien_filing.action_by = '2026-09-29';
  await assert.rejects(() => calculateSupplierDeadlinesV3(BASE, current.request, KEY), /no dates/);
});

test('actual all96 discovery/result cases traverse MCP protocol unchanged with candidate and notice metadata', async t => {
  let current, calls = 0;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls++; assert.equal(new Headers(options.headers).get('Authorization'), `Bearer ${KEY}`);
    assert.equal(options.redirect, 'error');
    const endpoint = new URL(url);
    if (endpoint.pathname.endsWith('/questions')) {
      for (const key of ['contract_version', 'state', 'role', 'project_type', 'hired_by'])
        assert.equal(endpoint.searchParams.get(key), current.request[key]);
      return Response.json(current.discovery);
    }
    assert.deepEqual(JSON.parse(options.body), current.request); return Response.json(current.result);
  });
  const server = buildServer({ includeCustomerTools: false, customerApiKey: KEY });
  const client = new Client({ name: 'actual-nh-contract-fixture-transport', version: '0.0.0' });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st); await client.connect(ct);
  try {
    for (const item of fresh.cases) {
      current = item;
      const discoveryArgs = Object.fromEntries(['state', 'project_type', 'hired_by'].map(k => [k, item.request[k]]));
      const discovered = await client.callTool({ name: 'get_supplier_questions', arguments: discoveryArgs });
      assert.notEqual(discovered.isError, true, item.id);
      assert.deepEqual(JSON.parse(discovered.content[0].text), item.discovery, item.id);
      const { contract_version, role, ...args } = item.request;
      const response = await client.callTool({ name: 'calculate_supplier_deadlines_v3', arguments: args });
      assert.notEqual(response.isError, true, item.id);
      assert.deepEqual(JSON.parse(response.content[0].text), item.result, item.id);
    }
    assert.equal(calls, 192);
    current = clone(row('nh_commercial_contractor_unknown_contract'));
    current.result.lien_filing.candidate_deadlines[1].source_ids = ['foreign'];
    const { contract_version, role, ...args } = current.request;
    const rejected = await client.callTool({ name: 'calculate_supplier_deadlines_v3', arguments: args });
    assert.equal(rejected.isError, true); assert.match(rejected.content[0].text, /no dates/);
  } finally { await client.close(); await server.close(); }
});
