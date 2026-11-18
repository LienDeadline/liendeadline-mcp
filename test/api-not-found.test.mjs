import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_BASE_URL,
  LienDeadlineApiError,
  calculateDeadline,
  calculateSupplierDeadlines,
  calculateSupplierDeadlinesV3,
  getStateGuide,
  getSupplierQuestions,
  listStateGuides,
  listSupportedStates,
} from '../src/api.ts';
import { input as supplierV3Input, scope as supplierScope } from './supplier-v3-fixture.mjs';

const key = `ld_live_${'0'.repeat(32)}.${'A'.repeat(43)}`;
const supplierInput = {
  state: 'FL', first_delivery_date: '2026-08-03',
  project_type: 'commercial', hired_by: 'subcontractor', deliveries_complete: false,
  florida_final_payment_status: 'no', florida_termination_status: 'no',
};

const cases = [
  ['individual state guide', () => getStateGuide(DEFAULT_BASE_URL, 'TX'), '/api/v1/state-guides/TX', 'No guide exists for that state code.'],
  ['guide index', () => listStateGuides(DEFAULT_BASE_URL), '/api/v1/state-guides/index'],
  ['supported states', () => listSupportedStates(DEFAULT_BASE_URL, key), '/api/v1/supported-states'],
  ['invoice calculation', () => calculateDeadline(DEFAULT_BASE_URL, { state: 'TX', invoice_date: '2026-07-01' }, key), '/api/v1/calculate-deadline'],
  ['supplier v2 calculation', () => calculateSupplierDeadlines(DEFAULT_BASE_URL, supplierInput, key), '/api/v1/supplier-deadlines'],
  ['supplier discovery', () => getSupplierQuestions(DEFAULT_BASE_URL, supplierScope, key), '/api/v1/supplier-deadlines/questions'],
  ['supplier v3 calculation', () => calculateSupplierDeadlinesV3(DEFAULT_BASE_URL, supplierV3Input, key), '/api/v1/supplier-deadlines/v3'],
];

for (const [name, call, pathname, hint = 'The requested API resource was not found.'] of cases) {
  test(`404 from ${name} has endpoint-appropriate guidance`, async t => {
    const paths = [];
    t.mock.method(globalThis, 'fetch', async url => {
      paths.push(new URL(url).pathname);
      return Response.json({ detail: 'Not Found' }, { status: 404 });
    });
    await assert.rejects(call, error => {
      assert.ok(error instanceof LienDeadlineApiError);
      assert.equal(error.status, 404);
      assert.equal(error.message, `LienDeadline API returned 404. ${hint}`);
      return true;
    });
    assert.deepEqual(paths, [pathname]);
  });
}
