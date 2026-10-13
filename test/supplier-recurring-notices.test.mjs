import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { isSupplierDiscovery, isSupplierRequestV3, isSupplierResultV3 } from '../src/supplier-v3.ts';
import { calculateSupplierDeadlinesV3 } from '../src/api.ts';
import { result, discovery, scope } from './supplier-v3-fixture.mjs';
import './mock-runtime.mjs';
const { buildServer } = await import('../src/server.ts');
const KEY = 'ld_live_' + 'a'.repeat(32) + '.' + 'b'.repeat(43);
const BASE = 'https://secure-api-v1.liendeadline.com';
const checkpointId = id => 'nh_account_check_in_' + createHash('sha256').update(JSON.stringify(id)).digest('hex').slice(0, 16);
const valid = value => isSupplierResultV3(value, value.inputs);
// Synthetic contract fixtures; not statute calculations, legal approval or service evidence.
function tnResult() {
  const value = structuredClone(result);
  value.preliminary_notice = structuredClone(value.preliminary_notice);
  value.state_code = value.inputs.state = 'TN';
  value.as_of_date = '2026-10-01';
  value.lien_filing.days_from_now = value.preliminary_notice.days_from_now = -92;
  value.inputs.recurring_notice_facts = { version: 'supplier-recurring-facts-v1', kind: 'tn_monthly_nonpayment', months: [
    { month: '2026-06', unpaid: 'yes', retainage_only: 'no' },
    { month: '2026-08', unpaid: 'unknown', retainage_only: 'unknown' },
  ] };
  value.critical_warnings = ['Synthetic: entered periods only; unknown August remains unresolved.'];
  value.preliminary_notice.notice_duties = [{ id: 'tn_nonpayment_2026_06', name: 'Synthetic June notice', description: 'Independent entered month.',
    status: 'calculated', required: true, deadline: '2026-07-01', days_from_now: -92, event_ids: ['project_completed'], source_ids: ['test'] }];
  value.preliminary_notice.recurring_coverage = 'entered_periods_only';
  value.preliminary_notice.recurring_notice_periods = [
    { id: 'tn_nonpayment_2026_06', month: '2026-06', status: 'calculated', reason_code: 'actual_unpaid_furnished_month' },
    { id: 'tn_nonpayment_2026_08', month: '2026-08', status: 'review_required', reason_code: 'synthetic_unknown' },
  ];
  return value;
}
function nhResult() {
  const value = structuredClone(result);
  value.preliminary_notice = structuredClone(value.preliminary_notice);
  value.state_code = value.inputs.state = 'NH';
  value.as_of_date = '2026-07-01';
  value.lien_filing.days_from_now = 0;
  value.inputs.recurring_notice_facts = { version: 'supplier-recurring-facts-v1', kind: 'nh_written_account', accounts: [] };
  value.inputs.events.nh_owner_notice_given = { answer: 'yes', date: '2026-06-01' };
  value.status = 'review_required';
  value.preliminary_notice = { ...value.preliminary_notice, status: 'review_required', required: null, deadline: null, days_from_now: null,
    event_ids: ['nh_owner_notice_given'], recurring_notice_checkpoints: [{ id: 'nh_account_check_in_owner_notice', name: 'Synthetic account check-in',
      description: 'Advisory only; earlier gaps remain unresolved.', status: 'advisory_checkpoint', legal_status: 'review_required',
      target_date: '2026-07-01', basis: { kind: 'nh_account_check_in', anchor_kind: 'owner_notice_given', anchor_date: '2026-06-01',
        account_id: null, covered_through: null, interval_days: 30 }, event_ids: ['nh_owner_notice_given'], source_ids: ['test'] }] };
  value.critical_warnings = ['Advisory checkpoint; legal account timing requires review.'];
  return value;
}

test('optional recurring request preserves legacy and accepts actual TN and NH facts', () => {
  assert.equal(isSupplierRequestV3(result.inputs), true);
  assert.equal(isSupplierRequestV3(tnResult().inputs), true);
  assert.equal(isSupplierRequestV3(nhResult().inputs), true);
  const value = nhResult().inputs;
  value.recurring_notice_facts.accounts = [{ id: 'account_1', covered_through: '2026-06-20', supplied_date: '2026-06-21' }];
  assert.equal(isSupplierRequestV3(value), true);
});

