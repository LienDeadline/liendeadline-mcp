import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_BASE_URL, getStateGuide, listStateGuides } from '../src/api.ts';

function mockResponse(t, body, expectedPath) {
  t.mock.method(globalThis, 'fetch', async url => {
    assert.equal(new URL(url).pathname, expectedPath);
    return Response.json(body);
  });
}

for (const wrapped of [false, true]) {
  test(`guide projection preserves structured content from a ${wrapped ? 'wrapped' : 'flat'} response`, async t => {
    const guide = {
      state_code: 'TX', title: 'Texas', slug: 'texas',
      rule_payload: { preliminary_notice: { statute: 'Synthetic citation', description: 'Synthetic rule' } },
      deadlines_rows_json: [{ name: 'Synthetic deadline', summary: 'Requires review' }],
      faq_json: [{ question: 'Synthetic question?', answer: 'Synthetic answer.' }],
      rendered_html: '<p>Unneeded rendered content</p>',
      extra_metadata: 'not part of the guide contract',
    };
    mockResponse(t, wrapped ? { data: guide, title: 'Envelope metadata' } : guide, '/api/v1/state-guides/TX');

    assert.deepEqual(await getStateGuide(DEFAULT_BASE_URL, ' tX '), {
      state_code: 'TX', title: 'Texas', slug: 'texas',
      rules: guide.rule_payload,
      deadline_rows: guide.deadlines_rows_json,
      faqs: guide.faq_json,
      source_url: 'https://liendeadline.com/state-lien-guides/texas',
    });
  });
}

for (const fields of [{}, {
  state_code: null, title: null, slug: null,
  rule_payload: null, deadlines_rows_json: null, faq_json: null,
}]) {
  test(`guide projection supplies defaults for ${Object.keys(fields).length ? 'null' : 'omitted'} fields`, async t => {
    mockResponse(t, { data: fields }, '/api/v1/state-guides/DC');

    assert.deepEqual(await getStateGuide(DEFAULT_BASE_URL, ' dc '), {
      state_code: 'DC', title: 'DC', slug: 'dc',
      rules: null, deadline_rows: null, faqs: null,
      source_url: 'https://liendeadline.com/state-lien-guides/dc',
    });
  });
}

test('guide index projects only summary fields and preserves API order', async t => {
  mockResponse(t, {
    states: [
      { state_code: 'TX', title: 'Texas', slug: 'texas', rule_payload: { extra: true } },
      { state_code: 'CA', title: 'California', slug: 'california', rendered_html: '<p>Extra</p>' },
    ],
    count: 999,
  }, '/api/v1/state-guides/index');

  assert.deepEqual(await listStateGuides(DEFAULT_BASE_URL), [
    { state_code: 'TX', title: 'Texas', slug: 'texas' },
    { state_code: 'CA', title: 'California', slug: 'california' },
  ]);
});

for (const [label, body] of [['omitted', {}], ['null', { states: null }], ['empty', { states: [] }]]) {
  test(`guide index returns an empty list for ${label} states`, async t => {
    mockResponse(t, body, '/api/v1/state-guides/index');
    assert.deepEqual(await listStateGuides(DEFAULT_BASE_URL), []);
  });
}
