import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import {
  DEFAULT_BASE_URL, calculateDeadline, calculateSupplierDeadlines, listSupportedStates, getStateGuide, listStateGuides,
} from '../src/api.ts';

// Synthetic key only; no issued credential or provider request.
const KEY = `ld_live_${'0'.repeat(32)}.${'A'.repeat(43)}`;
const input = { state: 'TX', invoice_date: '2026-07-01', project_type: 'Commercial' };
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
function mock(body, status = 200) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status });
  };
  return calls;
}
async function rejectsSafely(action, pattern) {
  await assert.rejects(action, error => {
    assert.match(error.message, pattern);
    assert.equal(error.message.includes(KEY), false);
    return true;
  });
}

test('protected routes send dedicated Bearer only in headers', async () => {
  const calls = mock({ state: 'TX', invoice_date: input.invoice_date, states: ['TX', 'CA'] });
  const result = await calculateDeadline(DEFAULT_BASE_URL, input, KEY);
  assert.equal(result.state, 'TX');
  assert.deepEqual(await listSupportedStates(DEFAULT_BASE_URL, KEY), ['TX', 'CA']);
  assert.deepEqual(calls.map(c => new URL(c.url).pathname), ['/api/v1/calculate-deadline', '/api/v1/supported-states']);
  for (const c of calls) {
    assert.equal(c.init.headers.Authorization, `Bearer ${KEY}`);
    assert.equal(c.url.includes(KEY), false);
    assert.equal((c.init.body ?? '').includes(KEY), false);
    assert.equal(c.init.redirect, 'error');
  }
  assert.deepEqual(JSON.parse(calls[0].init.body), input);
});

test('missing key fails before HTTP with actionable configuration error', async () => {
  const calls = mock({});
  await rejectsSafely(() => calculateDeadline(DEFAULT_BASE_URL, input), /Set LIENDEADLINE_API_KEY/);
  await rejectsSafely(() => listSupportedStates(DEFAULT_BASE_URL), /Set LIENDEADLINE_API_KEY/);
  assert.equal(calls.length, 0);
});

for (const key of ['session-token', 'provider-token', ` ${KEY}`, `${KEY}\r\nInjected: yes`]) {
  test('unsupported or malformed key is not sent', async () => {
    const calls = mock({});
    await rejectsSafely(() => calculateDeadline(DEFAULT_BASE_URL, input, key), /dedicated customer key/);
    assert.equal(calls.length, 0);
  });
}

for (const base of [
  'https://example.org', 'http://secure-api-v1.liendeadline.com',
  'https://secure-api-v1.liendeadline.com:8443', 'https://secure-api-v1.liendeadline.com.attacker.example',
  `https://${KEY}@secure-api-v1.liendeadline.com`, `${DEFAULT_BASE_URL}/path`,
  `${DEFAULT_BASE_URL}?key=${KEY}`, `${DEFAULT_BASE_URL}#${KEY}`, 'not-a-url', 'file:///tmp/example',
]) {
  test('customer key is denied on untrusted or malformed base configuration', async () => {
    const calls = mock({});
    await rejectsSafely(() => listSupportedStates(base, KEY), /LIENDEADLINE_API_URL|another origin/);
    assert.equal(calls.length, 0);
  });
}

test('guide tools stay public without credential headers, including alternate origin', async () => {
  const calls = mock({ states: [{ state_code: 'TX', title: 'Texas', slug: 'texas' }], data: { state_code: 'TX', title: 'Texas' } });
  await listStateGuides('https://example.org');
  await getStateGuide('https://example.org', 'TX');
  assert.deepEqual(calls.map(c => new URL(c.url).pathname), ['/api/v1/state-guides/index', '/api/v1/state-guides/TX']);
  for (const c of calls) {
    assert.equal(new Headers(c.init.headers).has('Authorization'), false);
    assert.equal(c.init.redirect, 'error');
  }
});

for (const status of [400, 422]) {
  test(`guide validation failure ${status} gives a state-code hint, not the invoice hint`, async () => {
    for (const call of [() => getStateGuide(DEFAULT_BASE_URL, 'T1'), () => listStateGuides(DEFAULT_BASE_URL)]) {
      mock({ detail: 'bad' }, status);
      await assert.rejects(call, error => {
        assert.equal(error.message, `LienDeadline API returned ${status}. Check that state is a two-letter US state or DC code.`);
        assert.doesNotMatch(error.message, /invoice_date/);
        return true;
      });
    }
  });
}

