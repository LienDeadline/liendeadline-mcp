import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { isSupplierDiscovery, isSupplierRequestV3, isSupplierResultV3 } from '../src/supplier-v3.ts';
import { calculateSupplierDeadlinesV3 } from '../src/api.ts';
import { result } from './supplier-v3-fixture.mjs';
import './mock-runtime.mjs';
const { buildServer } = await import('../src/server.ts');

// Synthetic wire fixtures only: no state-law calculation, approval or service receipt.
const KEY = 'ld_live_' + 'a'.repeat(32) + '.' + 'b'.repeat(43);
const BASE = 'https://secure-api-v1.liendeadline.com';
function plannedResult() {
  const value = structuredClone(result);
  value.inputs.events.final_furnishing = { answer: 'yes', date: '2026-08-14' };
  value.inputs.events.waiver = { answer: 'no' };
  value.preliminary_notice = { ...value.preliminary_notice,
    event_ids: ['project_completed', 'final_furnishing', 'waiver'],
    notice_duties: [{ id: 'confirmed_first', name: 'Synthetic first notice',
      description: 'Synthetic confirmed duty; not evidence of service.',
      status: 'calculated', required: true, deadline: '2026-07-01', days_from_now: 30,
      event_ids: ['project_completed'], source_ids: ['test'] }],
    planned_notice_targets: [{ id: 'synthetic_intent_plan', name: 'Synthetic intent planning target',
      description: 'Assumes filing on February 12; earlier filing requires the full interval.',
      status: 'planning_target', target_date: '2027-01-13',
      basis: { kind: 'policy_earlier_filing_target', assumed_filing_date: '2027-02-12', minimum_interval_days: 30 },
      event_ids: ['final_furnishing', 'waiver'], source_ids: ['test'] }],
  };
  return value;
}
const valid = value => isSupplierResultV3(value, value.inputs);

test('qualified forecast retains confirmed summary and does not infer plans from old candidates', () => {
  const value = plannedResult();
  assert.equal(isSupplierRequestV3(value.inputs), true);
  assert.equal(valid(value), true);
  value.preliminary_notice.planned_notice_targets[0].target_date = '2026-06-01';
  value.preliminary_notice.planned_notice_targets[0].basis = {
    kind: 'policy_earlier_filing_target', assumed_filing_date: '2026-06-11', minimum_interval_days: 10,
  };
  assert.equal(valid(value), true); // A plan earlier than the first notice does not change its summary.
  assert.equal(value.preliminary_notice.deadline, '2026-07-01');
  const historical = structuredClone(result);
  historical.preliminary_notice.candidate_deadlines = [{ id: 'intent', date: '2026-07-10', source_ids: ['test'] }];
  assert.equal(valid(historical), true);
  assert.equal(Object.hasOwn(historical.preliminary_notice, 'planned_notice_targets'), false);
});

test('same-date distinct identities and longer full intervals are valid without completion semantics', () => {
  const value = plannedResult(), first = value.preliminary_notice.planned_notice_targets[0];
  first.target_date = '2026-07-01';
  first.basis.assumed_filing_date = '2026-07-31';
  value.preliminary_notice.planned_notice_targets.push({ ...structuredClone(first), id: 'second_plan' });
  assert.equal(valid(value), true);
  first.target_date = '2026-06-30';
  assert.equal(valid(value), true);
  assert.equal(Object.hasOwn(first, 'sent_date'), false);
});

test('held lien permits independent plans, while held or ineligible preliminary parents cannot', () => {
  const value = plannedResult();
  value.status = 'review_required';
  value.lien_filing = { ...value.lien_filing, status: 'review_required', required: null, deadline: null, days_from_now: null };
  assert.equal(valid(value), true);
  for (const [status, required] of [['review_required', null], ['not_required', false],
    ['no_lien_right', false], ['awaiting_final_delivery', true]]) {
    const held = plannedResult();
    delete held.preliminary_notice.notice_duties;
    held.preliminary_notice = { ...held.preliminary_notice, status, required, deadline: null, days_from_now: null };
    assert.equal(valid(held), false, status);
  }
  delete value.preliminary_notice.notice_duties;
  assert.equal(valid(value), false); // This increment has no plan-only parent.
});

