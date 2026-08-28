#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  DEFAULT_BASE_URL,
  LienDeadlineApiError,
  calculateDeadline,
  getStateGuide,
  listStateGuides,
  listSupportedStates,
} from "./api.js";

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

export function buildServer(): McpServer {
  const server = new McpServer(
    {
      name: "liendeadline",
      title: "LienDeadline",
      version: "0.1.0",
    },
    {
      instructions:
        "US mechanics lien and preliminary notice deadlines for all 50 states plus DC. " +
        "Give calculate_lien_deadline an invoice or delivery date and a two-letter state code " +
        "to get the preliminary notice and lien filing deadlines. Use get_state_lien_guide when " +
        "you need the underlying rule and its statute citation rather than a date. " +
        "Results are calculated estimates, not legal advice.",
    },
  );

  server.registerTool(
    "calculate_lien_deadline",
    {
      title: "Calculate mechanics lien deadlines",
      description:
        "Calculates the preliminary notice deadline and the lien filing deadline for a US " +
        "construction invoice. Needs the invoice or delivery date and the state. Returns dates, " +
        "days remaining, and any warnings such as weekend or holiday rollover. Covers all 50 " +
        "states plus DC. Not legal advice.",
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
    },
    async (args) => {
      try {
        const result = await calculateDeadline(BASE_URL, {
          state: args.state,
          invoice_date: args.invoice_date,
          project_type: args.project_type,
          notice_date: args.notice_date,
          role: args.role,
        });
        return ok({ ...result, disclaimer: DISCLAIMER });
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "list_supported_states",
    {
      title: "List supported jurisdictions",
      description:
        "Returns the two-letter codes of every US jurisdiction with deadline rules available, " +
        "all 50 states plus DC. Use this to check a code before calculating.",
      inputSchema: {},
    },
    async () => {
      try {
        const states = await listSupportedStates(BASE_URL);
        return ok({ count: states.length, states });
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "get_state_lien_guide",
    {
      title: "Get the lien rules for one state",
      description:
        "Returns the underlying deadline rules for a state, including statute citations, the " +
        "deadline table and common questions. Use this when the user asks why a deadline falls " +
        "where it does, or wants the statute, rather than just a date.",
      inputSchema: {
        state: z.string().length(2).describe('Two-letter US state code, e.g. "TX".'),
      },
    },
    async ({ state }) => {
      try {
        const guide = await getStateGuide(BASE_URL, state);
        return ok({ ...guide, disclaimer: DISCLAIMER });
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
        "Returns every available state guide with its code, title and slug. Useful for " +
        "discovering what exists before fetching one.",
      inputSchema: {},
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
