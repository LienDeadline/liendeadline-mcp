import { discovery, result } from "./supplier-v3-fixture.mjs";
// Child-process preload for isolated stdio and HTTP tests. Every upstream HTTP request is mocked.
import { registerHooks } from 'node:module';
registerHooks({
  resolve(specifier, context, nextResolve) {
    // Run the TypeScript sources directly: their relative ./x.js imports resolve to ./x.ts.
    const fromSource = /\/src\/[\w-]+\.ts$/.test(context.parentURL ?? '');
    return nextResolve(fromSource && /^\.\/[\w-]+\.js$/.test(specifier) ? specifier.replace(/\.js$/, '.ts') : specifier, context);
  },
});
// Shaped like v2: explicit no answers permit baselines; missing answers never yield dates.
const reviewed = name => ({ name, deadline: null, days_from_now: null, required: null, status: 'review_required', description: 'Synthetic review' });
const dated = (name, deadline) => ({ name, deadline, days_from_now: 30, required: true, status: 'calculated', description: 'Synthetic baseline' });
const supplierEcho = inputs => {
  const notice = inputs.state.toUpperCase() === 'FL' && inputs.florida_final_payment_status === 'no'
    ? dated('Notice to Owner', '2026-09-17') : reviewed('Notice to Owner');
  const lien = inputs.state.toUpperCase() === 'FL' && inputs.florida_termination_status === 'no'
    ? dated('Claim of lien', '2026-12-09') : reviewed('Claim of lien');
  return {
    contract_version: 'supplier-events-v2',
    status: notice.status === 'review_required' || lien.status === 'review_required' ? 'review_required' : 'calculated',
    state_code: inputs.state.toUpperCase(), role: 'supplier', inputs,
    preliminary_notice: notice, lien_filing: lien,
    critical_warnings: ['Synthetic supplier baseline'], statute_citations: [], disclaimer: 'Synthetic disclaimer',
  };
};
globalThis.fetch = async (url, init) => {
  const path = new URL(url).pathname;
  const protectedRoute = ['/api/v1/calculate-deadline', '/api/v1/supported-states'].includes(path);
  const authorization = new Headers(init.headers).get('Authorization');
  if (init.redirect !== 'error' || (protectedRoute
      ? authorization !== `Bearer ${process.env.LIENDEADLINE_API_KEY}`
      : authorization !== null) ||
      // Hosted tests forbid Authorization on every route, protected or not.
      (process.env.MCP_TEST_FORBID_AUTHORIZATION === '1' && authorization !== null)) {
    throw new Error('Credential isolation contract failed');
  }
  if (process.env.MCP_TEST_DELAY_MS) await new Promise(resolve => setTimeout(resolve, Number(process.env.MCP_TEST_DELAY_MS)));
  if (process.env.MCP_TEST_STATUS) {
    return new Response(JSON.stringify({ detail: process.env.LIENDEADLINE_API_KEY }), { status: Number(process.env.MCP_TEST_STATUS) });
  }
  const body = path === '/api/v1/supplier-deadlines/questions' ? {...discovery, scope: Object.fromEntries(new URL(url).searchParams)}
    : path === '/api/v1/supplier-deadlines/v3' ? {...result, inputs: JSON.parse(init.body)}
    : path === '/api/v1/supplier-deadlines' ? supplierEcho(JSON.parse(init.body))
    : path === '/api/v1/calculate-deadline'
    ? { data: { state: 'TX', invoice_date: '2026-07-01', lien_deadline: '2026-10-15' } }
    : path === '/api/v1/supported-states' ? { states: ['TX', 'CA'] }
    : path === '/api/v1/state-guides/index' ? { states: [{ state_code: 'TX', title: 'Texas', slug: 'texas' }] }
    : { data: { state_code: 'TX', title: 'Texas', slug: 'texas' } };
  return new Response(JSON.stringify(body), { status: 200 });
};
