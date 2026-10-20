import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  DEFAULT_BASE_URL,
  LienDeadlineApiError,
  VERSION,
  calculateDeadline,
  calculateSupplierDeadlines,
  calculateSupplierDeadlinesV3,
  getSupplierQuestions,
  getStateGuide,
  listStateGuides,
  listSupportedStates,
} from "./api.js";

/**
 * The local stdio server registers all seven tools. The hosted HTTP server registers only the
 * five guide/supplier tools. A caller key is scoped to one HTTP exchange.
 */
export type ServerOptions =
  | { includeCustomerTools: true; baseUrl?: string; customerApiKey?: string }
  | { includeCustomerTools: false; baseUrl?: string; customerApiKey?: string };

/**
 * Every tool returns JSON text. Errors come back as isError so the client can retry or
 * explain, rather than the server dying on a bad state code.
 */
function ok(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

function fail(error: unknown) {
  const message =
    error instanceof LienDeadlineApiError
      ? error.message
      : error instanceof Error
        ? error.message
        : String(error);
  return { isError: true, content: [{ type: "text" as const, text: message }] };
}

const DISCLAIMER =
  "Calculated estimate from published state rules, reviewed quarterly. Not legal advice. " +
  "Statutes change and facts vary between projects. Verify critical deadlines with counsel.";

const GUIDE_DISCLAIMER =
  "Editorial guide, not legal advice. Statutes change and facts vary between projects. " +
  "Verify critical deadlines with counsel.";

const GUIDE_NOTE =
  "Editorial reference, not a calculation: the day counts are summaries, not computed deadlines. " +
  "Use verified calculated outcomes from calculate_supplier_deadlines or calculate_supplier_deadlines_v3. " +
  "A missing deadline or unresolved candidate requires qualified review.";

const PUBLIC_INSTRUCTIONS =
  "For jurisdiction-specific questions, first use get_supplier_questions for the exact state, project type and hiring relationship. " +
  "It returns live scope support, event questions and rule identities. Ask those questions without guessing; use calculate_supplier_deadlines_v3 " +
  "with those identities and nested event answers. Review-required and no-lien-right outcomes remain distinct. " +
  "When RI discovery asks ri_mailed_within_200_days after ri_mailed=yes, confirm whether mailing occurred within 200 days of first delivery. " +
  "No, Unknown or omitted confirmation requires review; recording alone never establishes a 40-day target. " +
  "When preliminary_notice.notice_duties is present, report every named notice with its own calculated date, explanation and sources; " +
  "the legacy preliminary_notice.deadline is only the earliest summary. Preserve the validated collection and never infer independent notices " +
  "from candidates or treat one notice as satisfying all duties. When preliminary_notice.planned_notice_targets is present, " +
  "report every Intent planning target with its target date, assumed filing date, full ten- or thirty-day interval, explanation and sources. " +
  "Earlier actual filing requires the full interval before that filing. Preserve these qualified plans separately from confirmed notices: " +
  "they do not establish a statutory expiration, actual filing, sent notice, completion or scheduled notification. " +
  "Submit optional recurring_notice_facts only when the exact discovery returns a matching recurring_notice_intake descriptor. " +
  "Its absence means no recurring intake is available for that scope; never infer it from the state alone. " +
  "Optional recurring_notice_facts records actual Tennessee furnished months or New Hampshire written accounts. " +
  "Report Tennessee recurring_notice_periods only for entered months, including paid and unknown periods, with entered_periods_only coverage. " +
  "Do not infer intervening months or complete later occurrences from an earlier completion. " +
  "Report New Hampshire recurring_notice_checkpoints as advisory account check-ins with unresolved legal status and their actual anchor and coverage. " +
  "These checkpoints do not establish a legal deadline, service, completion, reminder or a blanket cadence reset; earlier gaps remain unresolved. " +
  "Report every returned candidate_deadlines entry with its ID, date and sources, preserving the API explanation and qualified review. " +
  "For New Hampshire review fallbacks, identify first_furnishing as a conservative checkpoint and final_furnishing as informational " +
  "pending contract grouping and qualifying completion. Passing the first checkpoint does not itself establish expiry. " +
  "A calculated contract_completion outcome uses only the API-returned deadline; do not substitute the first-furnishing checkpoint or recompute a date. " +
  "Review candidates do not establish calculated filing deadlines, notice completion or scheduled reminders. If a verified review_required outcome returns action_by, " +
  "label it Conservative action date, preserve its explanation, sources and critical warnings, and retain qualified review: " +
  "it is a planning target while the statutory deadline remains unresolved, with no statutory countdown. Never infer an action date " +
  "from candidates, guides or memory. A 409 requires fresh discovery and confirmation; a 503 means this interface " +
  "is unavailable and is not permission to infer new coverage. The existing v2 calculator remains available for its stated scope. " +
  "US mechanics lien and preliminary notice deadlines for construction material suppliers. " +
  "calculate_supplier_deadlines requires a customer key and counts against the plan: give it the project state, first " +
  "delivery date, final delivery date when deliveries are complete, project type and who hired " +
  "the supplier. Answer Florida final-payment and termination or Kansas extension questions " +
  "explicitly as yes, no or unknown; missing and unknown facts need review. The Florida final-payment " +
  "question applies to suppliers not hired by the owner: unknown, omitted, or yes without a date makes " +
  "preliminary notice review_required. Available date baselines " +
  "cover Florida and Kansas private projects; every other " +
  "case returns review_required, which is an answer, not a failure. Ask for missing facts rather " +
  "than guessing, and never substitute an invoice date for delivery dates. get_state_lien_guide " +
  "and list_state_lien_guides return editorial guides with statute citations for all 50 states " +
  "plus DC: use get_state_lien_guide to explain the rules behind a date and list_state_lien_guides " +
  "to find valid state codes. Guide day counts are editorial summaries; take statutory dates only from verified calculated outcomes of " +
  "calculate_supplier_deadlines or calculate_supplier_deadlines_v3, and treat unresolved outcomes as requiring qualified " +
  "review. Research approval for a jurisdiction does not enable its calculations; take dates " +
  "only from a successful calculation response for the submitted facts. ";

const CUSTOMER_INSTRUCTIONS =
  "calculate_lien_deadline and list_supported_states are customer API tools that need " +
  "LIENDEADLINE_API_KEY. list_supported_states returns the codes calculate_lien_deadline accepts; " +
  "supplier tools also require a key. Without one, use the public state guides or website calculator. ";

// Every tool only calculates or reads; none sends notices, files liens or makes payments.
// Each tool also repeats its title in its annotations, where directory reviewers look for it.
const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const v3Scope = {
  state: z.string().regex(/^[A-Za-z]{2}$/).describe("Project jurisdiction: state or DC."),
  project_type: z.enum(["commercial", "residential", "public"]),
  hired_by: z.enum(["owner", "contractor", "subcontractor"]),
};
const digest = z.string().regex(/^[0-9a-f]{64}$/);

export function buildServer(options: ServerOptions): McpServer {
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  const server = new McpServer(
    {
      name: "liendeadline",
      title: "LienDeadline",
      version: VERSION,
    },
    {
      instructions:
        PUBLIC_INSTRUCTIONS +
        (options.includeCustomerTools ? CUSTOMER_INSTRUCTIONS : "") +
        "Results are calculated baselines, not legal advice.",
    },
  );

  server.registerTool(
    "calculate_supplier_deadlines",
    {
      title: "Calculate supplier notice and lien deadlines",
      description:
        "Calculates a construction material supplier's preliminary notice and lien filing deadlines " +
        "from delivery events (contract supplier-events-v2), for questions that need deadline dates. " +
        "Available baselines cover Florida and Kansas private projects; other states and public projects " +
        "return review_required, which is a valid result, not an error. How the parameters depend on " +
        "each other: last_delivery_date is required when deliveries_complete is true. Florida (FL) takes " +
        "florida_final_payment_status and florida_termination_status; Kansas (KS) takes " +
        "kansas_extension_status; these are rejected for other states. Each takes yes, no or unknown: " +
        "an omitted or unknown answer keeps the affected deadline under review, and a blanket review " +
        "flag is not accepted. The Florida final-payment answer holds the notice for suppliers not hired " +
        "by the owner. A Florida event date is accepted only with the matching yes answer. " +
        "Delivery dates are furnishing dates, not invoice dates. Returns JSON with an overall status " +
        "(calculated or review_required), preliminary_notice and lien_filing (each with its own status: " +
        "calculated, not_required, review_required or awaiting_final_delivery, plus deadline, " +
        "days_from_now, description and statute source_url), critical_warnings, statute_citations, an " +
        "exact echo of the submitted inputs and a disclaimer. Invalid or contradictory facts return an " +
        "error naming the field before any API call. Requires a customer key and consumes one plan calculation unit. " +
        "No project is saved, notice sent or lien filed. Not legal advice.",
      inputSchema: {
        state: z
          .string()
          .regex(/^[A-Za-z]{2}$/)
          .describe(
            'Two-letter code of the state where the project is located, e.g. "FL", "KS", "TX"; any state ' +
              "or DC is accepted. Decides which event questions apply.",
          ),
        first_delivery_date: isoDate.describe(
          "Date materials were first delivered (first furnishing), YYYY-MM-DD. Not an invoice date.",
        ),
        last_delivery_date: isoDate
          .optional()
          .describe(
            "Date of the final delivery, YYYY-MM-DD, not earlier than first_delivery_date. Required when " +
              "deliveries_complete is true.",
          ),
        project_type: z
          .enum(["commercial", "residential", "public"])
          .describe("Private commercial, private residential, or public (public projects always need review)."),
        hired_by: z
          .enum(["owner", "contractor", "subcontractor"])
          .describe("Who ordered the materials from the supplier: the owner, a contractor or a subcontractor."),
        deliveries_complete: z
          .boolean()
          .describe(
            "true when the final delivery has happened (then last_delivery_date is required); false while " +
              "deliveries are ongoing, which returns awaiting_final_delivery for the lien date.",
          ),
        florida_final_payment_status: z
          .enum(["yes", "no", "unknown"])
          .optional()
          .describe(
            "Florida only: did the owner make final payment to the contractor? unknown when not verified. " +
              "For suppliers not hired by the owner, unknown, omitted, or yes without " +
              "florida_final_payment_date makes preliminary notice review_required.",
          ),
        florida_termination_status: z
          .enum(["yes", "no", "unknown"])
          .optional()
          .describe(
            "Florida only: was the original contract or notice of commencement terminated? no permits the " +
              "lien baseline; yes, unknown or omitted requires qualified lien review.",
          ),
        florida_final_payment_date: isoDate
          .optional()
          .describe(
            "Florida only: owner final-payment date, YYYY-MM-DD, not earlier than first_delivery_date. " +
              "Supply only with florida_final_payment_status=yes.",
          ),
        florida_termination_date: isoDate
          .optional()
          .describe(
            "Florida only: contract or notice-of-commencement termination date, YYYY-MM-DD, not earlier " +
              "than first_delivery_date. Supply only with florida_termination_status=yes; a lien date still " +
              "requires qualified review.",
          ),
        kansas_extension_status: z
          .enum(["yes", "no", "unknown"])
          .optional()
          .describe(
            "Kansas only: was a statutory lien-period extension filed and mailed? no permits the ordinary " +
              "lien baseline; yes, unknown or omitted requires qualified review.",
          ),
      },
      annotations: { title: "Calculate supplier notice and lien deadlines", ...READ_ONLY, readOnlyHint: false, idempotentHint: false },
    },
    async (args) => {
      try {
        return ok(await calculateSupplierDeadlines(baseUrl, args, options.customerApiKey));
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool("get_supplier_questions", {
    title: "Discover supplier project questions",
    description: "Returns the current supplier-events-v3 scope support, jurisdiction-specific yes/no/unknown event questions, date policies, optional recurring_notice_intake descriptor, sources and exact rule/question identities for a material supplier. Requires a customer key; no delivery dates needed. Discovery does not consume calculation quota. A 503 means the reviewed source is unavailable. Approval of research alone does not activate a scope.",
    inputSchema: v3Scope,
    annotations: { title: "Discover supplier project questions", ...READ_ONLY },
  }, async args => {
    try { return ok(await getSupplierQuestions(baseUrl, { contract_version: "supplier-events-v3", role: "supplier", ...args }, options.customerApiKey)); }
    catch (error) { return fail(error); }
  });

  server.registerTool("calculate_supplier_deadlines_v3", {
    title: "Calculate from discovered supplier facts",
    description: "Evaluates supplier-events-v3 project facts against the exact discovered rule and question identities. Returns independent notice and lien outcomes with sources and an exact nested input echo. When RI discovery asks ri_mailed_within_200_days after ri_mailed=yes, confirm whether mailing occurred within 200 days of first delivery. No, Unknown or omitted confirmation requires review; recording alone never establishes a 40-day target. Only calculated outcomes contain calculated deadline dates. Report every candidate_deadlines entry with its ID, date and sources under the API explanation. For NH review fallbacks, first_furnishing is a conservative checkpoint and final_furnishing is informational pending contract grouping and qualifying completion; passing the first checkpoint does not itself establish expiry. A calculated contract_completion outcome uses only the returned deadline, without substituting the first checkpoint or recomputing a date. Review candidates do not establish filing deadlines, completion or scheduled reminders. An optional preliminary_notice.notice_duties collection contains independently required named notices, each with its own calculated date, explanation and sources; the legacy preliminary date is only their earliest summary. Report every validated duty without inferring duties from candidates or treating one notice as satisfying all duties. A separate optional preliminary_notice.planned_notice_targets collection contains qualified intent planning targets with their target dates, assumed filing dates, full ten- or thirty-day intervals, explanations and sources. Planning targets do not establish statutory expirations, actual filing, notice completion or scheduled notifications. An optional verified action_by is a Conservative action date planning target under qualified review; the statutory deadline and countdown remain unresolved, with explanation, sources and warnings. Optional recurring_notice_facts supplies actual Tennessee furnished months or New Hampshire account records. Tennessee recurring_notice_periods cover entered periods only, including paid and unknown states; known unpaid duties remain independent. New Hampshire recurring_notice_checkpoints are advisory check-ins with unresolved legal status, not legal deadlines, service, completion or scheduled reminders; they do not reset earlier gaps. Never infer intervening months or blanket completion. Stale identities return 409, unavailable reviewed sources return 503. Requires a customer key and consumes one plan calculation unit. No project is saved, notice sent or lien filed.",
    inputSchema: {
      ...v3Scope,
      rules_source: z.object({ schema_version: z.enum(["state-rules-v1", "state-rules-v2"]), source_version: z.string(), source_hash: digest, reviewed_commit: z.string().regex(/^[0-9a-f]{40}$/), supplier_engine_version: z.string(), implementation_manifest_hash: digest }).strict().describe("Exact rules_source from discovery for this scope."),
      questions_identity: z.object({ questions_version: z.literal("supplier-questions-v1"), question_set_hash: digest }).strict().describe("Exact questions_identity from discovery."),
      events: z.record(z.string().regex(/^[a-z][a-z0-9_]{0,79}$/), z.object({ answer: z.enum(["yes", "no", "unknown"]), date: isoDate.optional() }).strict()).describe("Discovered event IDs only; missing means unknown. Date only for yes and only where the question permits it. Invoice dates are not furnishing dates."),
      recurring_notice_facts: z.discriminatedUnion("kind", [
        z.object({ version: z.literal("supplier-recurring-facts-v1"), kind: z.literal("tn_monthly_nonpayment"),
          months: z.array(z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
            unpaid: z.enum(["yes", "no", "unknown"]), retainage_only: z.enum(["yes", "no", "unknown"]) }).strict()).min(1).max(16) }).strict(),
        z.object({ version: z.literal("supplier-recurring-facts-v1"), kind: z.literal("nh_written_account"),
          accounts: z.array(z.object({ id: z.string().regex(/^[a-z][a-z0-9_]{0,79}$/),
            covered_through: isoDate, supplied_date: isoDate }).strict()).max(16) }).strict(),
      ]).optional().describe("Only when discovery returns a matching recurring_notice_intake descriptor. Actual recurring facts only: Tennessee entered furnished months with unpaid and retainage-only answers, or New Hampshire actual written accounts with coverage and supplied dates. Omission retains legacy behavior; unknown answers require review. Do not infer intervening months or actual notice from a plan. NH actual owner notice belongs in the discovered nh_owner_notice_given event."),
    },
    annotations: { title: "Calculate from discovered supplier facts", ...READ_ONLY, readOnlyHint: false, idempotentHint: false },
  }, async args => {
    try { return ok(await calculateSupplierDeadlinesV3(baseUrl, { contract_version: "supplier-events-v3", role: "supplier", ...args }, options.customerApiKey)); }
    catch (error) { return fail(error); }
  });

  if (options.includeCustomerTools) {
    const customerApiKey = options.customerApiKey;

    server.registerTool(
      "calculate_lien_deadline",
      {
        title: "Calculate invoice deadlines (customer API key)",
        description:
          "Customer API tool: requires LIENDEADLINE_API_KEY, a dedicated LienDeadline customer key; " +
          "without one it returns a configuration error and makes no request. Calculates the " +
          "preliminary notice and lien filing deadlines for one construction invoice from its invoice " +
          "or delivery date and state. Returns JSON with state, invoice_date, project_type, " +
          "preliminary_notice_deadline, lien_deadline, waiver_due_date, prelim_deadline_days, " +
          "lien_deadline_days, warnings such as weekend or holiday rollover, notes and a disclaimer. " +
          "A date, day count or project_type the API does not return is null; missing warnings is " +
          "[] and missing notes is an empty string. API denials (401 key, 403 scope, 429 rate limit) " +
          "return a tool error. Successful calculations consume one API plan unit. Not legal advice.",
        inputSchema: {
          state: z
            .string()
            .length(2)
            .describe('Two-letter US state code, e.g. "TX", "CA", "DC", from the jurisdictions the customer API supports.'),
          invoice_date: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/)
            .describe("Invoice or delivery date in YYYY-MM-DD format; deadlines count from it."),
          project_type: z
            .string()
            .optional()
            .describe('Usually "Commercial" or "Residential". Changes the deadline in some states.'),
          notice_date: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/)
            .optional()
            .describe("Date a preliminary notice was actually sent, YYYY-MM-DD, if one was. Omit otherwise."),
          role: z
            .string()
            .optional()
            .describe('Your role on the project, e.g. "supplier", "contractor", "subcontractor".'),
        },
        annotations: { title: "Calculate invoice deadlines (customer API key)", ...READ_ONLY, readOnlyHint: false, idempotentHint: false },
      },
      async (args) => {
        try {
          const result = await calculateDeadline(baseUrl, {
            state: args.state,
            invoice_date: args.invoice_date,
            project_type: args.project_type,
            notice_date: args.notice_date,
            role: args.role,
          }, customerApiKey);
          return ok({ ...result, disclaimer: DISCLAIMER });
        } catch (error) {
          return fail(error);
        }
      },
    );

    server.registerTool(
      "list_supported_states",
      {
        title: "List customer API jurisdictions (customer API key)",
        description:
          "Customer API tool: requires LIENDEADLINE_API_KEY with the states:read scope. Returns count and " +
          "the two-letter codes of the jurisdictions the customer invoice calculation accepts. It does not " +
          "list editorial guides or the states with reviewed supplier baselines. Takes no parameters. " +
          "Read-only.",
        inputSchema: {},
        annotations: { title: "List customer API jurisdictions (customer API key)", ...READ_ONLY },
      },
      async () => {
        try {
          const states = await listSupportedStates(baseUrl, customerApiKey);
          return ok({ count: states.length, states });
        } catch (error) {
          return fail(error);
        }
      },
    );
  }

  server.registerTool(
    "get_state_lien_guide",
    {
      title: "Get the lien guide for one state",
      description:
        "Returns LienDeadline's editorial mechanics lien and preliminary notice guide for one state or " +
        "DC: rules (rule summary with statute citations), deadline_rows (deadline table), faqs (common " +
        "questions) and source_url (the guide's web page), roughly 4 KB of JSON. For questions about how " +
        "a state's lien or notice rules work, why a deadline falls where it does, or which statute " +
        "applies. An unknown state code returns an error. The guide is an editorial reference, not a " +
        "calculation: its day counts are summaries, not computed deadlines. Public and read-only; no " +
        "key needed.",
      inputSchema: {
        state: z.string().length(2).describe('Two-letter US state or DC code, e.g. "TX"; case-insensitive.'),
      },
      annotations: { title: "Get the lien guide for one state", ...READ_ONLY },
    },
    async ({ state }) => {
      try {
        const guide = await getStateGuide(baseUrl, state);
        return ok({ ...guide, note: GUIDE_NOTE, disclaimer: GUIDE_DISCLAIMER });
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "list_state_lien_guides",
    {
      title: "List all state guides",
      description:
        "Lists every published state lien guide in one response, without pagination: count plus " +
        "state_code, title and slug for all 50 states and DC, in alphabetical order by state name. It " +
        "lists editorial guides only and does not indicate which states have calculated deadlines. " +
        "Takes no parameters. Public and read-only; no key needed.",
      inputSchema: {},
      annotations: { title: "List all state guides", ...READ_ONLY },
    },
    async () => {
      try {
        const guides = await listStateGuides(baseUrl);
        return ok({ count: guides.length, guides });
      } catch (error) {
        return fail(error);
      }
    },
  );

  return server;
}
