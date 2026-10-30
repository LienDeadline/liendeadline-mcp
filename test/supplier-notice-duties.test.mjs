import assert from 'node:assert/strict';
import test from 'node:test';
import { isSupplierResultV3 } from '../src/supplier-v3.ts';
import { calculateSupplierDeadlinesV3 } from '../src/api.ts';
import { input, result } from './supplier-v3-fixture.mjs';

const stableIds = ['nv_right_to_lien', 'nv_residential_intent', 'il_occupant_notice',
  'il_owner_lender_notice', 'ma_identification', 'ma_notice_of_contract'];
function namedResult(ids = stableIds.slice(0, 2)) {
  const value = structuredClone(result);
  value.preliminary_notice = { ...value.preliminary_notice, notice_duties: ids.map((id, index) => ({
    id, name: `Synthetic notice ${id}`, description: 'Synthetic independently required notice.',
    status: 'calculated', required: true, deadline: index === 0 ? '2026-07-01' : '2026-07-10',
    days_from_now: index === 0 ? 30 : 39, event_ids: ['project_completed'], source_ids: ['test'],
  })) };
  return value;
}

test('named duties preserve stable IDs, candidate order, earliest legacy summary and same-day identities', () => {
  for (const ids of [stableIds, ['il_owner_lender_notice'], ['ma_identification']]) {
    const value = namedResult(ids);
    assert.equal(isSupplierResultV3(value, input), true);
    assert.deepEqual(value.preliminary_notice.notice_duties.map(d => d.id), ids);
  }
  const reversed = namedResult();
  reversed.preliminary_notice.notice_duties.reverse();
  assert.equal(isSupplierResultV3(reversed, input), true);
  const sameDay = namedResult();
  sameDay.preliminary_notice.notice_duties[1].deadline = '2026-07-01';
  sameDay.preliminary_notice.notice_duties[1].days_from_now = 30;
  assert.equal(isSupplierResultV3(sameDay, input), true);
});

test('absent named field leaves historical results unchanged without expanding candidates', () => {
  const value = structuredClone(result);
  value.preliminary_notice = { ...value.preliminary_notice,
    candidate_deadlines: [{ id: 'raw', date: '2026-07-02', source_ids: ['test'] }] };
  assert.equal(isSupplierResultV3(value, input), true);
  assert.equal(Object.hasOwn(value.preliminary_notice, 'notice_duties'), false);
});

test('a held lien keeps confirmed preliminary duties; a held or ineligible preliminary parent cannot', () => {
  const value = namedResult();
  value.status = 'review_required';
  value.lien_filing = { ...value.lien_filing, status: 'review_required', required: null,
    deadline: null, days_from_now: null };
  assert.equal(isSupplierResultV3(value, input), true);
  const awaiting = namedResult();
  awaiting.status = 'awaiting_final_delivery';
  awaiting.lien_filing = { ...awaiting.lien_filing, status: 'awaiting_final_delivery', required: true,
    deadline: null, days_from_now: null };
  assert.equal(isSupplierResultV3(awaiting, input), true);
  for (const [status, required] of [['review_required', null], ['not_required', false],
    ['no_lien_right', false], ['awaiting_final_delivery', true]]) {
    const held = namedResult();
    held.preliminary_notice = { ...held.preliminary_notice, status, required, deadline: null, days_from_now: null };
    held.status = status === 'not_required' ? 'calculated' : status;
    assert.equal(isSupplierResultV3(held, input), false, status);
  }
});

