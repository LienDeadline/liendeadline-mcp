import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { DEFAULT_BASE_URL, calculateSupplierDeadlines, isVerifiedSupplierCalculation } from '../src/api.ts';

registerHooks({
  resolve(specifier, context, nextResolve) {
    const fromSource = /\/src\/[\w-]+\.ts$/.test(context.parentURL ?? '');
    return nextResolve(fromSource && /^\.\/[\w-]+\.js$/.test(specifier) ? specifier.replace(/\.js$/, '.ts') : specifier, context);
  },
});
const { buildServer } = await import('../src/server.ts');
const KEY = `ld_live_${'0'.repeat(32)}.${'A'.repeat(43)}`;
const facts = {
  first_delivery_date: '2026-08-03', last_delivery_date: '2026-09-10',
  project_type: 'commercial', hired_by: 'subcontractor', deliveries_complete: true,
};
const deadline = (name, status, date = null) => ({
  name, status, deadline: date, days_from_now: date === null ? null : 30,
  required: status === 'review_required' ? null : status !== 'not_required',
  description: 'Synthetic supplier outcome',
});
const noticeReview = deadline('Preliminary notice', 'review_required');
const lienReview = deadline('Lien filing', 'review_required');
const noticeCalculated = deadline('Preliminary notice', 'calculated', '2026-09-17');
const lienCalculated = deadline('Lien filing', 'calculated', '2026-12-09');
const noNotice = deadline('Preliminary notice', 'not_required');
const awaiting = deadline('Lien filing', 'awaiting_final_delivery');
const florida = { state: 'FL', ...facts, florida_final_payment_status: 'no', florida_termination_status: 'no' };
const kansas = { state: 'KS', ...facts, kansas_extension_status: 'no' };
const cases = [
  // Known answers do not trigger the request-specific missing-event guards.
  ['Florida final payment requires notice review',
    { ...florida, florida_final_payment_status: 'yes', florida_final_payment_date: '2026-08-20' },
    noticeReview, lienCalculated],
  ['Kansas residential notice requires review',
    { ...kansas, project_type: 'residential' }, noticeReview, lienCalculated],
  ['unsupported jurisdiction requires review',
    { state: 'TX', ...facts }, noticeReview, lienReview],
];
const result = (input, notice, lien, status) => ({
  contract_version: 'supplier-events-v2', status, state_code: input.state, role: 'supplier',
  inputs: { contract_version: 'supplier-events-v2', ...input },
  preliminary_notice: notice, lien_filing: lien,
  critical_warnings: ['Synthetic warning'], statute_citations: [], disclaimer: 'Not legal advice.',
});

for (const [label, input, notice, lien] of cases) {
  test(`${label}: a calculated summary cannot hide child review`, async t => {
    const valid = result(input, notice, lien, 'review_required');
    const contradictory = { ...valid, status: 'calculated' };
    assert.equal(isVerifiedSupplierCalculation(valid, valid.inputs), true);
    assert.equal(isVerifiedSupplierCalculation(contradictory, valid.inputs), false);
    t.mock.method(globalThis, 'fetch', async () => Response.json(contradictory));
    await assert.rejects(() => calculateSupplierDeadlines(DEFAULT_BASE_URL, input, KEY), /no dates are reported/);
  });
}

for (const [label, input, notice, lien, status] of [
  ['fully calculated', florida, noticeCalculated, lienCalculated, 'calculated'],
  ['not-required notice with calculated lien', kansas, noNotice, lienCalculated, 'calculated'],
  ['calculated notice while deliveries continue', { ...florida, deliveries_complete: false }, noticeCalculated, awaiting, 'calculated'],
  ['Florida direct-owner awaiting final delivery', { ...florida, hired_by: 'owner', deliveries_complete: false }, noNotice, awaiting, 'review_required'],
  ['Kansas awaiting final delivery', { ...kansas, deliveries_complete: false }, noNotice, awaiting, 'review_required'],
  ['Florida lien review with calculated notice', { ...florida, florida_termination_status: 'unknown' }, noticeCalculated, lienReview, 'review_required'],
]) {
  test(`valid v2 aggregate survives: ${label}`, async t => {
    const expected = result(input, notice, lien, status);
    t.mock.method(globalThis, 'fetch', async () => Response.json(expected));
    assert.deepEqual(await calculateSupplierDeadlines(DEFAULT_BASE_URL, input, KEY), expected);
  });
}

test('registered MCP supplier tool reports an inconsistent aggregate as an error without returning dates', async t => {
  const [, input, notice, lien] = cases[1];
  const valid = result(input, notice, lien, 'review_required');
  let response = { ...valid, status: 'calculated' };
  t.mock.method(globalThis, 'fetch', async () => Response.json(response));
  const server = buildServer({ customerApiKey: KEY });
  const client = new Client({ name: 'supplier-aggregate-test', version: '0.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const rejected = await client.callTool({ name: 'calculate_supplier_deadlines', arguments: input });
    assert.equal(rejected.isError, true);
    const text = rejected.content.map(item => item.text ?? '').join('');
    assert.match(text, /no dates are reported/);
    assert.equal(text.includes(lien.deadline), false);
    assert.equal(text.includes(KEY), false);
    response = valid;
    const accepted = await client.callTool({ name: 'calculate_supplier_deadlines', arguments: input });
    assert.notEqual(accepted.isError, true);
    assert.deepEqual(JSON.parse(accepted.content[0].text), valid);
  } finally {
    await client.close();
    await server.close();
  }
});