test('planning targets and bases require exact eight/three fields and bounded civil evidence', () => {
  const sample = plannedResult().preliminary_notice.planned_notice_targets[0];
  const mutations = [
    ...Object.keys(sample).map(key => p => { delete p[key]; }),
    ...Object.keys(sample.basis).map(key => p => { delete p.basis[key]; }),
    p => { p.extra = true; }, p => { p.deadline = p.target_date; }, p => { p.days_from_now = 1; },
    p => { p.required = true; }, p => { p.sent_date = p.target_date; }, p => { p.action_by = p.target_date; },
    p => { p.basis.extra = true; }, p => { p.basis.kind = 'actual_filing'; },
    p => { p.status = 'calculated'; }, p => { p.id = 'Bad-ID'; },
    p => { p.name = ''; }, p => { p.description = ''; },
    p => { p.name = 'x'.repeat(2001); }, p => { p.description = '😀'.repeat(2001); },
    p => { p.target_date = '2026-02-30'; }, p => { p.target_date = '2026-7-01'; },
    p => { p.target_date = '1899-12-31'; }, p => { p.target_date = '9999-01-01'; },
    p => { p.basis.assumed_filing_date = '1900-02-29'; }, p => { p.basis.assumed_filing_date = null; },
    p => { p.basis = null; }, p => { p.basis.minimum_interval_days = true; },
    p => { p.basis.minimum_interval_days = '30'; }, p => { p.basis.minimum_interval_days = 30.5; },
    p => { p.basis.minimum_interval_days = 0; }, p => { p.basis.minimum_interval_days = 20; },
    p => { p.target_date = '2027-01-14'; }, // 29 days cannot satisfy the 30-day basis.
    p => { p.basis.minimum_interval_days = 10; p.target_date = '2027-02-03'; }, // Nine days is insufficient.
    p => { p.basis.assumed_filing_date = '2027-01-12'; },
    p => { p.event_ids = []; }, p => { p.event_ids = ['final_furnishing', 'final_furnishing']; },
    p => { p.event_ids = ['Bad-ID']; }, p => { p.event_ids = ['missing']; },
    p => { p.source_ids = []; }, p => { p.source_ids = ['test', 'test']; }, p => { p.source_ids = ['missing']; },
  ];
  for (const mutate of mutations) {
    const value = plannedResult(); mutate(value.preliminary_notice.planned_notice_targets[0]);
    assert.equal(valid(value), false, JSON.stringify(value.preliminary_notice.planned_notice_targets[0]));
  }
  const unicode = plannedResult(); unicode.preliminary_notice.planned_notice_targets[0].description = '😀'.repeat(2000);
  assert.equal(valid(unicode), true);
  unicode.preliminary_notice.planned_notice_targets[0].description = ' ';
  assert.equal(valid(unicode), true); // Match the API Text model; do not introduce trim-only restrictions.
});

test('known own facts, parent evidence and cross-kind identities fail closed', () => {
  for (const mutate of [
    v => { v.inputs.events.waiver.answer = 'unknown'; },
    v => { delete v.inputs.events.waiver; },
    v => { v.preliminary_notice.event_ids = ['project_completed']; },
    v => { v.sources.push({ id: 'other', section: 'Synthetic', official_url: 'https://example.org/other' });
      v.preliminary_notice.planned_notice_targets[0].source_ids = ['other']; },
    v => { v.preliminary_notice.planned_notice_targets[0].id = 'confirmed_first'; },
    v => { v.preliminary_notice.planned_notice_targets.push(structuredClone(v.preliminary_notice.planned_notice_targets[0])); },
    v => { v.preliminary_notice.deadline = '2027-01-13'; v.preliminary_notice.days_from_now = 226; },
  ]) { const value = plannedResult(); mutate(value); assert.equal(valid(value), false); }
});

test('new planning reference limits mirror the API without changing old confirmed fields', () => {
  const events = plannedResult();
  const eventIds = ['project_completed', ...Array.from({ length: 63 }, (_, i) => `fact_${i}`)];
  events.inputs.events = Object.fromEntries(eventIds.map(id => [id, { answer: 'no' }]));
  events.preliminary_notice.event_ids = eventIds;
  events.preliminary_notice.planned_notice_targets[0].event_ids = [...eventIds];
  assert.equal(valid(events), true);
  events.inputs.events.extra_fact = { answer: 'no' };
  events.preliminary_notice.event_ids.push('extra_fact');
  events.preliminary_notice.planned_notice_targets[0].event_ids.push('extra_fact');
  assert.equal(valid(events), false);
  const sources = plannedResult();
  for (let i = 0; i < 63; i++) sources.sources.push({ id: `source_${i}`, section: 'Synthetic', official_url: 'https://example.org/synthetic' });
  sources.preliminary_notice.source_ids = sources.sources.map(s => s.id);
  sources.preliminary_notice.planned_notice_targets[0].source_ids = [...sources.preliminary_notice.source_ids];
  assert.equal(valid(sources), true);
  sources.sources.push({ id: 'extra_source', section: 'Synthetic', official_url: 'https://example.org/synthetic' });
  sources.preliminary_notice.source_ids.push('extra_source');
  sources.preliminary_notice.planned_notice_targets[0].source_ids.push('extra_source');
  assert.equal(valid(sources), false);
  const long = plannedResult(), id = 's'.repeat(2001);
  long.sources.push({ id, section: 'Synthetic', official_url: 'https://example.org/synthetic' });
  long.preliminary_notice.source_ids.push(id);
  long.preliminary_notice.planned_notice_targets[0].source_ids = [id];
  assert.equal(valid(long), false);
});