test('recurring input rejects null, foreign kinds, extras, duplicate records and malformed actual dates', () => {
  for (const mutate of [
    v => { v.recurring_notice_facts = null; }, v => { v.recurring_notice_facts = undefined; },
    v => { v.recurring_notice_facts.extra = true; }, v => { v.recurring_notice_facts.version = 'future'; },
    v => { v.state = 'WI'; }, v => { v.project_type = 'public'; }, v => { v.hired_by = 'owner'; }, v => { v.recurring_notice_facts.months = []; },
    v => { v.recurring_notice_facts.months[0].month = '2026-13'; }, v => { v.recurring_notice_facts.months[0].month = '2026-6'; },
    v => { v.recurring_notice_facts.months[0].month = '1899-12'; },
    v => { v.recurring_notice_facts.months[0].unpaid = true; },
    v => { v.recurring_notice_facts.months[0].retainage_only = null; },
    v => { v.recurring_notice_facts.months[0].invoice_date = '2026-06-01'; },
    v => { v.recurring_notice_facts.months.push(structuredClone(v.recurring_notice_facts.months[0])); },
    v => { v.recurring_notice_facts.months = Array.from({ length: 17 }, (_, i) => ({ month: `202${6 + Math.floor(i / 12)}-${String(i % 12 + 1).padStart(2, '0')}`, unpaid: 'yes', retainage_only: 'no' })); },
  ]) { const value = tnResult().inputs; mutate(value); assert.equal(isSupplierRequestV3(value), false, JSON.stringify(value)); }
  for (const mutate of [
    a => { a.id = 'Bad-ID'; }, a => { a.covered_through = '2026-02-30'; },
    a => { a.supplied_date = null; }, a => { a.covered_through = '2026-06-22'; },
    a => { a.completed = true; },
  ]) { const value = nhResult().inputs; const a = { id: 'account_1', covered_through: '2026-06-20', supplied_date: '2026-06-21' };
    mutate(a); value.recurring_notice_facts.accounts = [a]; assert.equal(isSupplierRequestV3(value), false); }
  const duplicate = nhResult().inputs;
  duplicate.recurring_notice_facts.accounts = Array.from({ length: 2 }, () => ({ id: 'account_1', covered_through: '2026-06-20', supplied_date: '2026-06-21' }));
  assert.equal(isSupplierRequestV3(duplicate), false);
});

test('TN period ledger keeps unknown entries and paid/held outcomes without synthesizing intervening months', () => {
  const value = tnResult(); assert.equal(valid(value), true);
  assert.deepEqual(value.preliminary_notice.recurring_notice_periods.map(p => p.month), ['2026-06', '2026-08']);
  for (const [status, required] of [['not_required', false], ['review_required', null]]) {
    const held = tnResult();
    delete held.preliminary_notice.notice_duties;
    held.preliminary_notice = { ...held.preliminary_notice, status, required, deadline: null, days_from_now: null };
    held.preliminary_notice.recurring_notice_periods.forEach(p => { p.status = status; });
    if (status === 'not_required') { held.inputs.recurring_notice_facts.months.forEach(m => { m.unpaid = 'no'; });
      held.preliminary_notice.recurring_notice_periods.forEach(p => { p.reason_code = 'entered_month_currently_paid'; }); }
    held.status = status === 'not_required' ? 'calculated' : 'review_required';
    assert.equal(valid(held), true, status);
  }
});