test('invoice validation failure keeps the invoice hint', async () => {
  mock({ detail: 'bad' }, 422);
  await rejectsSafely(() => calculateDeadline(DEFAULT_BASE_URL, input, KEY), /returned 422\. Check that state is a supported two-letter US code and invoice_date is YYYY-MM-DD\./);
});

for (const status of [401, 403, 429, 503]) {
  test(`denial ${status} preserves status and never exposes response secrets`, async () => {
    mock({ detail: KEY }, status);
    await rejectsSafely(() => calculateDeadline(DEFAULT_BASE_URL, input, KEY), new RegExp(`returned ${status}`));
  });
}

test('fetch/redirect rejection suppresses sensitive causes', async () => {
  let calls = 0;
  globalThis.fetch = async (url, init) => {
    calls++;
    assert.equal(init.redirect, 'error');
    throw new Error(`redirect to https://example.org/?credential=${KEY}`);
  };
  await rejectsSafely(() => calculateDeadline(DEFAULT_BASE_URL, input, KEY), /redirects are not followed/);
  assert.equal(calls, 1);
});

test('malformed response errors do not expose response bodies', async () => {
  globalThis.fetch = async () => new Response(KEY, { status: 200 });
  await rejectsSafely(() => calculateDeadline(DEFAULT_BASE_URL, input, KEY), /invalid JSON/);
});

test('calculation response retains the prior trimmed contract', async () => {
  mock({ data: { ...input, lien_deadline: '2026-10-15', warnings: ['Reviewed'], notes: 'Statutory projection' }, unused: 'ignored' });
  const result = await calculateDeadline(DEFAULT_BASE_URL, input, KEY);
  assert.equal(result.lien_deadline, '2026-10-15');
  assert.deepEqual(result.warnings, ['Reviewed']);
  assert.equal(result.notes, 'Statutory projection');
  assert.equal(Object.hasOwn(result, 'unused'), false);
});

test('calculation fills omitted fields as the tool description states', async () => {
  mock({ state: 'TX', invoice_date: input.invoice_date });
  const result = await calculateDeadline(DEFAULT_BASE_URL, input, KEY);
  for (const field of ['project_type', 'preliminary_notice_deadline', 'lien_deadline', 'waiver_due_date', 'prelim_deadline_days', 'lien_deadline_days']) {
    assert.equal(result[field], null, field);
  }
  assert.deepEqual(result.warnings, []);
  assert.equal(result.notes, '');
});

// Public supplier delivery-event contract. Shapes follow the live supplier-events-v2 result.
const supplierInput = {
  state: 'FL', first_delivery_date: '2026-08-03', last_delivery_date: '2026-09-10',
  project_type: 'commercial', hired_by: 'subcontractor', deliveries_complete: true,
  florida_final_payment_status: 'no', florida_termination_status: 'no',
};
const supplierBody = { contract_version: 'supplier-events-v2', ...supplierInput };
const calculated = (name, deadline, days) => ({
  name, deadline, days_from_now: days, required: true, status: 'calculated',
  description: `${name} baseline`, source_url: 'https://www.leg.state.fl.us/Statutes/',
});
const supplierResult = (inputs = supplierBody, overrides = {}) => ({
  contract_version: 'supplier-events-v2', status: 'calculated', state_code: inputs.state.toUpperCase(), role: 'supplier', inputs,
  preliminary_notice: calculated('Notice to Owner', '2026-09-17', -12),
  lien_filing: calculated('Claim of lien', '2026-12-09', 71),
  critical_warnings: ['Timing is based on delivery dates, not an invoice date.'],
  statute_citations: ['Fla. Stat. § 713.06(2)(a)', 'Fla. Stat. § 713.08(5)'],
  disclaimer: 'Educational baseline, not legal advice.',
  ...overrides,
});

