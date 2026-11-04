import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { calculateDeadline, DEFAULT_BASE_URL, getStateGuide, LienDeadlineApiError } from '../src/api.ts';

const KEY = `ld_live_${'0'.repeat(32)}.${'A'.repeat(43)}`;
const input = { state: 'KS', invoice_date: '2026-01-15', role: 'supplier', project_type: 'commercial' };
const apiBody = readFileSync(new URL('./fixtures/kansas-invoice-review.json', import.meta.url), 'utf8');
const payload = JSON.parse(apiBody);
const ordinaryHint = 'LienDeadline API returned 422. Check that state is a supported two-letter US code and invoice_date is YYYY-MM-DD.';
const sensitiveText = `untrusted-upstream ${KEY} lien_deadline 2099-01-01`;

function assertReview(message) {
  assert.match(message, /returned 422/);
  assert.match(message, /Kansas.*review/);
  assert.match(message, /final furnishing event and hiring relationship/);
  assert.match(message, /No dates were calculated/);
  assert.match(message, /material suppliers.*get_supplier_questions/);
  assert.match(message, /verified.*scope/);
  assert.match(message, /confirm.*facts/);
  assert.match(message, /qualified review/);
  assert.doesNotMatch(message, /YYYY-MM-DD|two-letter|supplier-events-v1|untrusted-upstream|2099-01-01|lien_deadline/);
  assert.equal(message.includes(KEY), false);
}

test('actual API Kansas review payload stays an actionable 422 error without a calculation', async t => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    calls.push({ url, init });
    return new Response(apiBody, { status: 422 });
  });
  await assert.rejects(() => calculateDeadline(DEFAULT_BASE_URL, input, KEY), error => {
    assert.ok(error instanceof LienDeadlineApiError);
    assert.equal(error.status, 422);
    assertReview(error.message);
    assert.equal(Object.hasOwn(error, 'lien_deadline'), false);
    return true;
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${DEFAULT_BASE_URL}/api/v1/calculate-deadline`);
  assert.deepEqual(JSON.parse(calls[0].init.body), input);
});

test('recognized Kansas error uses local guidance regardless of arbitrary upstream text', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({
    ...payload, lien_deadline: '2099-01-01',
    detail: { ...payload.detail, message: sensitiveText, contract_version: sensitiveText },
  }, { status: 422 }));
  await assert.rejects(() => calculateDeadline(DEFAULT_BASE_URL, input, KEY), error => {
    assert.equal(error.status, 422);
    assertReview(error.message);
    return true;
  });
});

for (const [name, body] of [
  ['ordinary validation', JSON.stringify({ detail: [{ loc: ['body', 'invoice_date'], msg: sensitiveText }] })],
  ['malformed JSON', `{${sensitiveText}`],
  ['empty body', ''],
  ['null body', 'null'],
  ['primitive body', JSON.stringify(sensitiveText)],
  ['array body', JSON.stringify([payload])],
  ['null detail', JSON.stringify({ detail: null })],
  ['primitive detail', JSON.stringify({ detail: sensitiveText })],
  ['array detail', JSON.stringify({ detail: [payload.detail] })],
  ['missing code', JSON.stringify({ detail: { status: 'review_required', message: sensitiveText } })],
  ['unknown code', JSON.stringify({ detail: { ...payload.detail, code: 'other_review_required', message: sensitiveText } })],
  ['missing status', JSON.stringify({ detail: { code: payload.detail.code, message: sensitiveText } })],
  ['wrong status', JSON.stringify({ detail: { ...payload.detail, status: 'calculated', message: sensitiveText } })],
]) {
  test(`${name} retains ordinary 422 guidance and suppresses the upstream body`, async t => {
    const mock = t.mock.method(globalThis, 'fetch', async () => new Response(body, { status: 422 }));
    await assert.rejects(() => calculateDeadline(DEFAULT_BASE_URL, input, KEY), error => {
      assert.equal(error.status, 422);
      assert.equal(error.message, ordinaryHint);
      return true;
    });
    assert.equal(mock.mock.callCount(), 1);
  });
}

test('failed error-body read retains ordinary 422 guidance', async t => {
  t.mock.method(globalThis, 'fetch', async () => ({ ok: false, status: 422, json: async () => { throw new Error(sensitiveText); } }));
  await assert.rejects(() => calculateDeadline(DEFAULT_BASE_URL, input, KEY), error => error.status === 422 && error.message === ordinaryHint);
});

test('typed-looking payload is ignored for other statuses and endpoints', async t => {
  for (const status of [400, 401, 403, 409, 429, 503]) {
    t.mock.method(globalThis, 'fetch', async () => new Response(apiBody, { status }));
    await assert.rejects(() => calculateDeadline(DEFAULT_BASE_URL, input, KEY), error => {
      assert.equal(error.status, status);
      assert.doesNotMatch(error.message, /Kansas|get_supplier_questions/);
      return true;
    });
  }
  t.mock.method(globalThis, 'fetch', async () => new Response(apiBody, { status: 422 }));
  await assert.rejects(() => getStateGuide(DEFAULT_BASE_URL, 'KS'), error => {
    assert.equal(error.status, 422);
    assert.equal(error.message, 'LienDeadline API returned 422. Check that state is a two-letter US state or DC code.');
    return true;
  });
});

for (const [name, body, review] of [
  ['actual API payload', apiBody, true],
  ['arbitrary message', JSON.stringify({ detail: { ...payload.detail, message: sensitiveText } }), true],
  ['ordinary validation', JSON.stringify({ detail: [{ msg: sensitiveText }] }), false],
  ['malformed body', sensitiveText, false],
]) {
  test(`stdio preserves isError and no dates for ${name}`, async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ['--experimental-transform-types', '--import', fileURLToPath(new URL('./mock-kansas-error.mjs', import.meta.url)), fileURLToPath(new URL('../src/index.ts', import.meta.url))],
      env: { LIENDEADLINE_API_KEY: KEY, LIENDEADLINE_API_URL: DEFAULT_BASE_URL, MCP_TEST_ERROR_BODY: body },
      stderr: 'pipe',
    });
    let stderr = '';
    transport.stderr?.on('data', data => { stderr += data; });
    const client = new Client({ name: 'kansas-error-contract-test', version: '0.0.0' });
    try {
      await client.connect(transport);
      const result = await client.callTool({ name: 'calculate_lien_deadline', arguments: input });
      assert.equal(result.isError, true);
      assert.equal(result.structuredContent, undefined);
      assert.equal(result.content.length, 1);
      assert.equal(result.content[0].type, 'text');
      const message = result.content[0].text;
      if (review) assertReview(message);
      else assert.equal(message, ordinaryHint);
      assert.doesNotMatch(JSON.stringify(result), /2099-01-01|2026-01-15|lien_deadline|preliminary_notice_deadline/);
    } finally {
      await client.close();
      assert.equal(stderr.includes(KEY), false);
      assert.equal(stderr.includes('untrusted-upstream'), false);
    }
  });
}