test('TN malformed period metadata cannot fall back to the old scalar', () => {
  for (const mutate of [
    v => { delete v.preliminary_notice.recurring_coverage; },
    v => { delete v.preliminary_notice.recurring_coverage; delete v.preliminary_notice.recurring_notice_periods; delete v.preliminary_notice.notice_duties; },
    v => { delete v.preliminary_notice.recurring_notice_periods; },
    v => { v.preliminary_notice.recurring_notice_periods = null; },
    v => { v.preliminary_notice.recurring_notice_periods = []; },
    v => { v.preliminary_notice.recurring_coverage = 'all_periods'; },
    v => { v.preliminary_notice.recurring_notice_periods[0].extra = true; },
    v => { v.preliminary_notice.recurring_notice_periods[0].id = 'wrong'; },
    v => { v.preliminary_notice.recurring_notice_periods[0].reason_code = 'Bad-ID'; },
    v => { v.preliminary_notice.recurring_notice_periods[1].status = 'calculated'; },
    v => { v.preliminary_notice.recurring_notice_periods[0].status = 'not_required'; },
    v => { v.preliminary_notice.recurring_notice_periods[1] = structuredClone(v.preliminary_notice.recurring_notice_periods[0]); },
    v => { delete v.inputs.recurring_notice_facts; }, v => { v.inputs.recurring_notice_facts = nhResult().inputs.recurring_notice_facts; },
    v => { v.lien_filing.recurring_coverage = 'entered_periods_only'; },
    v => { v.recurring_notice_periods = v.preliminary_notice.recurring_notice_periods; },
  ]) { const value = tnResult(); mutate(value); assert.equal(valid(value), false); }
});

test('NH check-ins are separate advisory evidence, never legal deadlines or completion', () => {
  const value = nhResult(); assert.equal(valid(value), true);
  assert.equal(value.preliminary_notice.deadline, null);
  const p = value.preliminary_notice.recurring_notice_checkpoints[0];
  assert.equal(p.legal_status, 'review_required');
  assert.equal(Object.hasOwn(p, 'required'), false);
  value.inputs.recurring_notice_facts.accounts = [{ id: 'account_1', covered_through: '2026-06-20', supplied_date: '2026-06-21' }];
  p.id = checkpointId('account_1');
  p.target_date = '2026-07-21';
  p.basis = { kind: 'nh_account_check_in', anchor_kind: 'account_supplied', anchor_date: '2026-06-21',
    account_id: 'account_1', covered_through: '2026-06-20', interval_days: 30 };
  assert.equal(valid(value), true);
});

test('NH malformed checkpoint or substituted actual evidence fails closed', () => {
  for (const mutate of [
    v => { v.preliminary_notice.recurring_notice_checkpoints = null; },
    v => { v.preliminary_notice.recurring_notice_checkpoints = []; },
    v => { v.preliminary_notice.recurring_notice_checkpoints.push(structuredClone(v.preliminary_notice.recurring_notice_checkpoints[0])); },
    v => { v.preliminary_notice.recurring_notice_checkpoints[0].deadline = '2026-07-01'; },
    v => { v.preliminary_notice.recurring_notice_checkpoints[0].status = 'calculated'; },
    v => { v.preliminary_notice.recurring_notice_checkpoints[0].legal_status = 'calculated'; },
    v => { v.preliminary_notice.recurring_notice_checkpoints[0].target_date = '2026-07-02'; },
    v => { v.preliminary_notice.recurring_notice_checkpoints[0].basis.interval_days = '30'; },
    v => { v.preliminary_notice.recurring_notice_checkpoints[0].basis.extra = true; },
    v => { v.preliminary_notice.recurring_notice_checkpoints[0].basis.anchor_date = '2026-06-02'; },
    v => { v.preliminary_notice.recurring_notice_checkpoints[0].event_ids = ['project_completed']; },
    v => { v.preliminary_notice.recurring_notice_checkpoints[0].source_ids = ['missing']; },
    v => { v.inputs.events.nh_owner_notice_given.answer = 'unknown'; },
    v => { delete v.inputs.events.nh_owner_notice_given; },
    v => { delete v.inputs.recurring_notice_facts; },
    v => { v.lien_filing.recurring_notice_checkpoints = v.preliminary_notice.recurring_notice_checkpoints; },
    v => { v.recurring_notice_checkpoints = v.preliminary_notice.recurring_notice_checkpoints; },
  ]) { const value = nhResult(); mutate(value); assert.equal(valid(value), false); }
});

test('adapter retains actual recurring intake and rejects malformed ledger with no scalar fallback', async t => {
  let body = tnResult(); const input = structuredClone(body.inputs);
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    assert.deepEqual(JSON.parse(options.body), input);
    return Response.json(body);
  });
  assert.deepEqual(await calculateSupplierDeadlinesV3(BASE, input, KEY), body);
  body.preliminary_notice.recurring_notice_periods[1].status = 'calculated';
  await assert.rejects(() => calculateSupplierDeadlinesV3(BASE, input, KEY), /no dates/);
});

