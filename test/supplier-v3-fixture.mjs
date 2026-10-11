export const scope = { contract_version: 'supplier-events-v3', role: 'supplier', state: 'TX', project_type: 'commercial', hired_by: 'contractor' };
const rules = { schema_version: 'state-rules-v2', source_version: '2026-10-06.1', source_hash: 'a'.repeat(64), reviewed_commit: 'b'.repeat(40), supplier_engine_version: 'supplier-engine-v1', implementation_manifest_hash: 'c'.repeat(64) };
const questionsIdentity = { questions_version: 'supplier-questions-v1', question_set_hash: 'd'.repeat(64) };
const source = { id: 'test', section: 'Synthetic source; no legal calculation', official_url: 'https://example.org/synthetic' };
const question = (id, predicates = []) => ({ id, label: id, help: 'Synthetic question', answers: ['yes', 'no', 'unknown'], date_policy: 'required_for_calculation_if_yes', applies_when: { all: predicates }, affects: ['lien_filing'], source_ids: ['test'] });
export const discovery = { contract_version: 'supplier-events-v3', scope, scope_status: 'supported', reason_code: 'test', description: 'Synthetic scope', rules_source: rules, questions_identity: questionsIdentity, sources: [source], exclusions: [], warnings: [], questions: [question('project_completed'), question('completion_notice_valid', [{event: 'project_completed', answer: 'yes'}]), question('notice_served', [{event: 'completion_notice_valid', answer: 'yes'}])] };
export const input = { ...scope, rules_source: rules, questions_identity: questionsIdentity, events: { project_completed: {answer: 'yes', date: '2026-06-01'} } };
export const deadline = { name: 'Synthetic lien', status: 'calculated', deadline: '2026-07-01', days_from_now: 30, required: true, description: 'Synthetic result', reason_code: 'test', event_ids: ['project_completed'], source_ids: ['test'] };
export const result = { contract_version: 'supplier-events-v3', state_code: 'TX', role: 'supplier', status: 'calculated', as_of_date: '2026-06-01', inputs: input, rules_source: rules, questions_identity: questionsIdentity, sources: [source], critical_warnings: [], disclaimer: 'Synthetic, not legal advice.', preliminary_notice: deadline, lien_filing: deadline };

// Synthetic unresolved legal interpretation: an explicit planning target, not a filing date.
export const conservativeResult = {
  ...result, status: 'review_required',
  critical_warnings: ['The statutory deadline remains unresolved. Obtain qualified review before the conservative action date.'],
  lien_filing: {...deadline, status: 'review_required', deadline: null, days_from_now: null, required: null,
    reason_code: 'conservative_action_date',
    description: 'Conservative planning target; the statutory deadline remains unresolved.',
    action_by: '2026-06-29', candidate_deadlines: [
      {id: 'completion', date: '2026-07-01', source_ids: ['test']},
      {id: 'furnishing', date: '2026-06-30', source_ids: ['test']},
    ]},
};
