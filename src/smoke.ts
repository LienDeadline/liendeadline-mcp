/**
 * End-to-end check: launches the built server over stdio and calls every tool against the
 * live API. Public tools always run; customer tools run only when LIENDEADLINE_API_KEY is set.
 * With LIENDEADLINE_MCP_URL it drives that hosted Streamable HTTP endpoint instead, which must
 * serve exactly the public tools; no key is ever sent to it.
 */
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

if (process.env.LIENDEADLINE_RUN_LIVE_SMOKE !== "1") {
  throw new Error("Live smoke requires explicit LIENDEADLINE_RUN_LIVE_SMOKE=1; customer tools also need an approved LIENDEADLINE_API_KEY. Use npm test for isolated checks.");
}
const hostedUrl = process.env.LIENDEADLINE_MCP_URL;
const customerKey = hostedUrl ? undefined : process.env.LIENDEADLINE_API_KEY;

const transport = hostedUrl
  ? new StreamableHTTPClientTransport(new URL(hostedUrl))
  : new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL("./index.js", import.meta.url))],
    env: {
      ...(customerKey ? { LIENDEADLINE_API_KEY: customerKey } : {}),
      ...(process.env.LIENDEADLINE_API_URL ? { LIENDEADLINE_API_URL: process.env.LIENDEADLINE_API_URL } : {}),
    },
  });
const client = new Client({ name: "smoke", version: "0.0.0" });
await client.connect(transport);

const { tools } = await client.listTools();
console.log(`tools: ${tools.length}`);
for (const t of tools) console.log(`  - ${t.name}: ${t.title ?? ""}`);
if (hostedUrl) {
  const names = tools.map((t) => t.name).sort().join(", ");
  if (names !== "calculate_supplier_deadlines, get_state_lien_guide, list_state_lien_guides") {
    throw new Error(`The hosted endpoint must serve exactly the three public tools; it lists: ${names}.`);
  }
}

const text = (r: unknown) => {
  if ((r as { isError?: boolean }).isError) {
    throw new Error("Live smoke tool failed. Check API availability and, for customer tools, customer-key scope/status; response details omitted.");
  }
  return ((r as { content?: { text?: string }[] }).content ?? []).map((c) => c.text ?? "").join("");
};

console.log("\ncalculate_supplier_deadlines FL, deliveries complete, explicit no event answers:");
const supplier = JSON.parse(text(await client.callTool({
  name: "calculate_supplier_deadlines",
  arguments: {
    state: "FL", first_delivery_date: "2026-08-03", last_delivery_date: "2026-09-10",
    project_type: "commercial", hired_by: "subcontractor", deliveries_complete: true,
    florida_final_payment_status: "no", florida_termination_status: "no",
  },
})));
console.log(`  status=${supplier.status} notice=${supplier.preliminary_notice?.deadline} lien=${supplier.lien_filing?.deadline}`);

console.log("\nget_state_lien_guide TX (size check):");
const guide = text(await client.callTool({ name: "get_state_lien_guide", arguments: { state: "TX" } }));
console.log(`  ${guide.length} chars returned (raw API guide is ~16000)`);
const parsed = JSON.parse(guide);
console.log(`  statute in rules: ${JSON.stringify(parsed.rules?.preliminary_notice?.statute)}`);
console.log(`  source_url: ${parsed.source_url}`);

console.log("\nerror path, bad state code:");
const badSupplier = await client.callTool({
  name: "calculate_supplier_deadlines",
  arguments: { state: "ZZ", first_delivery_date: "2026-08-03", project_type: "commercial", hired_by: "owner", deliveries_complete: false },
});
if (!(badSupplier as { isError?: boolean }).isError) throw new Error("Expected unsupported state to return an MCP error.");
console.log("  isError=true (response details omitted)");

if (customerKey) {
  console.log("\ncalculate_lien_deadline TX 2026-07-01 Commercial:");
  const calc = await client.callTool({
    name: "calculate_lien_deadline",
    arguments: { state: "TX", invoice_date: "2026-07-01", project_type: "Commercial" },
  });
  console.log(text(calc));

  console.log("\nlist_supported_states:");
  const states = JSON.parse(text(await client.callTool({ name: "list_supported_states", arguments: {} })));
  console.log(`  count=${states.count} first=${states.states.slice(0, 5).join(",")}`);

  console.log("\ncustomer error path, bad state code:");
  const bad = await client.callTool({ name: "calculate_lien_deadline", arguments: { state: "ZZ", invoice_date: "2026-07-01" } });
  if (!(bad as { isError?: boolean }).isError) throw new Error("Expected unsupported state to return an MCP error.");
  console.log("  isError=true (response details omitted)");
} else {
  console.log(hostedUrl
    ? "\ncustomer tools skipped: the hosted endpoint serves only the public tools"
    : "\ncustomer tools skipped: LIENDEADLINE_API_KEY not set");
}

await client.close();
console.log("\nOK");