test('protocol exposes optional strict actual recurring intake and forwards it without new tools', async t => {
  let body = tnResult(), calls = 0;
  t.mock.method(globalThis, 'fetch', async (_url, options) => { calls++; assert.deepEqual(JSON.parse(options.body), body.inputs); return Response.json(body); });
  const server = buildServer({ includeCustomerTools: false, customerApiKey: KEY });
  const client = new Client({ name: 'synthetic-recurring-test', version: '0.0.0' });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st); await client.connect(ct);
  try {
    const { tools } = await client.listTools();
    assert.equal(tools.length, 5);
    const tool = tools.find(x => x.name === 'calculate_supplier_deadlines_v3');
    assert.ok(tool.inputSchema.properties.recurring_notice_facts);
    assert.equal(tool.inputSchema.required.includes('recurring_notice_facts'), false);
    assert.match(client.getInstructions(), /Do not infer intervening months/);
    assert.match(client.getInstructions(), /blanket cadence reset/);
    for (const value of [tnResult(), nhResult()]) {
      body = value; const { contract_version, role, ...args } = value.inputs;
      const response = await client.callTool({ name: tool.name, arguments: args });
      assert.notEqual(response.isError, true); assert.deepEqual(JSON.parse(response.content[0].text), value);
    }
    const count = calls;
    const { contract_version, role, ...args } = body.inputs;
    for (const facts of [null, { ...args.recurring_notice_facts, extra: true },
      { version: 'supplier-recurring-facts-v1', kind: 'future', accounts: [] }]) {
      const response = await client.callTool({ name: tool.name, arguments: { ...args, recurring_notice_facts: facts } });
      assert.equal(response.isError, true);
    }
    assert.equal(calls, count);
  } finally { await client.close(); await server.close(); }
});


test('discovery recurring intake descriptor is exact, optional and never inferred from state', () => {
  assert.equal(isSupplierDiscovery(discovery, scope), true);
  for (const [kind, omission_policy] of [['tn_monthly_nonpayment', 'legacy_earliest_month'], ['nh_written_account', 'no_account_checkpoint']]) {
    const value = structuredClone(discovery);
    value.recurring_notice_intake = { version: 'supplier-recurring-facts-v1', kind, max_records: 16, omission_policy,
      label: 'Synthetic intake', help: 'Actual facts; missing periods remain unresolved.' };
    assert.equal(isSupplierDiscovery(value, scope), true);
    for (const mutate of [
      d => { d.extra = true; }, d => { delete d.label; }, d => { d.version = 'future'; },
      d => { d.max_records = 17; }, d => { d.kind = 'future'; }, d => { d.label = ''; },
      d => { d.help = 'x'.repeat(2001); }, d => { d.omission_policy = kind === 'nh_written_account' ? 'legacy_earliest_month' : 'no_account_checkpoint'; },
    ]) { const bad = structuredClone(value); mutate(bad.recurring_notice_intake); assert.equal(isSupplierDiscovery(bad, scope), false); }
  }
  for (const intake of [null, undefined, {}]) { const value = structuredClone(discovery); value.recurring_notice_intake = intake;
    assert.equal(isSupplierDiscovery(value, scope), false); }
});


test('TN typed month alone supports empty event refs, while historical duties cannot lose own evidence', () => {
  const value = tnResult();
  value.preliminary_notice.notice_duties[0].event_ids = [];
  value.preliminary_notice.event_ids = [];
  assert.equal(valid(value), true);
  delete value.preliminary_notice.recurring_notice_periods;
  delete value.preliminary_notice.recurring_coverage;
  assert.equal(valid(value), false);
  const historical = structuredClone(result);
  historical.preliminary_notice = structuredClone(historical.preliminary_notice);
  historical.preliminary_notice.notice_duties = [{ id: 'historical', name: 'Synthetic duty', description: 'Known event required.',
    status: 'calculated', required: true, deadline: '2026-07-01', days_from_now: 30, event_ids: [], source_ids: ['test'] }];
  assert.equal(valid(historical), false);
});

