import { createHash } from "node:crypto";
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
  recurring_notice_intake?: SupplierRecurringNoticeIntakeV3;
};
export type SupplierRecurringNoticeIntakeV3 = {
  version: "supplier-recurring-facts-v1"; kind: "tn_monthly_nonpayment" | "nh_written_account";
  max_records: 16; omission_policy: "legacy_earliest_month" | "no_account_checkpoint";
  label: string; help: string;
};
export type SupplierRequestV3 = SupplierScopeV3 & {
  rules_source: RulesIdentity; questions_identity: QuestionsIdentity;
  events: Record<string, EventValue>;
  recurring_notice_facts?: SupplierRecurringNoticeFactsV3;
};
export type SupplierRecurringNoticeFactsV3 =
  | { version: "supplier-recurring-facts-v1"; kind: "tn_monthly_nonpayment";
      months: { month: string; unpaid: Answer; retainage_only: Answer }[] }
  | { version: "supplier-recurring-facts-v1"; kind: "nh_written_account";
      accounts: { id: string; covered_through: string; supplied_date: string }[] };
export type SupplierRecurringNoticePeriodV3 = {
  id: string; month: string; status: "calculated" | "not_required" | "review_required"; reason_code: string;
};
export type SupplierRecurringNoticeCheckpointV3 = {
  id: string; name: string; description: string; status: "advisory_checkpoint";
  legal_status: "review_required"; target_date: string;
  basis: { kind: "nh_account_check_in"; anchor_kind: "owner_notice_given" | "account_supplied";
    anchor_date: string; account_id: string | null; covered_through: string | null; interval_days: 30 };
  event_ids: string[]; source_ids: string[];
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
  recurring_notice_periods?: SupplierRecurringNoticePeriodV3[];
  recurring_coverage?: "entered_periods_only";
  recurring_notice_checkpoints?: SupplierRecurringNoticeCheckpointV3[];
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
      !texts(d.event_ids) || d.event_ids.length > 64 || (d.event_ids.length === 0 && !(request.recurring_notice_facts?.kind === "tn_monthly_nonpayment" &&
        Array.isArray(parent.recurring_notice_periods) && parent.recurring_notice_periods.some(p => record(p) && p.id === d.id && p.status === "calculated" &&
          request.recurring_notice_facts?.kind === "tn_monthly_nonpayment" && request.recurring_notice_facts.months.some(m =>
            m.month === p.month && d.id === `tn_nonpayment_${m.month.replace("-", "_")}`)))) || new Set(d.event_ids).size !== d.event_ids.length ||
      !d.event_ids.every(id => eventId(id) && events.includes(id) && Object.hasOwn(request.events, id) && ["yes", "no"].includes(request.events[id].answer)) ||
      !texts(d.source_ids) || d.source_ids.length === 0 || d.source_ids.length > 64 ||
      d.source_ids.some(id => [...id].length > 2000) || new Set(d.source_ids).size !== d.source_ids.length ||
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
const exactKeys = (v: Record<string, unknown>, keys: string[]) =>
  Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const recurringMonth = (v: unknown): v is string =>
  typeof v === "string" && /^\d{4}-\d{2}$/.test(v) && isCivilDateV3(`${v}-01`);
const recurringText = (v: unknown): v is string => typeof v === "string" && v.length > 0 && [...v].length <= 2000;
const recurringAnswer = (v: unknown): v is Answer => v === "yes" || v === "no" || v === "unknown";
export function isSupplierRecurringNoticeFactsV3(v: unknown, state: string): v is SupplierRecurringNoticeFactsV3 {
  if (!record(v) || v.version !== "supplier-recurring-facts-v1") return false;
  if (v.kind === "tn_monthly_nonpayment") {
    if (state.toUpperCase() !== "TN" || !exactKeys(v, ["version", "kind", "months"]) ||
      !Array.isArray(v.months) || v.months.length < 1 || v.months.length > 16) return false;
    const seen = new Set<string>();
    return v.months.every(m => {
      if (!record(m) || !exactKeys(m, ["month", "unpaid", "retainage_only"]) || !recurringMonth(m.month) ||
        seen.has(m.month) || !recurringAnswer(m.unpaid) || !recurringAnswer(m.retainage_only)) return false;
      seen.add(m.month); return true;
    });
  }
  if (v.kind === "nh_written_account") {
    if (state.toUpperCase() !== "NH" || !exactKeys(v, ["version", "kind", "accounts"]) ||
      !Array.isArray(v.accounts) || v.accounts.length > 16) return false;
    const seen = new Set<string>();
    return v.accounts.every(a => {
      if (!record(a) || !exactKeys(a, ["id", "covered_through", "supplied_date"]) || !eventId(a.id) || seen.has(a.id) ||
        !isCivilDateV3(a.covered_through) || !isCivilDateV3(a.supplied_date) || a.covered_through > a.supplied_date) return false;
      seen.add(a.id); return true;
    });
  }
  return false;
}
function recurringPeriods(parent: Record<string, unknown>, request: SupplierRequestV3, asOfDate: string): boolean {
  const present = Object.hasOwn(parent, "recurring_notice_periods"), coverage = Object.hasOwn(parent, "recurring_coverage");
  if (!present && !coverage) return true;
  const facts = request.recurring_notice_facts, value = parent.recurring_notice_periods;
  if (!present || !coverage || parent.recurring_coverage !== "entered_periods_only" ||
    facts?.kind !== "tn_monthly_nonpayment" || !Array.isArray(value) || value.length < 1 || value.length > 16 ||
    value.length !== facts.months.length) return false;
  const duties = (parent.notice_duties ?? []) as SupplierNoticeDutyV3[], ids = new Set<string>();
  if (!value.every(p => {
    if (!record(p) || !exactKeys(p, ["id", "month", "status", "reason_code"]) || !recurringMonth(p.month) ||
      p.id !== `tn_nonpayment_${p.month.replace("-", "_")}` || ids.has(p.id as string) ||
      !facts.months.some(m => m.month === p.month) || !eventId(p.reason_code) ||
      (p.status !== "calculated" && p.status !== "not_required" && p.status !== "review_required") ||
      (p.status === "calculated") !== duties.some(d => d.id === p.id)) return false;
    const fact = facts.months.find(m => m.month === p.month)!;
    if (fact.month > asOfDate.slice(0, 7) ||
      (p.status === "calculated" && (fact.unpaid !== "yes" || fact.retainage_only !== "no" || p.reason_code !== "actual_unpaid_furnished_month")) ||
      (p.status === "not_required" && fact.unpaid !== "no" && !(p.reason_code === "recurring_scope_not_required" && (parent.status === "not_required" || parent.status === "review_required"))) ||
      (p.status === "not_required" && p.reason_code !== "entered_month_currently_paid" && p.reason_code !== "recurring_scope_not_required") ||
      (p.reason_code === "recurring_scope_not_required" && (request.project_type !== "residential" ||
        request.events.tn_one_to_four_units?.answer !== "yes" || (parent.status !== "not_required" && parent.status !== "review_required")))) return false;
    ids.add(p.id as string); return true;
  })) return false;
  // A present ledger replaces the old scalar rather than silently discarding
  // paid, unknown or source-held entered periods.
  if (duties.some(d => !ids.has(d.id))) return false;
  if (value.some(p => p.status === "calculated")) return parent.status === "calculated";
  if (value.some(p => p.status === "review_required")) return parent.status === "review_required" || parent.status === "no_lien_right";
  return parent.status === "not_required";
}
function recurringCheckpoints(parent: Record<string, unknown>, request: SupplierRequestV3, sources: Set<string>, asOfDate: string): boolean {
  const value = parent.recurring_notice_checkpoints, facts = request.recurring_notice_facts;
  const owner = request.events.nh_owner_notice_given;
  if (facts?.kind !== "nh_written_account" || !owner || owner.answer !== "yes" || !isCivilDateV3(owner.date) ||
    owner.date > asOfDate || facts.accounts.some(a => a.supplied_date > asOfDate || a.supplied_date < owner.date!) ||
    !Array.isArray(value) || value.length !== 1) return false;
  const ids = new Set([...(parent.notice_duties as SupplierNoticeDutyV3[] ?? []),
    ...(parent.planned_notice_targets as SupplierPlannedNoticeTargetV3[] ?? [])].map(p => p.id));
  const events = parent.event_ids as string[], parentSources = parent.source_ids as string[];
  return value.every(p => {
    if (!record(p) || !exactKeys(p, ["id", "name", "description", "status", "legal_status", "target_date", "basis", "event_ids", "source_ids"]) ||
      !eventId(p.id) || ids.has(p.id) || !recurringText(p.name) || !recurringText(p.description) ||
      p.status !== "advisory_checkpoint" || p.legal_status !== "review_required" || !isCivilDateV3(p.target_date) ||
      !record(p.basis) || !exactKeys(p.basis, ["kind", "anchor_kind", "anchor_date", "account_id", "covered_through", "interval_days"]) ||
      p.basis.kind !== "nh_account_check_in" ||
      (p.basis.anchor_kind !== "owner_notice_given" && p.basis.anchor_kind !== "account_supplied") ||
      (p.basis.anchor_kind === "owner_notice_given" && (p.basis.account_id !== null || p.basis.covered_through !== null)) ||
      (p.basis.anchor_kind === "account_supplied" && (!eventId(p.basis.account_id) || !isCivilDateV3(p.basis.covered_through))) ||
      p.id !== (p.basis.anchor_kind === "owner_notice_given" ? "nh_account_check_in_owner_notice" : `nh_account_check_in_${createHash("sha256").update(JSON.stringify(p.basis.account_id)).digest("hex").slice(0, 16)}`) ||
      p.basis.interval_days !== 30 || !isCivilDateV3(p.basis.anchor_date) ||
      (Date.parse(p.target_date) - Date.parse(p.basis.anchor_date)) / 86400000 !== 30 ||
      !texts(p.event_ids) || p.event_ids.length < 1 || p.event_ids.length > 64 || new Set(p.event_ids).size !== p.event_ids.length ||
      !p.event_ids.includes("nh_owner_notice_given") ||
      !p.event_ids.every(id => eventId(id) && events.includes(id) && Object.hasOwn(request.events, id) && ["yes", "no"].includes(request.events[id].answer)) ||
      !Array.isArray(p.source_ids) || p.source_ids.length < 1 || p.source_ids.length > 64 || !p.source_ids.every(recurringText) ||
      new Set(p.source_ids).size !== p.source_ids.length || !p.source_ids.every(id => sources.has(id) && parentSources.includes(id))) return false;
    if (p.basis.anchor_kind === "owner_notice_given") return facts.accounts.length === 0 && p.basis.anchor_date === owner.date &&
      p.basis.account_id === null && p.basis.covered_through === null;
    if (p.basis.anchor_kind !== "account_supplied") return false;
    const basis = p.basis;
    const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
    const latest = [...facts.accounts].sort((a, b) =>
      compare(a.supplied_date, b.supplied_date) || compare(a.covered_through, b.covered_through) || compare(a.id, b.id)).at(-1);
    const account = facts.accounts.find(a => a.id === basis.account_id);
    return !!account && account.supplied_date === p.basis.anchor_date && account.covered_through === p.basis.covered_through &&
      account.id === latest?.id;
  });
}
export function isSupplierScopeV3(v: unknown): v is SupplierScopeV3 {
  return record(v) && Object.keys(v).length === 5 && v.contract_version === SUPPLIER_V3 &&
    typeof v.state === "string" && /^[A-Za-z]{2}$/.test(v.state) && STATES.has(v.state.toUpperCase()) && v.role === "supplier" &&
    ["commercial", "residential", "public"].includes(String(v.project_type)) && ["owner", "contractor", "subcontractor"].includes(String(v.hired_by));
}
export function isSupplierRequestV3(v: unknown): v is SupplierRequestV3 {
  if (!record(v)) return false;
  const { rules_source, questions_identity, events, recurring_notice_facts, ...scope } = v;
  if (Object.hasOwn(v, "recurring_notice_facts") &&
    (!isSupplierRecurringNoticeFactsV3(recurring_notice_facts, String(v.state)) || v.project_type === "public" || v.hired_by === "owner")) return false;
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
  if (Object.hasOwn(v, "recurring_notice_intake")) {
    const intake = v.recurring_notice_intake;
    if (!record(intake) || !exactKeys(intake, ["version", "kind", "max_records", "omission_policy", "label", "help"]) ||
      intake.version !== "supplier-recurring-facts-v1" || intake.max_records !== 16 ||
      !recurringText(intake.label) || !recurringText(intake.help) ||
      !((intake.kind === "tn_monthly_nonpayment" && intake.omission_policy === "legacy_earliest_month") ||
        (intake.kind === "nh_written_account" && intake.omission_policy === "no_account_checkpoint"))) return false;
  }
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
  if (!record(v) || Object.hasOwn(v, "action_by") || Object.hasOwn(v, "notice_duties") || Object.hasOwn(v, "planned_notice_targets") ||
    ["recurring_notice_periods", "recurring_coverage", "recurring_notice_checkpoints"].some(k => Object.hasOwn(v, k)) || v.contract_version !== SUPPLIER_V3 || v.role !== "supplier" || v.state_code !== request.state.toUpperCase() ||
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
    if (index === 0 && request.recurring_notice_facts?.kind === "tn_monthly_nonpayment" && ["calculated", "not_required"].includes(String(d.status)) &&
      (!Object.hasOwn(d, "recurring_notice_periods") || !Object.hasOwn(d, "recurring_coverage"))) return false;
    if ((Object.hasOwn(d, "recurring_notice_periods") || Object.hasOwn(d, "recurring_coverage")) &&
      (index !== 0 || !recurringPeriods(d, request, v.as_of_date as string))) return false;
    if (Object.hasOwn(d, "recurring_notice_checkpoints") &&
      (index !== 0 || !recurringCheckpoints(d, request, sources, v.as_of_date as string))) return false;
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