test('explicit collections cannot escape their parent or exceed the API collection bound', () => {
  for (const collection of [null, undefined, [], {}, 'plan']) {
    const value = plannedResult(); value.preliminary_notice.planned_notice_targets = collection;
    assert.equal(valid(value), false);
  }
  const value = plannedResult(), plans = value.preliminary_notice.planned_notice_targets;
  value.lien_filing = { ...value.lien_filing, planned_notice_targets: plans };
  assert.equal(valid(value), false);
  delete value.lien_filing.planned_notice_targets;
  value.planned_notice_targets = plans;
  assert.equal(valid(value), false);
  delete value.planned_notice_targets;
  value.preliminary_notice.planned_notice_targets = Array.from({ length: 16 }, (_, i) => ({ ...structuredClone(plans[0]), id: `plan_${i}` }));
  assert.equal(valid(value), true);
  value.preliminary_notice.planned_notice_targets.push({ ...structuredClone(plans[0]), id: 'plan_16' });
  assert.equal(valid(value), false);
});

test('API adapter preserves qualified plans exactly and rejects malformed presence without scalar fallback', async t => {
  let body = plannedResult(); const original = structuredClone(body), input = structuredClone(body.inputs);
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    assert.deepEqual(JSON.parse(options.body), input);
    assert.equal(new Headers(options.headers).get('Authorization'), `Bearer ${KEY}`);
    assert.equal(options.redirect, 'error');
    return Response.json(body);
  });
  assert.deepEqual(await calculateSupplierDeadlinesV3(BASE, input, KEY), original);
  body.preliminary_notice.planned_notice_targets[0].basis.minimum_interval_days = 20;
  await assert.rejects(() => calculateSupplierDeadlinesV3(BASE, input, KEY), /no dates/);
  body = plannedResult(); body.preliminary_notice.planned_notice_targets = [];
  await assert.rejects(() => calculateSupplierDeadlinesV3(BASE, input, KEY), /no dates/);
});