test('NH retains independent calculated notices and rejects cross-kind identity collisions', () => {
  const value = nhResult();
  value.preliminary_notice = { ...value.preliminary_notice, status: 'calculated', required: true, deadline: '2026-07-01', days_from_now: 0,
    notice_duties: [{ id: 'one_time_owner', name: 'Synthetic one-time notice', description: 'Independent from account checkpoint.',
      status: 'calculated', required: true, deadline: '2026-07-01', days_from_now: 0, event_ids: ['nh_owner_notice_given'], source_ids: ['test'] }] };
  value.status = 'calculated';
  assert.equal(valid(value), true);
  value.preliminary_notice.notice_duties[0].id = value.preliminary_notice.recurring_notice_checkpoints[0].id;
  assert.equal(valid(value), false);
});

test('NH latest actual account anchor is exact and earlier missing coverage remains unresolved', () => {
  const value = nhResult(), checkpoint = value.preliminary_notice.recurring_notice_checkpoints[0];
  value.inputs.recurring_notice_facts.accounts = [
    { id: 'earlier', covered_through: '2026-06-19', supplied_date: '2026-06-20' },
    { id: 'later', covered_through: '2026-06-25', supplied_date: '2026-06-27' },
  ];
  checkpoint.id = checkpointId('later');
  checkpoint.target_date = '2026-07-27';
  checkpoint.basis = { kind: 'nh_account_check_in', anchor_kind: 'account_supplied', anchor_date: '2026-06-27',
    account_id: 'later', covered_through: '2026-06-25', interval_days: 30 };
  assert.equal(valid(value), true);
  checkpoint.id = checkpointId('earlier');
  checkpoint.target_date = '2026-07-20';
  checkpoint.basis = { ...checkpoint.basis, anchor_date: '2026-06-20', account_id: 'earlier', covered_through: '2026-06-19' };
  assert.equal(valid(value), false);
});


test('actual as-of bounds and paid/unresolved classification cannot be forged', () => {
  for (const mutate of [
    v => { v.inputs.recurring_notice_facts.months[0].unpaid = 'unknown'; },
    v => { v.inputs.recurring_notice_facts.months[0].retainage_only = 'yes'; },
    v => { v.as_of_date = '2026-05-31'; },
  ]) { const value = tnResult(); mutate(value); assert.equal(valid(value), false); }
  const paid = tnResult(); delete paid.preliminary_notice.notice_duties;
  paid.preliminary_notice = { ...paid.preliminary_notice, status: 'not_required', required: false, deadline: null, days_from_now: null };
  paid.preliminary_notice.recurring_notice_periods.forEach(p => { p.status = 'not_required'; });
  assert.equal(valid(paid), false); // Unpaid/unknown inputs cannot be relabeled paid.
  for (const mutate of [
    v => { v.inputs.events.nh_owner_notice_given.date = '2026-07-02'; },
    v => { v.inputs.recurring_notice_facts.accounts = [{ id: 'future', covered_through: '2026-07-01', supplied_date: '2026-07-02' }]; },
    v => { v.inputs.recurring_notice_facts.accounts = [{ id: 'before_owner', covered_through: '2026-05-20', supplied_date: '2026-05-21' }]; },
  ]) { const value = nhResult(); mutate(value); assert.equal(valid(value), false); }
});

test('NH deterministic latest anchor uses complete tuple and bounded hashed occurrence identity', () => {
  const value = nhResult(), p = value.preliminary_notice.recurring_notice_checkpoints[0];
  const long = 'z'.repeat(80);
  value.inputs.recurring_notice_facts.accounts = [
    { id: 'a', covered_through: '2026-06-20', supplied_date: '2026-06-21' },
    { id: long, covered_through: '2026-06-20', supplied_date: '2026-06-21' },
  ];
  p.id = checkpointId(long); p.target_date = '2026-07-21';
  p.basis = { kind: 'nh_account_check_in', anchor_kind: 'account_supplied', anchor_date: '2026-06-21',
    account_id: long, covered_through: '2026-06-20', interval_days: 30 };
  assert.equal(valid(value), true); assert.ok(p.id.length <= 80);
  p.id = checkpointId('a'); p.basis.account_id = 'a'; assert.equal(valid(value), false);
});


