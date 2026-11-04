import './mock-runtime.mjs';
import assert from 'node:assert/strict';

let calls = 0;
globalThis.fetch = async (url, init) => {
  assert.equal(++calls, 1, 'Review errors must not trigger retries or another calculation');
  assert.equal(url, 'https://secure-api-v1.liendeadline.com/api/v1/calculate-deadline');
  assert.equal(init.method, 'POST');
  assert.equal(init.redirect, 'error');
  assert.equal(new Headers(init.headers).get('Authorization'), `Bearer ${process.env.LIENDEADLINE_API_KEY}`);
  assert.deepEqual(JSON.parse(init.body), {
    state: 'KS', invoice_date: '2026-01-15', role: 'supplier', project_type: 'commercial',
  });
  return new Response(process.env.MCP_TEST_ERROR_BODY, { status: 422 });
};
