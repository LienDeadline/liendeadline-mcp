#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
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

const CUSTOMER_API_KEY = process.env.LIENDEADLINE_API_KEY;
const BASE_URL = process.env.LIENDEADLINE_API_URL?.replace(/\/+$/, "") || DEFAULT_BASE_URL;

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

// Every tool only calculates or reads; none sends notices, files liens or makes payments.
const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export function buildServer(): McpServer {
  const server = new McpServer(
    {
      name: "liendeadline",
      title: "LienDeadline",
      version: VERSION,
    },
    {
      instructions:
        "US mechanics lien and preliminary notice deadlines for construction material suppliers in all " +
        "50 states and DC. calculate_supplier_deadlines is public and needs no key: give it the project " +
        "state, first delivery date, final delivery date when deliveries are complete, project type and " +
        "who hired the supplier. When the facts cannot support a date, for example a public project or " +
        "special events that have not been ruled out, the result is review_required with the reason; " +
        "that is an answer, not a failure. Ask for missing facts rather " +
        "than guessing, and never substitute an invoice date for delivery dates. get_state_lien_guide " +
        "and list_state_lien_guides return editorial guides with statute citations for all 50 states " +
        "plus DC. calculate_lien_deadline and list_supported_states are customer API tools that need " +
        "LIENDEADLINE_API_KEY. Results are calculated baselines, not legal advice.",
    },
  );

  server.registerTool(
    "calculate_supplier_deadlines",
    {
      title: "Calculate supplier notice and lien deadlines",
      description:
        "Public, stateless calculation of a material supplier's preliminary notice and lien filing " +
        "deadlines from delivery events (supplier-events-v1) for private projects in all 50 states and " +
        "DC. Public projects and unreviewed special events return status review_required with the " +
        "reason instead of a date. Ongoing deliveries return awaiting_final_delivery for " +
        "the lien date. Each date carries its own status, statute source URL and warnings, and the " +
        "result echoes the submitted inputs. No key needed; nothing is stored. Not legal advice.",
      inputSchema: {
        state: z
          .string()
          .regex(/^[A-Za-z]{2}$/)
          .describe('Two-letter code of the state where the project is located, e.g. "FL", "KS", "TX".'),
        first_delivery_date: isoDate.describe(
          "Date materials were first delivered (first furnishing), YYYY-MM-DD. Not an invoice date.",
        ),
        last_delivery_date: isoDate
          .optional()
          .describe("Date of the final delivery, YYYY-MM-DD. Required when deliveries_complete is true."),
        project_type: z
          .enum(["commercial", "residential", "public"])
          .describe("Private commercial, private residential, or public (public projects always need review)."),
        hired_by: z
          .enum(["owner", "contractor", "subcontractor"])
          .describe("Who ordered the materials from the supplier."),
        deliveries_complete: z
          .boolean()
          .describe("true when the final delivery has happened; false while deliveries are ongoing."),
        special_events_reviewed: z
          .boolean()
          .optional()
          .describe(
            "Set true only when the user confirms that events which can change the deadlines were ruled " +
              "out, such as an early owner final payment, a contract termination or a filed extension. " +
              "Omitted or false returns review_required instead of dates.",
          ),
        florida_final_payment_date: isoDate
          .optional()
          .describe("Florida only: date the owner made final payment to the contractor, if known."),
        florida_termination_date: isoDate
          .optional()
          .describe(
            "Florida only: contract or notice-of-commencement termination date. Supplying it requires " +
              "qualified review, so no claim-of-lien date is calculated.",
          ),
      },
      annotations: READ_ONLY,
    },
    async (args) => {
      try {
        return ok(await calculateSupplierDeadlines(BASE_URL, args));
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "calculate_lien_deadline",
    {
      title: "Calculate invoice deadlines (customer API key)",
      description:
        "Customer API tool: requires LIENDEADLINE_API_KEY, a dedicated LienDeadline customer key. " +
        "Calculates the preliminary notice and lien filing deadlines for one construction invoice " +
        "from its invoice or delivery date and state, with days remaining and warnings such as " +
        "weekend or holiday rollover. Without a key, use calculate_supplier_deadlines. Not legal advice.",
      inputSchema: {
        state: z
          .string()
          .length(2)
          .describe('Two-letter US state code, e.g. "TX", "CA", "DC".'),
        invoice_date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .describe("Invoice or delivery date in YYYY-MM-DD format."),
        project_type: z
          .string()
          .optional()
          .describe('Usually "Commercial" or "Residential". Changes the deadline in some states.'),
        notice_date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional()
          .describe("Date a preliminary notice was actually sent, YYYY-MM-DD, if one was."),
        role: z
          .string()
          .optional()
          .describe('Your role on the project, e.g. "supplier", "contractor", "subcontractor".'),
      },
      annotations: READ_ONLY,
    },
    async (args) => {
      try {
        const result = await calculateDeadline(BASE_URL, {
          state: args.state,
          invoice_date: args.invoice_date,
          project_type: args.project_type,
          notice_date: args.notice_date,
          role: args.role,
        }, CUSTOMER_API_KEY);
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
        "Customer API tool: requires LIENDEADLINE_API_KEY. Returns the two-letter codes the " +
        "customer invoice calculation accepts. calculate_supplier_deadlines needs no such list: it " +
        "accepts any US state or DC.",
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () => {
      try {
        const states = await listSupportedStates(BASE_URL, CUSTOMER_API_KEY);
        return ok({ count: states.length, states });
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "get_state_lien_guide",
    {
      title: "Get the lien guide for one state",
      description:
        "Public, no key needed. Returns LienDeadline's editorial mechanics lien and preliminary " +
        "notice guide for one state or DC: rule summary with statute citations, deadline table and " +
        "common questions. Use it when the user asks why a deadline falls where it does or wants " +
        "the statute. " + GUIDE_NOTE,
      inputSchema: {
        state: z.string().length(2).describe('Two-letter US state code, e.g. "TX".'),
      },
      annotations: READ_ONLY,
    },
    async ({ state }) => {
      try {
        const guide = await getStateGuide(BASE_URL, state);
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
        "Public, no key needed. Returns every available state guide (all 50 states plus DC) with " +
        "its code, title and slug. Useful for discovering what exists before fetching one.",
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () => {
      try {
        const guides = await listStateGuides(BASE_URL);
        return ok({ count: guides.length, guides });
      } catch (error) {
        return fail(error);
      }
    },
  );

  return server;
}

async function main() {
  const server = buildServer();
  await server.connect(new StdioServerTransport());
}

main().catch((error) => {
  console.error("liendeadline-mcp failed to start:", error);
  process.exit(1);
});
