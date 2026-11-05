import assert from 'node:assert/strict';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { calculateSupplierDeadlines, DEFAULT_BASE_URL, LienDeadlineApiError } from '../src/api.ts';
import { buildServer } from '../dist/server.js';

const KEY = `ld_live_${'0'.repeat(32)}.${'A'.repeat(43)}`;
const input = {
  state: 'FL', first_delivery_date: '2026-08-03', last_delivery_date: '2026-09-10',
  project_type: 'commercial', hired_by: 'subcontractor', deliveries_complete: true,
  florida_final_payment_status: 'no', florida_termination_status: 'no',
};
const calculated = (name, deadline, days) => ({
  name, deadline, days_from_now: days, required: true, status: 'calculated',
  description: 'Published supplier baseline', source_url: 'https://www.leg.state.fl.us/Statutes/',
});
const undated = (name, status, required) => ({
  name, status, required, deadline: null, days_from_now: null,
  description: 'Supplier outcome requiring its own interpretation',
});

function fixture(field, status) {
  const facts = { ...input };
  const result = {
    contract_version: 'supplier-events-v2', status: 'calculated', state_code: 'FL', role: 'supplier',
    preliminary_notice: calculated('Notice to Owner', '2026-09-17', -12),
    lien_filing: calculated('Claim of lien', '2026-12-09', 71),
    critical_warnings: ['Verify project facts and applicable law.'],
    statute_citations: ['Fla. Stat. § 713.06(2)(a)', 'Fla. Stat. § 713.08(5)'],
    disclaimer: 'Educational baseline, not legal advice.',
  };
  if (status === 'not_required') {
    facts.hired_by = 'owner';
    result[field] = undated('Notice to Owner', status, false);
  } else if (status === 'awaiting_final_delivery') {
    facts.deliveries_complete = false;
    delete facts.last_delivery_date;
    result[field] = undated('Claim of lien', status, true);
  } else if (status === 'review_required') {
    facts[field === 'preliminary_notice' ? 'florida_final_payment_status' : 'florida_termination_status'] = 'unknown';
    result.status = 'review_required';
    result[field] = undated(field, status, null);
  }
  result.inputs = { contract_version: 'supplier-events-v2', ...facts };
  return { facts, result };
}

// Existing API contract: common.py creates calculated=true/review=null;
// fl.py creates not_required=false/awaiting_final_delivery=true.
const outcomes = [
  ['preliminary_notice', 'calculated', true],
  ['lien_filing', 'calculated', true],
  ['preliminary_notice', 'not_required', false],
  ['lien_filing', 'awaiting_final_delivery', true],
  ['preliminary_notice', 'review_required', null],
  ['lien_filing', 'review_required', null],
];

function mockResponse(t, facts, result) {
  return t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(url, `${DEFAULT_BASE_URL}/api/v1/supplier-deadlines`);
    assert.equal(init.method, 'POST');
    assert.equal(init.redirect, 'error');
    assert.equal(new Headers(init.headers).get('Authorization'), `Bearer ${KEY}`);
    assert.deepEqual(JSON.parse(init.body), { contract_version: 'supplier-events-v2', ...facts });
    return Response.json(result);
  });
}

for (const [field, status, required] of outcomes) {
  test(`preserves ${field} ${status} with required=${required}`, async t => {
    const { facts, result } = fixture(field, status);
    const fetch = mockResponse(t, facts, result);
    assert.deepEqual(await calculateSupplierDeadlines(DEFAULT_BASE_URL, facts, KEY), result);
    assert.equal(fetch.mock.callCount(), 1);
  });

  for (const wrong of [true, false, null].filter(value => value !== required)) {
    test(`rejects ${field} ${status} with contradictory required=${wrong}`, async t => {
      const { facts, result } = fixture(field, status);
      result[field].required = wrong;
      result[field].description = `untrusted-response ${KEY}`;
      const fetch = mockResponse(t, facts, result);
      await assert.rejects(() => calculateSupplierDeadlines(DEFAULT_BASE_URL, facts, KEY), error => {
        assert.ok(error instanceof LienDeadlineApiError);
        assert.match(error.message, /supplier-events-v2 request; no dates are reported/);
        assert.doesNotMatch(error.message, /untrusted-response|2026-/);
        assert.equal(error.message.includes(KEY), false);
        return true;
      });
      assert.equal(fetch.mock.callCount(), 1, 'Malformed results must not trigger another calculation');
    });
  }
}

for (const [field, status, required] of outcomes) {
  test(`MCP suppresses contradictory ${field} ${status} results`, async t => {
    const { facts, result } = fixture(field, status);
    result[field].required = required === true ? false : true;
    const fetch = mockResponse(t, facts, result);
    const server = buildServer({ includeCustomerTools: false, customerApiKey: KEY });
    const client = new Client({ name: 'supplier-result-consistency-test', version: '0.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      const response = await client.callTool({ name: 'calculate_supplier_deadlines', arguments: facts });
      assert.equal(response.isError, true);
      assert.equal(response.structuredContent, undefined);
      assert.equal(response.content.length, 1);
      assert.equal(response.content[0].type, 'text');
      assert.match(response.content[0].text, /no dates are reported/);
      assert.doesNotMatch(JSON.stringify(response), /2026-|days_from_now|"required"/);
      assert.equal(fetch.mock.callCount(), 1);
    } finally {
      await client.close();
      await server.close();
    }
  });
}