test('MCP protocol reports planning assumptions with additive recurring input and unchanged tool inventory', async t => {
  const body = plannedResult(), input = body.inputs;
  t.mock.method(globalThis, 'fetch', async () => Response.json(body));
  const server = buildServer({ includeCustomerTools: false, customerApiKey: KEY });
  const client = new Client({ name: 'synthetic-planning-test', version: '0.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport); await client.connect(clientTransport);
  try {
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map(x => x.name), ['calculate_supplier_deadlines', 'get_supplier_questions',
      'calculate_supplier_deadlines_v3', 'get_state_lien_guide', 'list_state_lien_guides']);
    const tool = tools.find(x => x.name === 'calculate_supplier_deadlines_v3');
    assert.deepEqual(Object.keys(tool.inputSchema.properties).sort(),
      ['state', 'project_type', 'hired_by', 'rules_source', 'questions_identity', 'events', 'recurring_notice_facts'].sort());
    assert.match(tool.description, /planned_notice_targets/);
    assert.match(client.getInstructions(), /assumed filing date, full ten- or thirty-day interval/);
    assert.match(client.getInstructions(), /Earlier actual filing requires the full interval/);
    assert.match(client.getInstructions(), /do not establish a statutory expiration, actual filing, sent notice, completion or scheduled notification/);
    const { contract_version, role, ...args } = input;
    const response = await client.callTool({ name: tool.name, arguments: args });
    assert.notEqual(response.isError, true);
    assert.deepEqual(JSON.parse(response.content[0].text), body);
  } finally { await client.close(); await server.close(); }
});

// Real API full-engine outputs exported after root's final .7 binding, with synthetic
// offline approval only. These are neither hosted API results nor legal approval.
const freshBytes = readFileSync(new URL('./fixtures/supplier_planned_notice_targets_v1.json', import.meta.url));
const fresh = JSON.parse(freshBytes);
test('final bound API planning fixture remains an exact exported byte copy', () => {
  assert.equal(createHash('sha256').update(freshBytes).digest('hex'), 'aad36db40b4a24ce2a44b2a3cd6884c9ac395bd3b0edc127951c9a789ef6c4cf');
  assert.equal(fresh.source_version, '2026-10-13.7');
  assert.equal(fresh.synthetic_approval_only, true);
  assert.equal(fresh.cases.length, 46);
});
for (const item of fresh.cases) test(`actual bound API planning output validates unchanged: ${item.id}`, () => {
  const scope = Object.fromEntries(['contract_version', 'state', 'role', 'project_type', 'hired_by'].map(k => [k, item.request[k]]));
  assert.equal(isSupplierRequestV3(item.request), true);
  assert.equal(isSupplierDiscovery(item.discovery, scope), true);
  assert.equal(isSupplierResultV3(item.result, item.request), true);
  for (const plan of item.result.preliminary_notice.planned_notice_targets ?? []) {
    assert.equal(plan.status, 'planning_target');
    assert.ok((Date.parse(plan.basis.assumed_filing_date) - Date.parse(plan.target_date)) / 86400000 >= plan.basis.minimum_interval_days);
    assert.equal(Object.hasOwn(plan, 'deadline'), false);
    assert.equal(Object.hasOwn(plan, 'sent_date'), false);
  }
});

test('actual calendar and fallback fixtures retain qualified plans and independent legal holds', () => {
  const item = id => fresh.cases.find(row => row.id === id).result;
  const plan = id => item(id).preliminary_notice.planned_notice_targets[0];
  assert.deepEqual([plan('replay_1').target_date, plan('replay_1').basis.assumed_filing_date], ['2026-12-01', '2026-12-11']);
  assert.equal(item('replay_1').lien_filing.deadline, '2026-12-12');
  assert.deepEqual([plan('replay_4').target_date, plan('replay_4').basis.assumed_filing_date], ['2027-01-13', '2027-02-12']);
  assert.equal(item('replay_4').lien_filing.status, 'review_required');
  assert.equal(item('replay_4').lien_filing.deadline, null);
  assert.deepEqual([plan('replay_14').target_date, plan('replay_14').basis.assumed_filing_date], ['2026-06-02', '2026-07-02']);
  assert.equal(item('replay_14').lien_filing.deadline, '2026-07-03');
  for (const id of ['wi_full_interval_sunday_target', 'pa_full_interval_sunday_target']) {
    assert.deepEqual([plan(id).target_date, plan(id).basis.assumed_filing_date], ['2026-11-01', '2026-12-01']);
  }
  for (const id of ['wi_year_end', 'pa_year_end']) {
    assert.deepEqual([plan(id).target_date, plan(id).basis.assumed_filing_date], ['2027-05-31', '2027-06-30']);
  }
  for (const id of ['replay_11', 'replay_15', 'replay_16', 'replay_17',
    'wi_new2027_event_hold', 'pa_new2027_event_hold', 'ar_new2027_event_hold']) {
    assert.equal(Object.hasOwn(item(id).preliminary_notice, 'planned_notice_targets'), false, id);
  }
});

test('actual API fixture transport preserves all 46 results and rejects forged qualified metadata', async t => {
  let current, calls = 0;
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    calls++;
    assert.deepEqual(JSON.parse(options.body), current.request);
    assert.equal(new Headers(options.headers).get('Authorization'), `Bearer ${KEY}`);
    assert.equal(options.redirect, 'error');
    return Response.json(current.result);
  });
  for (const item of fresh.cases) {
    current = item;
    assert.deepEqual(await calculateSupplierDeadlinesV3(BASE, item.request, KEY), item.result);
  }
  assert.equal(calls, 46);
  current = structuredClone(fresh.cases.find(row => row.id === 'replay_1'));
  current.result.preliminary_notice.planned_notice_targets[0].target_date = '2026-12-02';
  await assert.rejects(() => calculateSupplierDeadlinesV3(BASE, current.request, KEY), /no dates/);
  current = structuredClone(fresh.cases.find(row => row.id === 'replay_4'));
  current.result.preliminary_notice.planned_notice_targets[0].id = current.result.preliminary_notice.notice_duties[0].id;
  await assert.rejects(() => calculateSupplierDeadlinesV3(BASE, current.request, KEY), /no dates/);
});
