import assert from 'node:assert/strict';
import test from 'node:test';
import { applicableQuestions, discoveredEvents, isSupplierDiscovery, isSupplierRequestV3, isSupplierResultV3 } from '../src/supplier-v3.ts';
import { scope, discovery, input, deadline, result } from "./supplier-v3-fixture.mjs";
const clone = value => structuredClone(value);

test('v3 accepts canonical discovered IDs, identities and coherent independently dated results', () => {
  assert.equal(isSupplierDiscovery(discovery, scope), true);
  assert.equal(isSupplierRequestV3({...input, events: {completion_notice_valid: {answer: 'unknown'}}}), true);
  assert.equal(isSupplierResultV3(result, input), true);
});

test('v3 rejects changed nested echoes, type changes, stale identities and wrong scope', () => {
  for (const mutate of [v => {v.inputs.events.project_completed.answer = 'no';}, v => {v.inputs.events.project_completed.date = null;}, v => {v.inputs.events.extra = {answer: true};}, v => {v.questions_identity.question_set_hash = 'e'.repeat(64);}, v => {v.rules_source.source_hash = 'e'.repeat(64);}, v => {v.state_code = 'KS';}]) {
    const value = clone(result); mutate(value); assert.equal(isSupplierResultV3(value, input), false);
  }
});

test('v3 rejects unresolved dates, incorrect countdowns, bad attribution and incoherent aggregate status', () => {
  for (const mutate of [v => {v.lien_filing.days_from_now = 29;}, v => {v.lien_filing.deadline = '2026-02-30';}, v => {v.lien_filing.required = null;}, v => {v.lien_filing.source_ids = ['missing'];}, v => {v.sources[0].official_url = 'javascript:alert(1)';}, v => {v.status = 'review_required';}, v => {v.lien_filing.status = 'review_required';}]) {
    const value = clone(result); mutate(value); assert.equal(isSupplierResultV3(value, input), false);
  }
});

test('raw candidates never replace the definitive outcome or requiredness', () => {
  const value = clone(result); value.status = 'review_required';
  value.lien_filing = {...deadline, status: 'review_required', deadline: null, days_from_now: null, required: null, candidate_deadlines: [{id: 'raw', date: '2026-07-01', source_ids: ['test']}]};
  assert.equal(isSupplierResultV3(value, input), true);
  value.lien_filing.deadline = '2026-07-01'; assert.equal(isSupplierResultV3(value, input), false);
  const unsafe = clone(result); unsafe.lien_filing.candidate_deadlines = [{id: 'raw', date: '2026-07-01', source_ids: ['test']}];
  assert.equal(isSupplierResultV3(unsafe, input), true);
  assert.equal(unsafe.lien_filing.deadline, result.lien_filing.deadline);
  unsafe.lien_filing.candidate_deadlines.push(unsafe.lien_filing.candidate_deadlines[0]);
  assert.equal(isSupplierResultV3(unsafe, input), false);
});

test('discovery rejects wrong scope, unknown source references and non-topological questions', () => {
  for (const mutate of [v => {v.scope.hired_by = 'owner';}, v => {v.questions.reverse();}, v => {v.questions[0].source_ids = ['missing'];}, v => {v.questions[0].answers = ['yes', 'no'];}, v => {v.questions[0].id = 'unknown-invalid-id';}]) {
    const value = clone(discovery); mutate(value); assert.equal(isSupplierDiscovery(value, scope), false);
  }
});

test('conditional questions wait for known ancestors and changing an ancestor removes descendant facts', () => {
  const facts = {project_completed: {answer: 'yes'}, completion_notice_valid: {answer: 'yes'}, notice_served: {answer: 'yes', date: '2026-07-01'}};
  assert.equal(applicableQuestions(discovery, facts).length, 3);
  assert.deepEqual(discoveredEvents(discovery, {...facts, project_completed: {answer: 'unknown'}}), {project_completed: {answer: 'unknown'}});
  assert.equal(applicableQuestions(discovery, {}).length, 1);
});

test('v3 rejects date-on-no, explicit null, impossible dates, extra scope fields and reversed furnishing', () => {
  for (const events of [{project_completed: {answer: 'no', date: '2026-06-01'}}, {project_completed: {answer: 'yes', date: null}}, {project_completed: {answer: 'yes', date: '2026-02-30'}}, {homestead: {answer: 'yes', date: '2026-06-01'}}, {first_furnishing: {answer: 'yes', date: '2026-06-02'}, final_furnishing: {answer: 'yes', date: '2026-06-01'}}]) assert.equal(isSupplierRequestV3({...input, events}), false);
  assert.equal(isSupplierRequestV3({...input, invoice_date: '2026-06-01'}), false);
});