test('recurring collections enforce exact shapes, text bounds and capacity without truncation', () => {
  const original = nhResult().preliminary_notice.recurring_notice_checkpoints[0];
  for (const key of Object.keys(original)) {
    const value = nhResult(); delete value.preliminary_notice.recurring_notice_checkpoints[0][key]; assert.equal(valid(value), false, key);
  }
  for (const key of Object.keys(original.basis)) {
    const value = nhResult(); delete value.preliminary_notice.recurring_notice_checkpoints[0].basis[key]; assert.equal(valid(value), false, key);
  }
  for (const mutate of [
    p => { p.basis.anchor_kind = 'future'; }, p => { p.basis.account_id = undefined; },
    p => { p.basis.anchor_kind = 'account_supplied'; p.basis.account_id = undefined; },
    p => { p.event_ids = []; }, p => { p.event_ids.push('nh_owner_notice_given'); },
    p => { p.source_ids = []; }, p => { p.source_ids.push('test'); },
    p => { p.description = ''; }, p => { p.description = '😀'.repeat(2001); },
    p => { p.event_ids = Array(65).fill('nh_owner_notice_given'); },
    p => { p.source_ids = Array(65).fill('test'); },
  ]) { const value = nhResult(); mutate(value.preliminary_notice.recurring_notice_checkpoints[0]); assert.equal(valid(value), false); }
  const unicode = nhResult(); unicode.preliminary_notice.recurring_notice_checkpoints[0].description = '😀'.repeat(2000);
  assert.equal(valid(unicode), true);
  const value = tnResult().inputs;
  value.recurring_notice_facts.months = Array.from({ length: 16 }, (_, i) => ({ month: `202${5 + Math.floor(i / 12)}-${String(i % 12 + 1).padStart(2, '0')}`, unpaid: 'no', retainage_only: 'unknown' }));
  assert.equal(isSupplierRequestV3(value), true);
  const accounts = nhResult().inputs;
  accounts.recurring_notice_facts.accounts = Array.from({ length: 16 }, (_, i) => ({ id: `account_${i}`, covered_through: '2026-06-20', supplied_date: '2026-06-21' }));
  assert.equal(isSupplierRequestV3(accounts), true);
  accounts.recurring_notice_facts.accounts.push({ id: 'seventeenth', covered_through: '2026-06-20', supplied_date: '2026-06-21' });
  assert.equal(isSupplierRequestV3(accounts), false);
});


test('known residential unit exemption is exact and not-required cannot omit the ledger', () => {
  const value = tnResult(); delete value.preliminary_notice.notice_duties;
  value.inputs.project_type = 'residential'; value.inputs.events.tn_one_to_four_units = { answer: 'yes' };
  value.preliminary_notice = { ...value.preliminary_notice, status: 'not_required', required: false, deadline: null, days_from_now: null };
  value.preliminary_notice.recurring_notice_periods.forEach(p => { p.status = 'not_required'; p.reason_code = 'recurring_scope_not_required'; });
  assert.equal(valid(value), true);
  for (const mutate of [
    v => { v.inputs.project_type = 'commercial'; },
    v => { v.inputs.events.tn_one_to_four_units.answer = 'unknown'; },
    v => { delete v.inputs.events.tn_one_to_four_units; },
    v => { delete v.preliminary_notice.recurring_notice_periods; delete v.preliminary_notice.recurring_coverage; },
    v => { v.preliminary_notice.recurring_notice_periods[0].reason_code = 'entered_month_currently_paid'; },
  ]) { const bad = structuredClone(value); mutate(bad); assert.equal(valid(bad), false); }
  for (const status of ['review_required', 'no_lien_right']) {
    const held = tnResult(); delete held.preliminary_notice.notice_duties;
    delete held.preliminary_notice.recurring_notice_periods; delete held.preliminary_notice.recurring_coverage;
    const required = status === 'no_lien_right' ? false : null;
    held.preliminary_notice = { ...held.preliminary_notice, status, required, deadline: null, days_from_now: null };
    if (status === 'no_lien_right') held.lien_filing = { ...held.lien_filing, status, required, deadline: null, days_from_now: null };
    held.status = status; assert.equal(valid(held), true);
  }
});


