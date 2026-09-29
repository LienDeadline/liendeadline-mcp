// Child-process preload for isolated stdio tests. Every HTTP request is mocked.
import { registerHooks } from 'node:module';
registerHooks({
  resolve(specifier, context, nextResolve) {
    return nextResolve(specifier === './api.js' && context.parentURL?.endsWith('/src/index.ts') ? './api.ts' : specifier, context);
  },
});
// Shaped like the API's supplier-events-v1 result: the submitted fields echoed exactly.
const supplierEcho = inputs => ({
  contract_version: 'supplier-events-v1', status: 'review_required', state_code: inputs.state.toUpperCase(),
  role: 'supplier', inputs,
  preliminary_notice: { name: 'Preliminary notice', deadline: null, days_from_now: null, required: null, status: 'review_required', description: 'Synthetic review' },
  lien_filing: { name: 'Lien filing', deadline: null, days_from_now: null, required: null, status: 'review_required', description: 'Synthetic review' },
  critical_warnings: ['Synthetic review'], statute_citations: [], disclaimer: 'Synthetic disclaimer',
});
globalThis.fetch = async (url, init) => {
  const path = new URL(url).pathname;
  const protectedRoute = ['/api/v1/calculate-deadline', '/api/v1/supported-states'].includes(path);
  const authorization = new Headers(init.headers).get('Authorization');
  if (init.redirect !== 'error' || (protectedRoute
      ? authorization !== `Bearer ${process.env.LIENDEADLINE_API_KEY}`
      : authorization !== null)) {
    throw new Error('Credential isolation contract failed');
  }
  if (process.env.MCP_TEST_STATUS) {
    return new Response(JSON.stringify({ detail: process.env.LIENDEADLINE_API_KEY }), { status: Number(process.env.MCP_TEST_STATUS) });
  }
  const body = path === '/api/v1/supplier-deadlines' ? supplierEcho(JSON.parse(init.body))
    : path === '/api/v1/calculate-deadline'
    ? { data: { state: 'TX', invoice_date: '2026-07-01', lien_deadline: '2026-10-15' } }
    : path === '/api/v1/supported-states' ? { states: ['TX', 'CA'] }
    : path === '/api/v1/state-guides/index' ? { states: [{ state_code: 'TX', title: 'Texas', slug: 'texas' }] }
    : { data: { state_code: 'TX', title: 'Texas', slug: 'texas' } };
  return new Response(JSON.stringify(body), { status: 200 });
};