test('named notices require the exact nine-field shape, civil dates, countdowns and resolved attribution', () => {
  const keys = Object.keys(namedResult().preliminary_notice.notice_duties[0]);
  const mutations = [
    ...keys.map(key => d => { delete d[key]; }),
    d => { d.action_by = '2026-06-30'; }, d => { d.candidate_deadlines = []; }, d => { d.extra = true; },
    d => { d.id = 'Bad-ID'; }, d => { d.name = ''; }, d => { d.description = ' '; },
    d => { d.name = 'x'.repeat(2001); }, d => { d.description = 'x'.repeat(2001); },
    d => { d.status = 'review_required'; }, d => { d.required = 1; }, d => { d.required = false; },
    d => { d.deadline = null; }, d => { d.deadline = '2026-02-30'; }, d => { d.deadline = '2026-7-01'; },
    d => { d.days_from_now = 31; }, d => { d.days_from_now = '30'; }, d => { d.days_from_now = 30.5; },
    d => { d.event_ids = []; }, d => { d.event_ids = ['project_completed', 'project_completed']; },
    d => { d.event_ids = ['missing_fact']; }, d => { d.event_ids = ['Bad-ID']; },
    d => { d.source_ids = []; }, d => { d.source_ids = ['test', 'test']; }, d => { d.source_ids = ['missing']; },
  ];
  for (const mutate of mutations) {
    const value = namedResult(); mutate(value.preliminary_notice.notice_duties[0]);
    assert.equal(isSupplierResultV3(value, input), false, JSON.stringify(value.preliminary_notice.notice_duties[0]));
  }
});

test('named field cannot escape its parent or hide invalid explicit collections', () => {
  for (const mutate of [
    v => { v.preliminary_notice.notice_duties = []; },
    v => { v.preliminary_notice.notice_duties = null; },
    v => { v.preliminary_notice.notice_duties = undefined; },
    v => { v.preliminary_notice.notice_duties = {}; },
    v => { v.preliminary_notice.notice_duties[1].id = v.preliminary_notice.notice_duties[0].id; },
    v => { v.preliminary_notice.deadline = '2026-07-10'; v.preliminary_notice.days_from_now = 39; },
    v => { v.preliminary_notice.event_ids = []; },
    v => { v.preliminary_notice.event_ids = ['missing_fact']; v.preliminary_notice.notice_duties[0].event_ids = ['missing_fact']; },
    v => { v.sources.push({ id: 'other', section: 'Synthetic', official_url: 'https://example.org/other' });
      v.preliminary_notice.notice_duties[0].source_ids = ['other']; },
    v => { v.lien_filing = { ...v.lien_filing, notice_duties: v.preliminary_notice.notice_duties }; },
    v => { v.notice_duties = v.preliminary_notice.notice_duties; },
    v => { v.status = 'no_lien_right'; },
  ]) {
    const value = namedResult(); mutate(value);
    assert.equal(isSupplierResultV3(value, input), false);
  }
  assert.equal(isSupplierResultV3(namedResult(Array.from({ length: 16 }, (_, i) => `notice_${i}`)), input), true);
  assert.equal(isSupplierResultV3(namedResult(Array.from({ length: 17 }, (_, i) => `notice_${i}`)), input), false);
});

test('customer transport forwards actual validated duties intact and rejects invalid metadata without scalar fallback', async t => {
  const key = 'ld_live_' + 'a'.repeat(32) + '.' + 'b'.repeat(43);
  let body = namedResult();
  const original = structuredClone(body);
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, options });
    assert.equal(new Headers(options.headers).get('Authorization'), `Bearer ${key}`);
    assert.equal(options.redirect, 'error');
    assert.deepEqual(JSON.parse(options.body), input);
    return Response.json(body);
  });
  assert.deepEqual(await calculateSupplierDeadlinesV3('https://secure-api-v1.liendeadline.com', input, key), original);
  body = namedResult(); body.preliminary_notice.notice_duties[1].source_ids = ['missing'];
  await assert.rejects(() => calculateSupplierDeadlinesV3('https://secure-api-v1.liendeadline.com', input, key), /no dates/);
  body = namedResult(); body.preliminary_notice.notice_duties = [];
  await assert.rejects(() => calculateSupplierDeadlinesV3('https://secure-api-v1.liendeadline.com', input, key), /no dates/);
  assert.equal(calls.length, 3);
});