test('2025 source-held month preserves known June residential exemption under aggregate review', () => {
  const value = tnResult(); delete value.preliminary_notice.notice_duties;
  value.inputs.project_type = 'residential'; value.inputs.events.tn_one_to_four_units = { answer: 'yes' };
  value.inputs.recurring_notice_facts.months = [
    { month: '2025-12', unpaid: 'yes', retainage_only: 'no' },
    { month: '2026-06', unpaid: 'yes', retainage_only: 'no' },
  ];
  value.preliminary_notice = { ...value.preliminary_notice, status: 'review_required', required: null, deadline: null, days_from_now: null,
    recurring_notice_periods: [
      { id: 'tn_nonpayment_2025_12', month: '2025-12', status: 'review_required', reason_code: 'synthetic_source_window_hold' },
      { id: 'tn_nonpayment_2026_06', month: '2026-06', status: 'not_required', reason_code: 'recurring_scope_not_required' },
    ] };
  value.status = 'review_required';
  assert.equal(valid(value), true);
  for (const mutate of [
    v => { v.inputs.events.tn_one_to_four_units.answer = 'unknown'; },
    v => { v.preliminary_notice.status = 'calculated'; v.preliminary_notice.required = true;
      v.preliminary_notice.deadline = '2026-07-01'; v.preliminary_notice.days_from_now = -92; v.status = 'calculated'; },
    v => { v.preliminary_notice.status = 'no_lien_right'; v.preliminary_notice.required = false;
      v.lien_filing = { ...v.lien_filing, status: 'no_lien_right', required: false, deadline: null, days_from_now: null }; v.status = 'no_lien_right'; },
  ]) { const bad = structuredClone(value); mutate(bad); assert.equal(valid(bad), false); }
});


// Actual full-engine outputs after final root .8 binding, with synthetic offline
// approval only. These are not hosted API results or legal approval.
const freshBytes = readFileSync(new URL('./fixtures/supplier_recurring_notice_targets_v1.json', import.meta.url));
const fresh = JSON.parse(freshBytes);
test('final bound recurring fixture is the exact API export and preserves canonical versus synthetic identity', () => {
  assert.equal(createHash('sha256').update(freshBytes).digest('hex'), '20a413089186a8840c7eec4817cf0acb3bee5adc56e39e280b298e4b56a029ab');
  assert.equal(fresh.source_version, '2026-10-13.8'); assert.equal(fresh.synthetic_approval_only, true);
  assert.equal(fresh.canonical_yaml_sha256, 'de864f78ead48ea72789dc227d6ba6a1b16b2ac3ca99c286d6ece4917a1b9855');
  assert.notEqual(fresh.canonical_yaml_sha256, fresh.synthetic_rules_identity.source_hash);
  assert.equal(fresh.cases.length, 81);
});
for (const item of fresh.cases) test(`actual bound recurring API output validates unchanged: ${item.id}`, () => {
  const requestScope = Object.fromEntries(['contract_version', 'state', 'role', 'project_type', 'hired_by'].map(k => [k, item.request[k]]));
  assert.equal(isSupplierRequestV3(item.request), true);
  assert.equal(isSupplierDiscovery(item.discovery, requestScope), true);
  assert.equal(isSupplierResultV3(item.result, item.request), true);
});

