import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import { DEFAULT_BASE_URL, calculateDeadline, listSupportedStates, getStateGuide, listStateGuides } from '../src/api.ts';

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
