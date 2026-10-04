import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  DEFAULT_BASE_URL,
  LienDeadlineApiError,
  VERSION,
  calculateDeadline,
  calculateSupplierDeadlines,
  getStateGuide,
  listStateGuides,
  listSupportedStates,
} from "./api.js";

/**
 * The local stdio server registers all five tools. The hosted HTTP server registers only the
 * three public, keyless tools and can never be handed a customer key.
 */
export type ServerOptions =
  | { includeCustomerTools: true; baseUrl?: string; customerApiKey?: string }
  | { includeCustomerTools: false; baseUrl?: string; customerApiKey?: never };

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
  "Editorial reference, not a calculation. Do not derive filing dates from the day counts; " +
  "use calculate_supplier_deadlines, and treat anything it does not calculate as requiring qualified review.";

const PUBLIC_INSTRUCTIONS =
  "US mechanics lien and preliminary notice deadlines for construction material suppliers. " +
  "calculate_supplier_deadlines is public and needs no key: give it the project state, first " +
  "delivery date, final delivery date when deliveries are complete, project type and who hired " +
  "the supplier. Answer Florida final-payment and termination or Kansas extension questions " +
  "explicitly as yes, no or unknown; missing and unknown facts need review. Reviewed date baselines " +
  "cover Florida and Kansas private projects; every other " +
  "case returns review_required, which is an answer, not a failure. Ask for missing facts rather " +
  "than guessing, and never substitute an invoice date for delivery dates. get_state_lien_guide " +
  "and list_state_lien_guides return editorial guides with statute citations for all 50 states " +
  "plus DC. ";

const CUSTOMER_INSTRUCTIONS =
  "calculate_lien_deadline and list_supported_states are customer API tools that need " +
  "LIENDEADLINE_API_KEY. ";

// Every tool only calculates or reads; none sends notices, files liens or makes payments.
// Each tool also repeats its title in its annotations, where directory reviewers look for it.
const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

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
        "from delivery events (contract supplier-events-v2). Use it whenever the user needs dates; use " +
        "get_state_lien_guide to explain the rules behind them. Reviewed baselines cover Florida and " +
        "Kansas private projects; other states and public projects return review_required, which is an " +
        "answer, not an error. How the parameters depend on each other: last_delivery_date is required " +
        "when deliveries_complete is true. Florida (FL) asks florida_final_payment_status and " +
        "florida_termination_status; Kansas (KS) asks kansas_extension_status; these are rejected for " +
        "other states. Answer each yes, no or unknown: an omitted or unknown answer keeps the affected " +
        "deadline under review, and a blanket review flag is not accepted. A Florida event date is " +
        "accepted only with the matching yes answer. Ask the user for missing facts instead of guessing, " +
        "and never use an invoice date as a delivery date. Returns JSON with an overall status " +
        "(calculated or review_required), preliminary_notice and lien_filing (each with its own status: " +
        "calculated, not_required, review_required or awaiting_final_delivery, plus deadline, " +
        "days_from_now, description and statute source_url), critical_warnings, statute_citations, an " +
        "exact echo of the submitted inputs and a disclaimer. Invalid or contradictory facts return an " +
        "error naming the field before any API call. Public, stateless and read-only: no key needed, " +
        "nothing is stored, and no notice is sent or lien filed. Not legal advice.",
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
            "Florida only: did the owner make final payment to the contractor? Use unknown if unverified; " +
              "omitted or unknown keeps the notice under review, and yes needs florida_final_payment_date " +
              "for a notice baseline.",
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
      annotations: { title: "Calculate supplier notice and lien deadlines", ...READ_ONLY },
    },
    async (args) => {
      try {
        return ok(await calculateSupplierDeadlines(baseUrl, args));
      } catch (error) {
        return fail(error);
      }
    },
  );

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
          "lien_deadline_days, warnings such as weekend or holiday rollover, notes and a disclaimer; " +
          "values the API does not return are null. Check accepted codes with list_supported_states. " +
          "Without a key, or when you have delivery events rather than an invoice, use " +
          "calculate_supplier_deadlines. API denials (401 key, 403 scope, 429 rate limit) return a tool " +
          "error. Read-only. Not legal advice.",
        inputSchema: {
          state: z
            .string()
            .length(2)
            .describe('Two-letter US state code, e.g. "TX", "CA", "DC"; one of the codes list_supported_states returns.'),
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
        annotations: { title: "Calculate invoice deadlines (customer API key)", ...READ_ONLY },
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
          "the two-letter codes that calculate_lien_deadline accepts; use it first when unsure a " +
          "jurisdiction is covered. It does not list editorial guides (use list_state_lien_guides) or " +
          "where calculate_supplier_deadlines has reviewed baselines (Florida and Kansas). Takes no " +
          "parameters. Read-only.",
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
        "questions) and source_url (the guide's web page), roughly 4 KB of JSON. Use it when the user " +
        "asks how a state's lien or notice rules work, why a deadline falls where it does, or which " +
        "statute applies. Call list_state_lien_guides first if you need the valid codes; an unknown code " +
        "returns an error. " + GUIDE_NOTE + " Public and read-only; no key needed.",
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
        "state_code, title and slug for all 50 states and DC, in alphabetical order by state name. Use " +
        "it to find a valid code before calling get_state_lien_guide. It lists editorial guides only, " +
        "not where calculate_supplier_deadlines produces dates. Takes no parameters. Public and " +
        "read-only; no key needed.",
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
