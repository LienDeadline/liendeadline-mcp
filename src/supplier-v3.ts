// Mirrors the API's additive supplier-events-v3 contract. No legal rules live here.
export const SUPPLIER_V3 = "supplier-events-v3" as const;
export type Answer = "yes" | "no" | "unknown";
export type SupplierScopeV3 = {
  contract_version: typeof SUPPLIER_V3;
  state: string;
  role: "supplier";
  project_type: "commercial" | "residential" | "public";
  hired_by: "owner" | "contractor" | "subcontractor";
};
export type EventValue = { answer: Answer; date?: string };
export type RulesIdentity = {
  schema_version: "state-rules-v1" | "state-rules-v2";
  source_version: string; source_hash: string; reviewed_commit: string;
  supplier_engine_version: string; implementation_manifest_hash: string;
};
export type QuestionsIdentity = { questions_version: "supplier-questions-v1"; question_set_hash: string };
export type SupplierQuestion = {
  id: string; label: string; help: string; answers: Answer[];
  date_policy: "required_for_calculation_if_yes" | "optional_review_only" | "forbidden";
  applies_when: { all: { event: string; answer: "yes" | "no" }[] };
  affects: ("preliminary_notice" | "lien_filing" | "eligibility")[];
  source_ids: string[];
};
export type SourceCitation = { id: string; section: string; official_url: string; [key: string]: unknown };
export type SupplierDiscovery = {
  contract_version: typeof SUPPLIER_V3; scope: SupplierScopeV3;
  scope_status: "supported" | "no_lien_right" | "review_required";
  reason_code: string; description: string; rules_source: RulesIdentity;
  questions_identity: QuestionsIdentity; questions: SupplierQuestion[];
  sources: SourceCitation[]; exclusions: string[]; warnings: string[];
};
export type SupplierRequestV3 = SupplierScopeV3 & {
  rules_source: RulesIdentity; questions_identity: QuestionsIdentity;
  events: Record<string, EventValue>;
};
export type SupplierNoticeDutyV3 = {
  id: string; name: string; description: string;
  status: "calculated"; required: true;
  deadline: string; days_from_now: number;
  event_ids: string[]; source_ids: string[];
};
export type SupplierNoticePlanBasisV3 = {
  kind: "policy_earlier_filing_target";
  assumed_filing_date: string; minimum_interval_days: 10 | 30;
};
export type SupplierPlannedNoticeTargetV3 = {
  id: string; name: string; description: string;
  status: "planning_target"; target_date: string;
  basis: SupplierNoticePlanBasisV3;
  event_ids: string[]; source_ids: string[];
};
export type SupplierDeadlineV3 = {
  name: string; status: "calculated" | "not_required" | "no_lien_right" | "awaiting_final_delivery" | "review_required";
  deadline: string | null; days_from_now: number | null; required: boolean | null;
  description: string; reason_code: string; event_ids: string[]; source_ids: string[];
  action_by?: string; // Explicit planning target; the statutory deadline remains unresolved.
  candidate_deadlines?: { id: string; date: string; source_ids: string[] }[];
  notice_duties?: SupplierNoticeDutyV3[];
  planned_notice_targets?: SupplierPlannedNoticeTargetV3[];
};
export type SupplierResultV3 = {
  contract_version: typeof SUPPLIER_V3; status: "calculated" | "no_lien_right" | "awaiting_final_delivery" | "review_required";
  as_of_date: string; state_code: string; role: "supplier"; inputs: SupplierRequestV3;
  rules_source: RulesIdentity; questions_identity: QuestionsIdentity;
  preliminary_notice: SupplierDeadlineV3; lien_filing: SupplierDeadlineV3;
  sources: SourceCitation[]; critical_warnings: string[]; disclaimer: string;
};
const STATES = new Set("AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split(" "));
const eventId = (v: unknown): v is string => typeof v === "string" && /^[a-z][a-z0-9_]{0,79}$/.test(v);
const record = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const texts = (v: unknown): v is string[] => Array.isArray(v) && v.every(text);
const digest = (v: unknown) => typeof v === "string" && /^[0-9a-f]{64}$/.test(v);
function isCivilDateV3(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [y, m, d] = v.split("-").map(Number), day = new Date(`${v}T00:00:00Z`);
  return y >= 1900 && y <= 9998 && day.getUTCFullYear() === y && day.getUTCMonth() === m - 1 && day.getUTCDate() === d;
}
function exactJson(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) && Array.isArray(right)) return left.length === right.length && left.every((v, i) => exactJson(v, right[i]));
  if (!record(left) || !record(right)) return false;
  return Object.keys(left).length === Object.keys(right).length && Object.keys(left).every(k => Object.hasOwn(right, k) && exactJson(left[k], right[k]));
}
function identity(v: unknown): v is RulesIdentity {
  return record(v) && ["state-rules-v1", "state-rules-v2"].includes(String(v.schema_version)) &&
    typeof v.source_version === "string" && /^\d{4}-\d{2}-\d{2}\.[1-9]\d*$/.test(v.source_version) && digest(v.source_hash) &&
    typeof v.reviewed_commit === "string" && /^[0-9a-f]{40}$/.test(v.reviewed_commit) && text(v.supplier_engine_version) && digest(v.implementation_manifest_hash);
}
function questionIdentity(v: unknown): v is QuestionsIdentity {
  return record(v) && v.questions_version === "supplier-questions-v1" && digest(v.question_set_hash);
}
function citations(v: unknown): v is SourceCitation[] {
  if (!Array.isArray(v)) return false;
  const ids = new Set<string>();
  return v.every(s => {
    if (!record(s) || !text(s.id) || ids.has(s.id) || !text(s.section) || !text(s.official_url)) return false;
    try { const u = new URL(s.official_url); if (u.protocol !== "https:" || u.username || u.password) return false; } catch { return false; }
    ids.add(s.id); return true;
  });
}
function noticeDuties(value: unknown, parent: Record<string, unknown>, request: SupplierRequestV3,
  sources: Set<string>, asOf: number): value is SupplierNoticeDutyV3[] {
  if (parent.status !== "calculated" || parent.required !== true || !isCivilDateV3(parent.deadline) ||
    !Array.isArray(value) || value.length === 0 || value.length > 16) return false;
  const keys = ["id", "name", "description", "status", "required", "deadline", "days_from_now", "event_ids", "source_ids"];
  const ids = new Set<string>();
  const dutyText = (v: unknown): v is string => text(v) && [...v].length <= 2000;
  const events = parent.event_ids as string[], parentSources = parent.source_ids as string[];
  if (!value.every(d => {
    if (!record(d) || Object.keys(d).length !== keys.length || !keys.every(k => Object.hasOwn(d, k)) ||
      !eventId(d.id) || ids.has(d.id) || !dutyText(d.name) || !dutyText(d.description) ||
      d.status !== "calculated" || d.required !== true || !isCivilDateV3(d.deadline) || !Number.isInteger(d.days_from_now) ||
      d.days_from_now !== (Date.parse(d.deadline) - asOf) / 86400000 ||
      !texts(d.event_ids) || d.event_ids.length === 0 || new Set(d.event_ids).size !== d.event_ids.length ||
      !d.event_ids.every(id => eventId(id) && events.includes(id) && Object.hasOwn(request.events, id)) ||
      !texts(d.source_ids) || d.source_ids.length === 0 || new Set(d.source_ids).size !== d.source_ids.length ||
      !d.source_ids.every(id => sources.has(id) && parentSources.includes(id))) return false;
    ids.add(d.id); return true;
  })) return false;
  return parent.deadline === value.reduce((earliest, duty) => duty.deadline < earliest ? duty.deadline : earliest, value[0].deadline);
}
function plannedNoticeTargets(value: unknown, parent: Record<string, unknown>, request: SupplierRequestV3,
  sources: Set<string>): value is SupplierPlannedNoticeTargetV3[] {
  if (parent.status !== "calculated" || parent.required !== true || !isCivilDateV3(parent.deadline) ||
    !Array.isArray(parent.notice_duties) || parent.notice_duties.length === 0 ||
    !Array.isArray(value) || value.length === 0 || value.length > 16) return false;
  const keys = ["id", "name", "description", "status", "target_date", "basis", "event_ids", "source_ids"];
  const basisKeys = ["kind", "assumed_filing_date", "minimum_interval_days"];
  const ids = new Set(parent.notice_duties.map(d => (d as SupplierNoticeDutyV3).id));
  const planText = (v: unknown): v is string => typeof v === "string" && v.length > 0 && [...v].length <= 2000;
  const events = parent.event_ids as string[], parentSources = parent.source_ids as string[];
  return value.every(p => {
    if (!record(p) || Object.keys(p).length !== keys.length || !keys.every(k => Object.hasOwn(p, k)) ||
      !eventId(p.id) || ids.has(p.id) || !planText(p.name) || !planText(p.description) ||
      p.status !== "planning_target" || !isCivilDateV3(p.target_date) || !record(p.basis) ||
      Object.keys(p.basis).length !== basisKeys.length || !basisKeys.every(k => Object.hasOwn(p.basis as object, k)) ||
      p.basis.kind !== "policy_earlier_filing_target" || !isCivilDateV3(p.basis.assumed_filing_date) ||
      (p.basis.minimum_interval_days !== 10 && p.basis.minimum_interval_days !== 30) ||
      (Date.parse(p.basis.assumed_filing_date) - Date.parse(p.target_date)) / 86400000 < p.basis.minimum_interval_days ||
      !texts(p.event_ids) || p.event_ids.length === 0 || p.event_ids.length > 64 || new Set(p.event_ids).size !== p.event_ids.length ||
      !p.event_ids.every(id => eventId(id) && events.includes(id) && Object.hasOwn(request.events, id) &&
        ["yes", "no"].includes(request.events[id].answer)) ||
      !Array.isArray(p.source_ids) || !p.source_ids.every(planText) || p.source_ids.length === 0 || p.source_ids.length > 64 ||
      new Set(p.source_ids).size !== p.source_ids.length ||
      !p.source_ids.every(id => sources.has(id) && parentSources.includes(id))) return false;
    ids.add(p.id); return true;
  });
}
export function isSupplierScopeV3(v: unknown): v is SupplierScopeV3 {
  return record(v) && Object.keys(v).length === 5 && v.contract_version === SUPPLIER_V3 &&
    typeof v.state === "string" && /^[A-Za-z]{2}$/.test(v.state) && STATES.has(v.state.toUpperCase()) && v.role === "supplier" &&
    ["commercial", "residential", "public"].includes(String(v.project_type)) && ["owner", "contractor", "subcontractor"].includes(String(v.hired_by));
}
export function isSupplierRequestV3(v: unknown): v is SupplierRequestV3 {
  if (!record(v)) return false;
  const { rules_source, questions_identity, events, ...scope } = v;
  if (!isSupplierScopeV3(scope) || !identity(rules_source) || !questionIdentity(questions_identity) || !record(events) || Object.keys(events).length > 64) return false;
  if (!Object.entries(events).every(([id, e]) => eventId(id) && record(e) &&
    Object.keys(e).every(k => k === "answer" || k === "date") && ["yes", "no", "unknown"].includes(String(e.answer)) &&
    (!Object.hasOwn(e, "date") || (e.answer === "yes" && id !== "homestead" && isCivilDateV3(e.date))))) return false;
  const first = events.first_furnishing as EventValue | undefined, final = events.final_furnishing as EventValue | undefined;
  return !(first?.date && final?.date && final.date < first.date);
}
export function isSupplierDiscovery(v: unknown, scope: SupplierScopeV3): v is SupplierDiscovery {
  if (!record(v) || v.contract_version !== SUPPLIER_V3 || !exactJson(v.scope, { ...scope, state: scope.state.toUpperCase() }) ||
    !["supported", "no_lien_right", "review_required"].includes(String(v.scope_status)) || !text(v.reason_code) || !text(v.description) ||
    !identity(v.rules_source) || !questionIdentity(v.questions_identity) || !citations(v.sources) ||
    !texts(v.exclusions) || !texts(v.warnings) || !Array.isArray(v.questions) || v.questions.length > 64) return false;
  const previous = new Set<string>(), sources = new Set(v.sources.map(s => s.id));
  return v.questions.every(q => {
    if (!record(q) || !text(q.id) || !eventId(q.id) || previous.has(q.id) || !text(q.label) || !text(q.help) ||
      !exactJson(q.answers, ["yes", "no", "unknown"]) || !["required_for_calculation_if_yes", "optional_review_only", "forbidden"].includes(String(q.date_policy)) ||
      (q.id === "homestead" && q.date_policy !== "forbidden") || !record(q.applies_when) || !Array.isArray(q.applies_when.all) ||
      !q.applies_when.all.every(p => record(p) && typeof p.event === "string" && previous.has(p.event) && ["yes", "no"].includes(String(p.answer))) ||
      !texts(q.affects) || q.affects.length === 0 || !q.affects.every(a => ["preliminary_notice", "lien_filing", "eligibility"].includes(a)) ||
      !texts(q.source_ids) || q.source_ids.length === 0 || !q.source_ids.every(s => sources.has(s))) return false;
    previous.add(q.id); return true;
  });
}
export function isSupplierResultV3(v: unknown, request: SupplierRequestV3): v is SupplierResultV3 {
  if (!record(v) || Object.hasOwn(v, "action_by") || Object.hasOwn(v, "notice_duties") || Object.hasOwn(v, "planned_notice_targets") || v.contract_version !== SUPPLIER_V3 || v.role !== "supplier" || v.state_code !== request.state.toUpperCase() ||
    !exactJson(v.inputs, request) || !exactJson(v.rules_source, request.rules_source) || !exactJson(v.questions_identity, request.questions_identity) ||
    !isCivilDateV3(v.as_of_date) || !citations(v.sources) || !texts(v.critical_warnings) || !text(v.disclaimer)) return false;
  const sources = new Set(v.sources.map(s => s.id)), asOf = Date.parse(v.as_of_date);
  const hasCriticalWarnings = v.critical_warnings.length > 0;
  const deadlines = [v.preliminary_notice, v.lien_filing];
  const required = { not_required: false, no_lien_right: false, awaiting_final_delivery: true, review_required: null };
  if (!deadlines.every((d, index) => {
    if (!record(d) || !text(d.name) || !text(d.description) || !text(d.reason_code) || !texts(d.event_ids) ||
      !d.event_ids.every(id => eventId(id)) || !texts(d.source_ids) || !d.source_ids.every(id => sources.has(id))) return false;
    if (Object.hasOwn(d, "notice_duties") && (index !== 0 || !noticeDuties(d.notice_duties, d, request, sources, asOf))) return false;
    if (Object.hasOwn(d, "planned_notice_targets") && (index !== 0 || !plannedNoticeTargets(d.planned_notice_targets, d, request, sources))) return false;
    if (d.candidate_deadlines !== undefined && (!Array.isArray(d.candidate_deadlines) || d.candidate_deadlines.length > 16 || (d.candidate_deadlines.length > 0 && !["calculated", "review_required"].includes(String(d.status))) ||
      new Set(d.candidate_deadlines.map(c => record(c) ? c.id : undefined)).size !== d.candidate_deadlines.length ||
      !d.candidate_deadlines.every(c => record(c) && eventId(c.id) && isCivilDateV3(c.date) && texts(c.source_ids) && c.source_ids.length > 0 && c.source_ids.every(id => sources.has(id))))) return false;
    // Accept only the API's explicit conservative target. Never infer one from
    // candidates or promote it to a statutory date/countdown.
    if (Object.hasOwn(d, "action_by") && (!isCivilDateV3(d.action_by) || d.status !== "review_required" ||
      d.reason_code !== "conservative_action_date" || d.source_ids.length === 0 || !hasCriticalWarnings ||
      !Array.isArray(d.candidate_deadlines) || d.candidate_deadlines.length === 0 ||
      !d.candidate_deadlines.every(c => record(c) && typeof c.date === "string" && (d.action_by as string) <= c.date))) return false;
    if (d.status === "calculated") return d.required === true && d.source_ids.length > 0 && isCivilDateV3(d.deadline) && Number.isInteger(d.days_from_now) &&
      d.days_from_now === (Date.parse(d.deadline) - asOf) / 86400000;
    return typeof d.status === "string" && Object.hasOwn(required, d.status) && d.required === required[d.status as keyof typeof required] &&
      d.deadline === null && d.days_from_now === null && (!["not_required", "no_lien_right"].includes(d.status) || d.source_ids.length > 0);
  })) return false;
  const statuses = deadlines.map(d => (d as SupplierDeadlineV3).status);
  if (statuses.includes("no_lien_right") && !statuses.every(s => s === "no_lien_right")) return false;
  return v.status === (["review_required", "no_lien_right", "awaiting_final_delivery"].find(s => statuses.includes(s as SupplierDeadlineV3["status"])) ?? "calculated");
}
// Unknown ancestors remain unresolved. Facts from hidden descendant questions are removed,
// so switching a parent answer cannot submit facts collected under a different branch.
export function applicableQuestions(discovery: SupplierDiscovery, events: Record<string, EventValue>): SupplierQuestion[] {
  const visible = new Set<string>();
  return discovery.questions.filter(q => {
    const applies = q.applies_when.all.every(p => visible.has(p.event) && events[p.event]?.answer === p.answer);
    if (applies) visible.add(q.id);
    return applies;
  });
}
export function discoveredEvents(discovery: SupplierDiscovery, events: Record<string, EventValue>): Record<string, EventValue> {
  return Object.fromEntries(applicableQuestions(discovery, events).filter(q => Object.hasOwn(events, q.id)).map(q => [q.id, events[q.id]]));
}