test('supplier calculation is public: no credential, exact body, redirects refused', async () => {
  const calls = mock(supplierResult());
  const result = await calculateSupplierDeadlines(DEFAULT_BASE_URL, supplierInput);
  assert.equal(result.lien_filing.deadline, '2026-12-09');
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0].url).pathname, '/api/v1/supplier-deadlines');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(new Headers(calls[0].init.headers).has('Authorization'), false);
  assert.equal(calls[0].init.redirect, 'error');
  assert.deepEqual(JSON.parse(calls[0].init.body), supplierBody);
});

test('supplier body omits unsupplied optional fields instead of sending nulls', async () => {
  const { last_delivery_date, ...ongoing } = supplierInput;
  const input = { ...ongoing, deliveries_complete: false };
  const body = { contract_version: 'supplier-events-v2', ...input };
  const awaiting = { name: 'Claim of lien', deadline: null, days_from_now: null, required: true, status: 'awaiting_final_delivery', description: 'Awaiting final delivery' };
  const calls = mock(supplierResult(body, { lien_filing: awaiting }));
  const result = await calculateSupplierDeadlines(DEFAULT_BASE_URL, input);
  assert.equal(result.lien_filing.status, 'awaiting_final_delivery');
  assert.deepEqual(JSON.parse(calls[0].init.body), body);
});

const review = name => ({
  name, deadline: null, days_from_now: null, required: null,
  status: 'review_required', description: 'Synthetic event review',
});

test('the same Florida facts without explicit event answers cannot use the old blanket-yes dates', async () => {
  const { florida_final_payment_status, florida_termination_status, ...unanswered } = supplierInput;
  const body = { contract_version: 'supplier-events-v2', ...unanswered };
  const calls = mock(supplierResult(body, {
    status: 'review_required', preliminary_notice: review('Notice to Owner'), lien_filing: review('Claim of lien'),
  }));
  const result = await calculateSupplierDeadlines(DEFAULT_BASE_URL, unanswered);
  assert.equal(result.status, 'review_required');
  assert.equal(result.preliminary_notice.deadline, null);
  assert.equal(result.lien_filing.deadline, null);
  assert.deepEqual(JSON.parse(calls[0].init.body), body);
  assert.equal(calls[0].init.body.includes('special_events_reviewed'), false);
  await assert.rejects(() => calculateSupplierDeadlines(DEFAULT_BASE_URL, {
    ...unanswered, special_events_reviewed: true,
  }), /special_events_reviewed.*not supported/);
  assert.equal(calls.length, 1);
});

for (const [label, changes, blocked] of [
  ['unknown final payment', { florida_final_payment_status: 'unknown' }, 'preliminary_notice'],
  ['known payment without its date', { florida_final_payment_status: 'yes' }, 'preliminary_notice'],
  ['unknown termination', { florida_termination_status: 'unknown' }, 'lien_filing'],
  ['known termination', { florida_termination_status: 'yes' }, 'lien_filing'],
]) {
  test(`Florida ${label} keeps the affected deadline under review`, async () => {
    const input = { ...supplierInput, ...changes };
    const body = { contract_version: 'supplier-events-v2', ...input };
    mock(supplierResult(body, { status: 'review_required', [blocked]: review(blocked) }));
    const result = await calculateSupplierDeadlines(DEFAULT_BASE_URL, input);
    assert.equal(result[blocked].deadline, null);
    assert.equal(result[blocked].status, 'review_required');
  });
}

test('Kansas unknown extension returns no lien date while an explicit no permits the baseline', async () => {
  const { florida_final_payment_status, florida_termination_status, ...facts } = supplierInput;
  const input = { ...facts, state: 'KS', kansas_extension_status: 'unknown' };
  const body = { contract_version: 'supplier-events-v2', ...input };
  mock(supplierResult(body, { status: 'review_required', lien_filing: review('Lien statement') }));
  const unknown = await calculateSupplierDeadlines(DEFAULT_BASE_URL, input);
  assert.equal(unknown.lien_filing.deadline, null);
  const no = { ...input, kansas_extension_status: 'no' };
  mock(supplierResult({ contract_version: 'supplier-events-v2', ...no }));
  assert.equal((await calculateSupplierDeadlines(DEFAULT_BASE_URL, no)).lien_filing.status, 'calculated');
});