test('actual recurring chronology preserves incomplete coverage, exemptions, holds and advisory civil dates', () => {
  const outcome = id => fresh.cases.find(row => row.id === id).result.preliminary_notice;
  const tn = outcome('tn_commercial_contractor_nonconsecutive');
  assert.deepEqual(tn.notice_duties.map(d => [d.id, d.deadline]), [
    ['tn_nonpayment_2026_06', '2026-09-28'], ['tn_nonpayment_2026_08', '2026-11-30']]);
  assert.equal(tn.recurring_coverage, 'entered_periods_only');
  assert.equal(tn.recurring_notice_periods.some(p => p.month === '2026-07'), false);
  assert.deepEqual(outcome('tn_commercial_contractor_mixed').recurring_notice_periods.map(p => p.status), ['calculated', 'not_required', 'review_required']);
  const exempt = outcome('tn_exempt_mixed_old_month');
  assert.equal(exempt.status, 'review_required'); assert.equal(exempt.deadline, null);
  assert.deepEqual(exempt.recurring_notice_periods.map(p => [p.month, p.status]), [['2025-12', 'review_required'], ['2026-06', 'not_required']]);
  for (const id of ['tn_exempt_actual_2027_held', 'tn_excluded_actual_2027_held', 'tn_calendar_outside_2028']) {
    assert.equal(outcome(id).deadline, null); assert.equal(Object.hasOwn(outcome(id), 'notice_duties'), false);
  }
  assert.equal(outcome('tn_calendar_2027').deadline, '2027-03-01');
  const owner = outcome('nh_commercial_contractor_owner_anchor').recurring_notice_checkpoints[0];
  assert.equal(owner.target_date, '2026-06-27'); // Saturday preserved for advisory civil+30.
  const account = outcome('nh_commercial_contractor_account_anchor').recurring_notice_checkpoints[0];
  assert.equal(account.target_date, '2026-07-20'); assert.equal(account.basis.account_id, 'june_account');
  assert.equal(account.legal_status, 'review_required'); assert.equal(Object.hasOwn(account, 'deadline'), false);
  assert.equal(outcome('nh_calendar_2027').recurring_notice_checkpoints[0].target_date, '2027-01-19');
  for (const id of ['nh_commercial_contractor_unknown_owner', 'nh_commercial_contractor_lender_completion_no_anchor', 'nh_calendar_outside_2028']) {
    assert.equal(Object.hasOwn(outcome(id), 'recurring_notice_checkpoints'), false);
  }
});

test('actual API transport preserves all 81 recurring results and rejects mutated authority', async t => {
  let current, calls = 0;
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    calls++; assert.deepEqual(JSON.parse(options.body), current.request);
    assert.equal(new Headers(options.headers).get('Authorization'), `Bearer ${KEY}`);
    assert.equal(options.redirect, 'error'); return Response.json(current.result);
  });
  for (const item of fresh.cases) { current = item;
    assert.deepEqual(await calculateSupplierDeadlinesV3(BASE, item.request, KEY), item.result); }
  assert.equal(calls, 81);
  current = structuredClone(fresh.cases.find(row => row.id === 'tn_commercial_contractor_two_payable'));
  delete current.result.preliminary_notice.recurring_notice_periods; delete current.result.preliminary_notice.recurring_coverage;
  await assert.rejects(() => calculateSupplierDeadlinesV3(BASE, current.request, KEY), /no dates/);
  current = structuredClone(fresh.cases.find(row => row.id === 'nh_commercial_contractor_account_anchor'));
  current.result.preliminary_notice.recurring_notice_checkpoints[0].legal_status = 'calculated';
  await assert.rejects(() => calculateSupplierDeadlinesV3(BASE, current.request, KEY), /no dates/);
});

test('actual fixture discovery and calculation traverse the MCP protocol unchanged for every entered case', async t => {
  let current, calls = 0;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls++; assert.equal(new Headers(options.headers).get('Authorization'), `Bearer ${KEY}`);
    const endpoint = new URL(url);
    if (endpoint.pathname.endsWith('/questions')) {
      for (const key of ['contract_version', 'state', 'role', 'project_type', 'hired_by']) {
        assert.equal(endpoint.searchParams.get(key), current.request[key]);
      }
      return Response.json(current.discovery);
    }
    assert.deepEqual(JSON.parse(options.body), current.request);
    return Response.json(current.result);
  });
  const server = buildServer({ includeCustomerTools: false, customerApiKey: KEY });
  const client = new Client({ name: 'actual-recurring-fixture-transport', version: '0.0.0' });
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
      const calculated = await client.callTool({ name: 'calculate_supplier_deadlines_v3', arguments: args });
      assert.notEqual(calculated.isError, true, item.id);
      assert.deepEqual(JSON.parse(calculated.content[0].text), item.result, item.id);
    }
    assert.equal(calls, 162);
  } finally { await client.close(); await server.close(); }
});