test('Florida final-payment date with matching yes preserves a verified later notice baseline', async () => {
  const input = { ...supplierInput, florida_final_payment_status: 'yes', florida_final_payment_date: '2026-10-01' };
  const body = { contract_version: 'supplier-events-v2', ...input };
  const calls = mock(supplierResult(body));
  const result = await calculateSupplierDeadlines(DEFAULT_BASE_URL, input);
  assert.equal(result.preliminary_notice.status, 'calculated');
  assert.equal(result.preliminary_notice.deadline, '2026-09-17');
  assert.deepEqual(JSON.parse(calls[0].init.body), body);
});

test('an upstream calculated date for an unanswered Florida event is rejected despite an exact echo', async () => {
  const { florida_final_payment_status, florida_termination_status, ...unanswered } = supplierInput;
  const body = { contract_version: 'supplier-events-v2', ...unanswered };
  mock(supplierResult(body));
  await assert.rejects(() => calculateSupplierDeadlines(DEFAULT_BASE_URL, unanswered), /does not match the submitted supplier-events-v2 request/);
});

for (const [label, input, pattern] of [
  ['complete deliveries without a final date', { ...supplierInput, last_delivery_date: undefined }, /last_delivery_date is required/],
  ['final delivery before first delivery', { ...supplierInput, last_delivery_date: '2026-08-01' }, /cannot be earlier than first_delivery_date/],
  ['impossible calendar date', { ...supplierInput, first_delivery_date: '2026-02-30' }, /first_delivery_date must be a real YYYY-MM-DD date/],
  ['unknown jurisdiction', { ...supplierInput, state: 'ZZ' }, /two-letter US state or DC code/],
  ['Florida fields outside Florida', { ...supplierInput, state: 'KS', florida_termination_date: '2026-09-20' }, /apply only when state is FL/],
  ['Florida answer outside Florida', { ...supplierInput, state: 'KS' }, /apply only when state is FL/],
  ['Kansas answer outside Kansas', { ...supplierInput, kansas_extension_status: 'unknown' }, /applies only when state is KS/],
  ['date without yes', { ...supplierInput, florida_final_payment_date: '2026-09-20' }, /florida_final_payment_date requires an explicit yes answer/],
  ['invalid answer', { ...supplierInput, florida_termination_status: 'maybe' }, /florida_termination_status must be yes, no, or unknown/],
]) {
  test(`supplier request with ${label} fails locally without HTTP`, async () => {
    const calls = mock(supplierResult());
    await assert.rejects(() => calculateSupplierDeadlines(DEFAULT_BASE_URL, input), pattern);
    assert.equal(calls.length, 0);
  });
}

for (const [label, body] of [
  ['a changed input echo', supplierResult({ ...supplierBody, state: 'KS' })],
  ['an extra echoed field', supplierResult({ ...supplierBody, role: 'supplier' })],
  ['a different contract', supplierResult(supplierBody, { contract_version: 'supplier-events-v1' })],
  ['a different state', supplierResult(supplierBody, { state_code: 'KS' })],
  ['a calculated date without a deadline', supplierResult(supplierBody, { lien_filing: { ...calculated('Claim of lien', null, null) } })],
  ['a review status that still carries a date', supplierResult(supplierBody, { preliminary_notice: { ...calculated('Notice', '2026-09-17', -12), status: 'review_required' } })],
  ['a non-http source link', supplierResult(supplierBody, { lien_filing: { ...calculated('Claim of lien', '2026-12-09', 71), source_url: 'javascript:alert(1)' } })],
  ['a missing disclaimer', supplierResult(supplierBody, { disclaimer: ' ' })],
]) {
  test(`supplier result with ${label} is reported as an error, not dates`, async () => {
    mock(body);
    await assert.rejects(() => calculateSupplierDeadlines(DEFAULT_BASE_URL, supplierInput), /does not match the submitted supplier-events-v2 request/);
  });
}

test('supplier validation failure from the API gives a supplier-specific hint', async () => {
  mock({ detail: [{ loc: ['body', 'state'], msg: 'bad' }] }, 422);
  await assert.rejects(() => calculateSupplierDeadlines(DEFAULT_BASE_URL, supplierInput), /returned 422\. Check the supplier event fields/);
});
